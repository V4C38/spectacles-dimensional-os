"""Registration domain types — shared between session, wire, and flows."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class RegistrationMode(StrEnum):
    APRIL_TAG = "april_tag"
    MANUAL_POSE = "manual_pose"


class RegistrationState(StrEnum):
    IDLE = "idle"
    APRIL_TAG = "april_tag"
    MANUAL_PLACEMENT = "manual_placement"
    AWAITING_COMMIT = "awaiting_commit"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True)
class RegistrationCandidate:
    T_world_odom: Any
    quality: float
    mode: RegistrationMode
    approximate: bool
    odom_scale: float | None = None
