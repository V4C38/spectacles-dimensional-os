from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

NavPhase = Literal["idle", "following_path", "resolved"]
NavOutcome = Literal["succeeded", "failed"]


@dataclass(frozen=True)
class NavGoalRequest:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class NavGoalFrame:
    pose: tuple[float, float, float, float] | None
    path_poses: list[tuple[float, float, float, float]]
    ts: float


@dataclass(frozen=True)
class NavState:
    state: NavPhase
    outcome: NavOutcome | None
