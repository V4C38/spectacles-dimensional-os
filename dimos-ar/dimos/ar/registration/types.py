"""Registration domain types — shared between session, wire, and baseline."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal


class RegistrationMode(StrEnum):
    APRIL_ODOM_BASELINE = "april_odom_baseline"
    MANUAL_POSE = "manual_pose"


class RegistrationPhase(StrEnum):
    IDLE = "idle"
    SCANNING = "scanning"
    AWAITING_MOTION = "awaiting_motion"
    MOVING = "moving"
    SAMPLING = "sampling"
    EDITING = "editing"
    AWAITING_COMMIT = "awaiting_commit"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class CaptureHint(StrEnum):
    OFF = "off"
    STEADY = "steady"
    BURST = "burst"
    HOLD = "hold"


MotionDirection = Literal["left", "right"]
MotionAxis = Literal["lateral"]
MotionFrame = Literal["robot"]


@dataclass(frozen=True)
class MotionHint:
    frame: MotionFrame
    axis: MotionAxis
    direction: MotionDirection
    distance_m: float
    waypoint_index: int
    waypoint_total: int

    def to_wire(self) -> dict[str, Any]:
        return {
            "frame": self.frame,
            "axis": self.axis,
            "direction": self.direction,
            "distance_m": round(float(self.distance_m), 3),
            "waypoint_index": int(self.waypoint_index),
            "waypoint_total": int(self.waypoint_total),
        }


@dataclass(frozen=True)
class RegistrationCandidate:
    T_world_odom: Any
    quality: float
    mode: RegistrationMode
    approximate: bool
