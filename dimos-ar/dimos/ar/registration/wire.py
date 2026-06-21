"""Registration wire encode/decode — PROTOCOL v5."""

from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any, Literal

from dimos.ar.registration.types import CaptureHint, MotionHint, RegistrationMode, RegistrationPhase

RegistrationAction = Literal["authorize_motion"]


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class RegistrationStartMessage:
    ts: float
    robot_id: str
    mode: RegistrationMode


@dataclass(frozen=True)
class RegistrationActionMessage:
    ts: float
    robot_id: str
    action: RegistrationAction


@dataclass(frozen=True)
class RegistrationStopMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class RegistrationCommitMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class RegistrationPoseMessage:
    ts: float
    robot_id: str
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class RegistrationStatusPayload:
    mode: RegistrationMode | None
    phase: RegistrationPhase
    capture: CaptureHint
    message: str
    tag_visible: bool | None = None
    motion: MotionHint | None = None
    preview_pose: dict[str, Any] | None = None


def encode_registration_status(
    *,
    ts: float | None,
    robot_id: str,
    status: RegistrationStatusPayload,
) -> str:
    payload: dict[str, Any] = {
        "type": "registration_status",
        "ts": ts if ts is not None else time.time(),
        "robot_id": robot_id,
        "phase": status.phase.value,
        "capture": status.capture.value,
        "message": status.message,
    }
    if status.mode is not None:
        payload["mode"] = status.mode.value
    if status.tag_visible is not None:
        payload["tag_visible"] = status.tag_visible
    if status.motion is not None:
        payload["motion"] = status.motion.to_wire()
    if status.preview_pose is not None:
        payload["preview_pose"] = status.preview_pose
    return _dumps(payload)
