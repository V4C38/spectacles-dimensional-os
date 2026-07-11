"""Registration wire encode/decode."""

from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any, Literal

from dimos.ar.registration.types import RegistrationMode, RegistrationState

RegistrationCommand = Literal["start", "stop", "commit"]


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class RegistrationCommandMessage:
    ts: float
    robot_id: str
    command: RegistrationCommand
    mode: RegistrationMode | None = None


@dataclass(frozen=True)
class RegistrationPoseMessage:
    ts: float
    robot_id: str
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class RegistrationStatusPayload:
    mode: RegistrationMode | None
    state: RegistrationState
    message: str
    tag_visible: bool | None = None
    preview_pose: dict[str, Any] | None = None
    progress: int | None = None
    registration_confidence: float | None = None
    scale_confidence: float | None = None
    scale_locked: bool | None = None


def encode_registration_status(
    *,
    ts: float | None,
    status: RegistrationStatusPayload,
) -> str:
    payload: dict[str, Any] = {
        "type": "registration_status",
        "ts": ts if ts is not None else time.time(),
        "state": status.state.value,
        "message": status.message,
    }
    if status.mode is not None:
        payload["mode"] = status.mode.value
    if status.tag_visible is not None:
        payload["tag_visible"] = status.tag_visible
    if status.preview_pose is not None:
        payload["preview_pose"] = status.preview_pose
    if status.progress is not None:
        payload["progress"] = status.progress
    if status.registration_confidence is not None:
        payload["registration_confidence"] = round(float(status.registration_confidence), 4)
    if status.scale_confidence is not None:
        payload["scale_confidence"] = round(float(status.scale_confidence), 4)
    if status.scale_locked is not None:
        payload["scale_locked"] = status.scale_locked
    return _dumps(payload)
