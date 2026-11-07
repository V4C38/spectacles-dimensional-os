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
    settled_at: float | None = None
    last_measurement: float | None = None

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
        self.last_measurement = stamp
        actual = dict(zip(observation.joints.name, observation.joints.position, strict=True))
        close = bool(self.joints) and all(
            math.isfinite(actual.get(name, float("inf")))
            and abs(actual.get(name, float("inf")) - value) <= 0.02
            for name, value in (self.joints or {}).items()
        )
        if not close:
            self.settled_at = None
            return False
        if self.settled_at is None:
            self.settled_at = now
            return False
        return now - self.settled_at >= 0.5
