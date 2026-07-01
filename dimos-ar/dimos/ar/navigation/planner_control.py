"""Minimal Spec for stopping an active navigation planner goal."""

from __future__ import annotations

from typing import Protocol

from dimos.spec.utils import Spec


class NavGoalCancelSpec(Spec, Protocol):  # type: ignore[misc]
    def cancel_goal(self) -> bool: ...
