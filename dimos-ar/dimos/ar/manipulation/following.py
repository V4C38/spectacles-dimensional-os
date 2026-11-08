"""Repo-owned speed control over the installed, bounded Cartesian IK solver."""

from __future__ import annotations

import math
import threading
from typing import Any
import xml.etree.ElementTree as ET

import attrs
import numpy as np

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
    speed_scale = 0.5
    failure: str | None = None
    failed_joints: tuple[str, ...] = ()

    def step(self, *args: Any, **kwargs: Any) -> Any:
        try:
            targets = args[0] if args else kwargs.get("frame_targets", {})
            measured = args[1] if len(args) > 1 else kwargs.get("measured_state")
            if measured is not None and targets:
                poses = self.frame_poses(measured, tuple(targets))
                held = getattr(self, "_arrival_hold", None)
                near = True
                for name, target in targets.items():
                    pose = poses.get(name)
                    if pose is None:
                        near = False
                        break
                    distance = math.sqrt(
                        sum(
                            (getattr(pose.position, a) - getattr(target.position, a)) ** 2
                            for a in ("x", "y", "z")
                        )
                    )
                    dot = abs(
                        sum(
                            getattr(pose.orientation, a) * getattr(target.orientation, a)
                            for a in ("x", "y", "z", "w")
                        )
                    )
                    near &= distance <= (0.004 if held is not None else 0.002) and 2 * math.acos(
                        min(1, dot)
                    ) <= math.radians(2 if held is not None else 1)
                self._arrival_hold = True if near else None
            return super().step(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 — native solver failures retire this target
            if self.failure is None:
                logger.warning("Following IK target failed", error=str(exc))
            self.failure = str(exc)
            joint = getattr(exc, "joint_name", None)
            self.failed_joints = (joint,) if isinstance(joint, str) else ()
            return None

    def reset(self) -> None:
        super().reset()
        self._stream_velocity = None
        self._arrival_hold = None

    def _before_solve(self, tasks: Any, configuration: Any, dt: float) -> None:
        super()._before_solve(tasks, configuration, dt)
        for name, task in tasks.items():
            if name.startswith("frame/"):
                # FrameTask gain is per tick. A fixed planning gain at 100 Hz
                # requests late braking that the acceleration envelope cannot follow.
                task.gain = min(0.5, 2 * dt)

    def _apply_streaming_command_envelope(self, **kwargs: Any) -> Any:
        previous = kwargs["previous"]
        dt = kwargs["dt"]
        self._envelope_pass += 1
        bounded = super()._apply_streaming_command_envelope(**kwargs)
        if self._envelope_pass != 2:
            return bounded
        limits = self.acceleration_limits
        acceleration = (
            np.array([limits[name] for name in kwargs["context"].mapping.dimos_joint_names])
            * self.speed_scale
        )
        velocity = getattr(self, "_stream_velocity", None)
        if velocity is None:
            velocity = np.zeros_like(previous)
        desired = (bounded - previous) / dt
        if getattr(self, "_arrival_hold", None):
            desired = np.zeros_like(previous)
        desired = np.clip(desired, velocity - acceleration * dt, velocity + acceleration * dt)
        command = previous + desired * dt
        # Retain the official position/tracking safety envelope after acceleration limiting.
        safe = super()._apply_streaming_command_envelope(**{**kwargs, "candidate": command})
        self._stream_velocity = (safe - previous) / dt
        return safe

    def _step_frame_targets(self, *args: Any, **kwargs: Any) -> Any:
        self._envelope_pass = 0
        scale = self.speed_scale
        kwargs["max_joint_velocity_rad_s"] *= scale
        kwargs["joint_velocity_limits_rad_s"] = {
            joint: value * scale
            for joint, value in (kwargs.get("joint_velocity_limits_rad_s") or {}).items()
        }
        return super()._step_frame_targets(*args, **kwargs)


class SpeedScaledCartesianIKTask(CartesianIKTask):  # type: ignore[misc]
    def compute(self, state: Any) -> Any:
        guard = getattr(self, "guard", None)
        if guard is not None:
            if guard.scale == 0:
                self.clear()
                return None
            self._solver.speed_scale = self.requested_speed * guard.scale
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
        if key != getattr(self, "_failed_target", None):
            self._solver._arrival_hold = None
        self._failed_target = key
        self._solver.failure = None
        return super().on_cartesian_command(pose, t_now=t_now)

    def set_target(
        self, pose: Any, value: float, t_now: float | None = None
    ) -> dict[str, Any] | None:
        # Coordinator task_invoke serializes this with compute. Read the failure
        # before command receipt can clear it, and attribute it only to this pose.
        key = (
            pose.x,
            pose.y,
            pose.z,
            pose.orientation.x,
            pose.orientation.y,
            pose.orientation.z,
            pose.orientation.w,
        )
        failure = self.get_failure() if key == getattr(self, "_failed_target", None) else None
        self.set_speed_scale(value)
        self.on_cartesian_command(pose, t_now=t_now)
        return failure

    def set_validated_target(self, key: list[float], joints: dict[str, float]) -> None:
        if tuple(key) == getattr(self, "_failed_target", None):
            self._solver.failure = None

    def get_tracking_status(self) -> dict[str, Any]:
        velocity = getattr(self._solver, "_stream_velocity", None)
        stopped = velocity is None or float(np.max(np.abs(velocity))) < 0.01
        return {
            "target_key": getattr(self, "_failed_target", None),
            "arrived": bool(getattr(self._solver, "_arrival_hold", None))
            and stopped
            and self.is_active(),
        }

    def get_failure(self) -> dict[str, Any] | None:
        failure = self._solver.failure
        if failure is None:
            return None
        from dimos.ar.manipulation.errors import spatial_error_code

        return {
            "message": str(failure),
            "code": spatial_error_code(str(failure), "ik_failed"),
            "failed_joints": list(getattr(self._solver, "failed_joints", ())),
        }

    def set_speed_scale(self, value: float) -> None:
        if not math.isfinite(value) or not 0 < value <= 1:
            raise ValueError("speed scale must be in (0, 1]")
        self.requested_speed = value
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
    from dimos.ar.manipulation.limits import COMMAND_TRACKING_LEAD_RAD

    values["max_command_tracking_error_deg"] = math.degrees(COMMAND_TRACKING_LEAD_RAD)
    values["joint_command_filter_cutoff_hz"] = None
    values["joint_velocity_limits_rad_s"] = limits
    values["max_joint_velocity_rad_s"] = max(limits.values())
    config = CartesianIKTaskConfig(**values)
    solver = SpeedScaledPoseTargetSolver(config)
    solver.acceleration_limits = {
        joint.name: joint.acceleration
        for joint in params.robot_model.model.load().joints
        if joint.name in cfg.joint_names
    }
    if any(
        value is None or not math.isfinite(value) or value <= 0
        for value in solver.acceleration_limits.values()
    ):
        raise ValueError("Following requires model acceleration limits for every arm joint")
    from dimos.ar.manipulation.protection import guard_for

    task = SpeedScaledCartesianIKTask(cfg.name, config, solver=solver)
    if task is None:
        return task
    task.guard = guard_for(hardware)
    task.requested_speed = 0.5
    return task


class ARManipulationCoordinator(ArmPoseCoordinator):  # type: ignore[misc]
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._stop_once = threading.Lock()

    @rpc  # type: ignore[untyped-decorator]
    def stop(self) -> None:
        if self._stop_once.acquire(blocking=False):
            super().stop()

    @rpc  # type: ignore[untyped-decorator]
    def set_estop(self, estopped: bool) -> bool:
        confirmed = True
        with self._hardware_lock:
            for connected in self._hardware.values():
                adapter = getattr(connected, "_wb_adapter", None)
                hold = getattr(adapter, "hold_current", None)
                release = getattr(adapter, "release_hold", None)
                if estopped and callable(hold):
                    confirmed = hold() and confirmed
                elif not estopped and callable(release):
                    release()
        return bool(super().set_estop(estopped)) and confirmed

    @rpc  # type: ignore[untyped-decorator]
    def protection_status(self) -> dict[str, Any]:
        from dimos.ar.manipulation.protection import guard_for

        guard = guard_for(self._hardware)
        return guard.snapshot() if guard else {"state": "normal", "effective_speed_scale": 1.0}

    @rpc  # type: ignore[untyped-decorator]
    def protection_resume(self) -> bool:
        import time

        from dimos.ar.manipulation.protection import guard_for

        guard = guard_for(self._hardware)
        return guard is None or guard.resume(time.monotonic())

    @rpc  # type: ignore[untyped-decorator]
    def build(self) -> None:
        control_task_registry.register_path(
            "ar_cartesian_ik", "dimos.ar.manipulation.following:create_task"
        )
        control_task_registry.register_bindings(
            "ar_cartesian_ik",
            exposes=[
                "start",
                "clear",
                "set_speed_scale",
                "on_cartesian_command",
                "get_failure",
                "get_tracking_status",
                "set_validated_target",
                "set_target",
            ],
        )
        from dimos.hardware.whole_body.registry import whole_body_adapter_registry

        if any(c.adapter_type == "openyam_damiao" for c in self.config.hardware):
            from dimos.ar.manipulation.protected_hardware import ProtectedOpenYamAdapter

            whole_body_adapter_registry.register("ar_openyam_protected", ProtectedOpenYamAdapter)
        for component in self.config.hardware:
            if component.adapter_type == "openyam_damiao":
                component.adapter_type = "ar_openyam_protected"
        control_task_registry.register_path(
            "ar_joint_trajectory", "dimos.ar.manipulation.protection:create_trajectory_task"
        )
        control_task_registry.register_bindings(
            "ar_joint_trajectory",
            exposes=["execute", "cancel", "get_status", "reset", "get_endpoint_status"],
        )
        for task in self.config.tasks:
            if task.type == "trajectory":
                task.type = "ar_joint_trajectory"
        super().build()
