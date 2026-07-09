"""Registration domain types — shared between session, wire, and flows."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class RegistrationMode(StrEnum):
    APRIL_TAG = "april_tag"
    MANUAL_POSE = "manual_pose"


class RegistrationPhase(StrEnum):
    IDLE = "idle"
    SCANNING = "scanning"
    EDITING = "editing"
    AWAITING_COMMIT = "awaiting_commit"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class CaptureHint(StrEnum):
    OFF = "off"
    STEADY = "steady"
    BURST = "burst"


@dataclass(frozen=True)
class RegistrationCandidate:
    T_world_odom: Any
    quality: float
    mode: RegistrationMode
    approximate: bool
    odom_scale: float | None = None
