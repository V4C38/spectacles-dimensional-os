"""Server-owned completion of one validated following target."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any


@dataclass
class FollowingTail:
    generation: int
    group_id: str
    target_revision: int
    epoch: str
    body: dict[str, Any]
    joints: dict[str, float] | None
    started_at: float
    refreshed_at: float = float("-inf")
    joint_tolerance: float = 0.02
    settled_at: float | None = None
    last_measurement: float | None = None
    target_pose: Any = None
    continuous_joints: frozenset[str] = frozenset()
    last_joints: dict[str, float] | None = None
    stalled_at: float | None = None
    progress_error: tuple[float, float] | None = None

    def wire(self) -> dict[str, Any]:
        return {
            "generation": self.generation,
            "group_id": self.group_id,
            "target_revision": self.target_revision,
            "status": "finishing",
            "position": list(self.body["position"]),
            "orientation": list(self.body["orientation"]),
            "speed_scale": self.body["speed_scale"],
            **({"joints": dict(self.joints)} if self.joints is not None else {}),
        }

    def arrived(self, observation: Any, *, now: float) -> bool:
        stamp = float(observation.joints.ts)
        if self.last_measurement is not None and stamp <= self.last_measurement:
            return False
        previous_stamp = self.last_measurement
        previous_joints = self.last_joints
        self.last_measurement = stamp
        actual = dict(zip(observation.joints.name, observation.joints.position, strict=True))
        self.last_joints = actual
        velocities = getattr(observation.joints, "velocity", None)
        if velocities and len(velocities) == len(actual):
            stationary = all(math.isfinite(v) and abs(v) <= 0.05 for v in velocities)
        else:
            stationary = (
                previous_stamp is not None
                and previous_joints is not None
                and all(
                    name in previous_joints
                    and math.isfinite(value)
                    and abs(self.joint_delta(name, value, previous_joints[name]))
                    / (stamp - previous_stamp)
                    <= 0.05
                    for name, value in actual.items()
                )
            )
        stationary = bool(actual) and all(math.isfinite(v) for v in actual.values()) and stationary
        pose = getattr(observation, "end_effector_pose", None)
        if pose is not None and self.target_pose is not None:
            distance = math.sqrt(
                sum(
                    (getattr(pose.position, axis) - getattr(self.target_pose.position, axis)) ** 2
                    for axis in ("x", "y", "z")
                )
            )
            dot = abs(
                sum(
                    getattr(pose.orientation, axis) * getattr(self.target_pose.orientation, axis)
                    for axis in ("x", "y", "z", "w")
                )
            )
            angle = 2 * math.acos(min(1, dot)) if math.isfinite(dot) else float("inf")
            close = distance <= 0.01 and angle <= math.radians(3)
            error = (distance, angle)
        else:
            delta = max(
                (
                    abs(self.joint_delta(name, actual.get(name, float("inf")), value))
                    for name, value in (self.joints or {}).items()
                ),
                default=float("inf"),
            )
            close = math.isfinite(delta) and delta <= self.joint_tolerance
            error = (delta, 0.0)
        if stationary and not close:
            previous_error = self.progress_error
            if (
                self.stalled_at is None
                or previous_error is None
                or previous_error[0] - error[0] >= 0.002
                or previous_error[1] - error[1] >= math.radians(0.5)
            ):
                self.stalled_at = now
                self.progress_error = error
        else:
            self.stalled_at = None
            self.progress_error = None
        self.settled_at = (
            (self.settled_at if self.settled_at is not None else now)
            if close and stationary
            else None
        )
        return self.settled_at is not None and now - self.settled_at >= 0.5

    def stalled(self, *, now: float) -> bool:
        return self.stalled_at is not None and now - self.stalled_at >= 2

    def joint_delta(self, name: str, current: float, expected: float) -> float:
        delta = current - expected
        if name in self.continuous_joints and math.isfinite(delta):
            return math.atan2(math.sin(delta), math.cos(delta))
        return delta
