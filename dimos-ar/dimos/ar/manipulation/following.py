"""Repo-owned speed control over the installed, bounded Cartesian IK solver."""

from __future__ import annotations

import math
import threading
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
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class SpeedScaledPoseTargetSolver(PinkPoseTargetSolver):  # type: ignore[misc]
    speed_scale = 0.2
    failure: str | None = None

    def step(self, *args: Any, **kwargs: Any) -> Any:
        try:
            return super().step(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 — native solver failures retire this target
            if self.failure is None:
                logger.warning("Following IK target failed", error=str(exc))
            self.failure = str(exc)
            return None

    def _step_frame_targets(self, *args: Any, **kwargs: Any) -> Any:
        scale = self.speed_scale
        kwargs["max_joint_velocity_rad_s"] *= scale
        kwargs["joint_velocity_limits_rad_s"] = {
            joint: value * scale
            for joint, value in (kwargs.get("joint_velocity_limits_rad_s") or {}).items()
        }
        return super()._step_frame_targets(*args, **kwargs)


class SpeedScaledCartesianIKTask(CartesianIKTask):  # type: ignore[misc]
    def compute(self, state: Any) -> Any:
        result = super().compute(state)
        if self._solver.failure is not None:
            self.clear()
        return result

    def on_cartesian_command(self, pose: Any, t_now: float | None = None) -> Any:
        key = (
            pose.position.x,
            pose.position.y,
            pose.position.z,
            pose.orientation.x,
            pose.orientation.y,
            pose.orientation.z,
            pose.orientation.w,
        )
        if self._solver.failure is not None and getattr(self, "_failed_target", None) == key:
            return None
        self._failed_target = key
        self._solver.failure = None
        return super().on_cartesian_command(pose, t_now=t_now)

    def get_failure(self) -> str | None:
        failure = self._solver.failure
        return str(failure) if failure is not None else None

    def set_speed_scale(self, value: float) -> None:
        if not math.isfinite(value) or not 0 < value <= 1:
            raise ValueError("speed scale must be in (0, 1]")
        self._solver.speed_scale = value


def create_task(cfg: Any, hardware: Any) -> SpeedScaledCartesianIKTask:
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
    return SpeedScaledCartesianIKTask(cfg.name, config, solver=SpeedScaledPoseTargetSolver(config))


class ARManipulationCoordinator(ArmPoseCoordinator):  # type: ignore[misc]
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._stop_once = threading.Lock()

    @rpc  # type: ignore[untyped-decorator]
    def stop(self) -> None:
        if self._stop_once.acquire(blocking=False):
            super().stop()

    @rpc  # type: ignore[untyped-decorator]
    def build(self) -> None:
        control_task_registry.register_path(
            "ar_cartesian_ik", "dimos.ar.manipulation.following:create_task"
        )
        control_task_registry.register_bindings(
            "ar_cartesian_ik",
            exposes=["start", "clear", "set_speed_scale", "on_cartesian_command", "get_failure"],
        )
        super().build()
