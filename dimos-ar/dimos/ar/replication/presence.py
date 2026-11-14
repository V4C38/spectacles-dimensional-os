"""Bounded passive cues, independent of robot interaction authority."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import json
import math
from typing import Any

from dimos.ar.websocket.bulk import TokenBucket

INTERVAL_S = 0.2
STALE_S = 2.0


def decode_cues(data: dict[str, Any]) -> dict[str, Any]:
    def number(value: Any, low: float, high: float) -> float:
        if isinstance(value, bool) or not isinstance(value, (float, int)):
            raise ValueError("invalid presence number")  # noqa: TRY004 -- protocol validation
        try:
            result = float(value)
        except OverflowError as exc:
            raise ValueError("invalid presence number") from exc
        if not math.isfinite(result) or not low <= result <= high:
            raise ValueError("invalid presence number")
        return round(result, 4)

    def vector(value: Any, size: int) -> list[float]:
        if not isinstance(value, list) or len(value) != size:
            raise ValueError("invalid presence vector")
        return [number(v, -1e6, 1e6) for v in value]

    pointers = data.get("pointers")
    if not isinstance(pointers, list) or len(pointers) > 2:
        raise ValueError("invalid presence pointers")
    decoded = []
    for p in pointers:
        if not isinstance(p, dict) or type(p.get("id")) is not int or p["id"] not in (0, 1):
            raise ValueError("invalid presence pointer")
        if type(p.get("cursor")) is not bool:
            raise ValueError("invalid presence cursor")
        decoded.append(
            {
                "id": p["id"],
                **{k: vector(p.get(k), 3) for k in ("start", "control", "end")},
                "opacity": number(p.get("opacity"), 0, 1),
                "cursor": p["cursor"],
            }
        )
    if len({p["id"] for p in decoded}) != len(decoded):
        raise ValueError("duplicate presence pointer")
    panel = data.get("panel")
    if panel is not None:
        if not isinstance(panel, dict):
            raise ValueError("invalid presence panel")
        q = vector(panel.get("orientation"), 4)
        norm = math.hypot(*q)
        if norm < 1e-6:
            raise ValueError("invalid presence rotation")
        panel = {
            "position": vector(panel.get("position"), 3),
            "orientation": [round(v / norm, 4) for v in q],
            "width": number(panel.get("width"), 0.001, 10),
            "height": number(panel.get("height"), 0.001, 10),
        }
    context = {}
    for key in ("map_code", "odom_reference_id"):
        value = data.get(key)
        if not isinstance(value, str) or not 1 <= len(value) <= 128:
            raise ValueError("invalid presence context")
        context[key] = value
    return {**context, "pointers": decoded, "panel": panel}


@dataclass(frozen=True)
class ClientPresence:
    cues: dict[str, Any]


class PresenceRelay:
    """All transitions run on the server loop; one replaceable sample per transport."""

    def __init__(self, context: Callable[[], dict[str, str] | None]) -> None:
        self._context = context
        self._samples: dict[str, tuple[dict[str, Any], float]] = {}
        self._last_receive: dict[str, float] = {}
        self._dirty = False
        self._last_broadcast = -math.inf

    def receive(self, client_id: str, message: ClientPresence, now: float) -> None:
        if now - self._last_receive.get(client_id, -math.inf) < INTERVAL_S - 1e-6:
            return
        self._last_receive[client_id] = now
        context = self._context()
        if context is None or any(message.cues[k] != v for k, v in context.items()):
            self.remove(client_id)
            return
        self._samples[client_id] = (message.cues, now)
        self._dirty = True

    def remove(self, client_id: str) -> None:
        self._dirty |= self._samples.pop(client_id, None) is not None
        self._last_receive.pop(client_id, None)

    def snapshot(self, now: float) -> dict[str, Any] | None:
        context = self._context()
        for key, (sample, at) in tuple(self._samples.items()):
            if (
                context is None
                or now - at >= STALE_S
                or any(sample[k] != v for k, v in context.items())
            ):
                self.remove(key)
        if not self._dirty or now - self._last_broadcast < INTERVAL_S - 1e-6 or context is None:
            return None
        self._dirty = False
        self._last_broadcast = now
        return {
            "type": "presence_state",
            **context,
            "clients": [
                {
                    "client_id": key,
                    "age_s": round(max(0, now - at), 3),
                    "pointers": sample["pointers"],
                    "panel": sample["panel"],
                }
                for key, (sample, at) in self._samples.items()
                if sample["pointers"] or sample["panel"] is not None
            ],
        }

    @staticmethod
    def encode(snapshot: dict[str, Any], client_id: str, budget: TokenBucket) -> str | None:
        payload = {
            **snapshot,
            "clients": [c for c in snapshot["clients"] if c["client_id"] != client_id],
        }
        text = json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n"
        size = len(text.encode())
        return text if size <= 16_384 and budget.take(size) else None
