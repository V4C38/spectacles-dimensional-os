"""Local motor guard. It never acknowledges or clears a hardware fault automatically."""

from __future__ import annotations

from dataclasses import dataclass
import math
import time
from typing import Any

from dimos.utils.logging_config import setup_logger

logger = setup_logger()


@dataclass
class ProtectionPolicy:
    stall_error: float = math.radians(5)
    stall_velocity: float = 0.05
    derate_after: float = 0.2
    pause_after: float = 0.75
    tracking_pause: bool = False
    derate_clear_error: float = math.radians(3)
    derate_recovery: float = 1.0
    warm: float = 60
    hot: float = 70
    cool: float = 55
    recovery: float = 2


class MotorProtection:
    def __init__(self, policy: ProtectionPolicy | None = None) -> None:
        self.policy = policy or ProtectionPolicy()
        self.state = "normal"
        self.reason = ""
        self.joints: list[str] = []
        self.since: dict[str, float] = {}
        self.healthy_since: float | None = None
        self.derate_clear_since: float | None = None
        self.last: list[dict[str, Any]] = []

    @property
    def scale(self) -> float:
        return 1.0 if self.state == "normal" else 0.5 if self.state == "derated" else 0.0

    def snapshot(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "reason": self.reason,
            "joints": self.joints,
            "effective_speed_scale": self.scale,
            "resumable": self.state == "paused"
            and self.healthy_since is not None
            and time.monotonic() - self.healthy_since >= self.policy.recovery,
            "motors": self.last,
        }

    def observe(self, rows: list[dict[str, Any]], now: float) -> None:
        self.last = rows
        warning = False
        paused = False
        affected: list[str] = []
        reason = ""
        healthy = True
        derate_clear = True
        for row in rows:
            name = row["joint"]
            if row.get("fault") or row.get("enabled") is False:
                if self.state != "fault":
                    logger.error("Arm motor fault latched", motor=row)
                self.state = "fault"
                self.reason = f"Motor fault or disabled motor: {name}"
                self.joints = [name]
                self.healthy_since = None
                return
            error = abs(row["command"] - row["position"])
            temperature = max(row.get("temperature_mos", 0), row.get("temperature_rotor", 0))
            stalled = (
                error > self.policy.stall_error
                and abs(row["velocity"]) < self.policy.stall_velocity
            )
            warm = temperature >= self.policy.warm
            for key, active in [(name + ":stall", stalled), (name + ":warm", warm)]:
                if active:
                    self.since.setdefault(key, now)
                else:
                    self.since.pop(key, None)
            stall_age = now - self.since.get(name + ":stall", now)
            warm_age = now - self.since.get(name + ":warm", now)
            if (stalled and stall_age >= self.policy.derate_after) or (warm and warm_age >= 0.5):
                warning = True
                affected.append(name)
                reason = "Tracking stall" if stalled else "Motor temperature"
            if (
                (self.policy.tracking_pause and stalled and stall_age >= self.policy.pause_after)
                or temperature >= self.policy.hot
                or (warm and warm_age >= 5)
            ):
                paused = True
                affected.append(name)
                reason = (
                    "Motor temperature"
                    if temperature >= self.policy.hot or (warm and warm_age >= 5)
                    else "Tracking stall"
                )
            healthy &= error < math.radians(2) and temperature < self.policy.cool
            derate_clear &= (
                error < self.policy.derate_clear_error and temperature < self.policy.cool
            )
        if self.state == "fault":
            return
        self.derate_clear_since = (
            (self.derate_clear_since if self.derate_clear_since is not None else now)
            if derate_clear
            else None
        )
        recovering_derate = self.state == "derated" and (
            self.derate_clear_since is None
            or now - self.derate_clear_since < self.policy.derate_recovery
        )
        next_state = (
            "paused"
            if paused or self.state == "paused"
            else "derated"
            if warning or recovering_derate
            else "normal"
        )
        if next_state != self.state:
            logger.warning(
                "Arm protection transition",
                previous=self.state,
                state=next_state,
                reason=reason,
                motors=rows,
            )
        self.state = next_state
        if reason:
            self.reason, self.joints = reason, sorted(set(affected))
        if self.state == "normal":
            self.reason, self.joints = "", []
        self.healthy_since = (
            (self.healthy_since if self.healthy_since is not None else now) if healthy else None
        )

    def resume(self, now: float) -> bool:
        if self.state in {"normal", "derated"}:
            return True
        if (
            self.state == "fault"
            or self.healthy_since is None
            or now - self.healthy_since < self.policy.recovery
        ):
            return False
        self.state, self.reason, self.joints = "normal", "", []
        self.since.clear()
        self.derate_clear_since = None
        return True


def guard_for(hardware: Any) -> MotorProtection | None:
    for connected in (hardware or {}).values():
        guard = getattr(getattr(connected, "_wb_adapter", None), "guard", None)
        if isinstance(guard, MotorProtection):
            return guard
    return None


def create_trajectory_task(cfg: Any, hardware: Any) -> Any:
    from copy import copy
    from dataclasses import replace

    from dimos.control.tasks.trajectory_task.trajectory_task import create_task

    task = create_task(cfg, hardware)
    # The polling interface exists for simulated hardware as well as protected motors.
    task.get_endpoint_status = lambda: {"holding_endpoint": False}
    guard = guard_for(hardware)
    if guard is None:
        return task
    compute = task.compute
    get_status = task.get_status
    cancel = task.cancel
    is_active = task.is_active
    execute = task.execute
    preempt = task.on_preempted
    task._ar_virtual_time = None
    pending = None
    settled_at = None

    def guarded_cancel() -> Any:
        nonlocal pending, settled_at
        pending = None
        settled_at = None
        return cancel()

    def guarded_compute(state: Any) -> Any:
        nonlocal pending, settled_at
        if task._ar_virtual_time is None:
            task._ar_virtual_time = state.t_now
        scale = guard.scale
        task._ar_virtual_time += state.dt * scale
        if scale == 0:
            guarded_cancel()
            return None
        output = compute(replace(state, t_now=task._ar_virtual_time, dt=state.dt * scale))
        status = get_status(task._ar_virtual_time)
        if getattr(getattr(status, "state", None), "name", None) != "COMPLETED":
            pending = None
            settled_at = None
            return output
        if output is not None:
            pending = output
        if pending is not None and pending.positions is not None:
            arrived = all(
                (actual := state.joints.get_position(name)) is not None
                and abs(actual - value) <= 0.02
                for name, value in zip(pending.joint_names, pending.positions, strict=True)
            )
            settled_at = (
                (settled_at if settled_at is not None else state.t_now) if arrived else None
            )
            if settled_at is not None and state.t_now - settled_at >= 0.5:
                pending = None
        # The motor boundary may rate-limit the final sample. Keep sending it
        # until measured arrival instead of abandoning a partially applied goal.
        return pending if pending is not None else output

    def guarded_status(t_now: float) -> Any:
        status = get_status(task._ar_virtual_time if task._ar_virtual_time is not None else t_now)
        if pending is not None and status.state.name == "COMPLETED":
            holding = copy(status)
            holding.state = type(status.state).EXECUTING
            return holding
        return status

    def guarded_execute(*args: Any, **kwargs: Any) -> Any:
        nonlocal pending, settled_at
        result = execute(*args, **kwargs)
        if result.status.name == "ACCEPTED":
            pending = None
            settled_at = None
        return result

    def guarded_preempt(*args: Any, **kwargs: Any) -> Any:
        nonlocal pending, settled_at
        pending = None
        settled_at = None
        return preempt(*args, **kwargs)

    task.is_active = lambda: pending is not None or is_active()
    task.get_endpoint_status = lambda: {"holding_endpoint": pending is not None}
    task.execute = guarded_execute
    task.on_preempted = guarded_preempt
    task.compute = guarded_compute
    task.cancel = guarded_cancel
    task.get_status = guarded_status
    return task
