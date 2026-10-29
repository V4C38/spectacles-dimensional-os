"""Repo-owned speed control over the installed, bounded Cartesian IK solver."""

from __future__ import annotations

import math
from typing import Any
import xml.etree.ElementTree as ET

import attrs

from dimos.control.tasks.cartesian_ik_task.cartesian_ik_task import (
    CartesianIKTask,
    CartesianIKTaskConfig,
    CartesianIKTaskParams,
)
from dimos.control.tasks.pose_target_ik import PinkPoseTargetSolver
from dimos.control.tasks.registry import control_task_registry
from dimos.core.core import rpc
from dimos.robot.manipulators.common.coordinators import ArmPoseCoordinator


class SpeedSolver(PinkPoseTargetSolver):  # type: ignore[misc]
    speed_scale = 0.2

    def _step_frame_targets(self, *args: Any, **kwargs: Any) -> Any:
        scale = self.speed_scale
        kwargs["max_joint_velocity_rad_s"] *= scale
        kwargs["joint_velocity_limits_rad_s"] = {
            joint: value * scale
            for joint, value in (kwargs.get("joint_velocity_limits_rad_s") or {}).items()
        }
        return super()._step_frame_targets(*args, **kwargs)


class SpeedTask(CartesianIKTask):  # type: ignore[misc]
    def set_speed_scale(self, value: float) -> None:
        if not math.isfinite(value) or not 0.05 <= value <= 1:
            raise ValueError("speed scale must be between 0.05 and 1")
        self._solver.speed_scale = value


def create_task(cfg: Any, hardware: Any) -> SpeedTask:
    params = CartesianIKTaskParams.model_validate(cfg.params)
    values = {
        field.name: getattr(params, field.name)
        for field in attrs.fields(CartesianIKTaskConfig)
        if hasattr(params, field.name)
    }
    values.update(
        joint_names=tuple(cfg.joint_names),
        target_frames=(params.target_frame,),
        priority=cfg.priority,
    )
    # Use the same URDF velocity limits as the trajectory parametrizer.
    model = ET.fromstring(params.robot_model.model.load().xml)
    limits = {}
    for joint in model.findall("joint"):
        limit = joint.find("limit")
        name = joint.attrib.get("name", "")
        if name in cfg.joint_names and limit is not None and "velocity" in limit.attrib:
            velocity = float(limit.attrib["velocity"])
            if math.isfinite(velocity) and velocity > 0:
                limits[name] = velocity
    if set(limits) != set(cfg.joint_names):
        raise ValueError("Following requires model velocity limits for every arm joint")
    values["joint_velocity_limits_rad_s"] = limits
    values["max_joint_velocity_rad_s"] = max(limits.values())
    config = CartesianIKTaskConfig(**values)
    return SpeedTask(cfg.name, config, solver=SpeedSolver(config))


class ARArmCoordinator(ArmPoseCoordinator):  # type: ignore[misc]
    @rpc  # type: ignore[untyped-decorator]
    def build(self) -> None:
        control_task_registry.register_path(
            "ar_cartesian_ik", "dimos.ar.manipulation.following:create_task"
        )
        control_task_registry.register_bindings(
            "ar_cartesian_ik",
            exposes=["start", "clear", "set_speed_scale", "on_cartesian_command"],
        )
        super().build()
