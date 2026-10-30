"""Validated manipulation messages, independent of robot runtime imports."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any

ACTIONS = frozenset(
    {
        "evaluate",
        "plan",
        "execute",
        "cancel",
        "resume",
        "acquire",
        "update",
        "release",
        "gripper",
        "reset_joints",
        "prepare_shutdown",
    }
)


@dataclass(frozen=True)
class ManipulationRequest:
    request_id: str
    action: str
    group_id: str
    payload: dict[str, Any]


def identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError(f"{name} must contain 1 to 128 characters")
    return value


def number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    return float(value)


def decode_request(data: dict[str, Any]) -> ManipulationRequest:
    request_id = identifier(data.get("request_id"), "request_id")
    group_id = identifier(data.get("group_id"), "group_id")
    action = data.get("action")
    if not isinstance(action, str) or action not in ACTIONS:
        raise ValueError("unknown manipulation action")
    payload: dict[str, Any] = {}
    if action in {"evaluate", "plan", "update"}:
        for key, count in (("position", 3), ("orientation", 4)):
            values = data.get(key)
            if not isinstance(values, list) or len(values) != count:
                raise ValueError(f"{key} must contain {count} numbers")
            payload[key] = [number(v, key) for v in values]
        if abs(sum(v * v for v in payload["orientation"]) - 1) > 1e-4:
            raise ValueError("orientation must be a unit quaternion")
    if action in {"execute", "release", "update"}:
        key = "plan_id" if action == "execute" else "token"
        payload[key] = identifier(data.get(key), key)
    if action == "update":
        sequence = data.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ValueError("sequence must be a nonnegative integer")
        payload["sequence"] = sequence
        payload["ts"] = number(data.get("ts"), "ts")
    if action in {"plan", "update", "reset_joints", "prepare_shutdown"}:
        speed = number(data.get("speed_scale", 0.2), "speed_scale")
        if not 0 < speed <= 1:
            raise ValueError("speed_scale must be in (0, 1]")
        payload["speed_scale"] = speed
    if action == "plan" and "final_gripper" in data:
        value = number(data["final_gripper"], "final_gripper")
        if not 0 <= value <= 1:
            raise ValueError("final_gripper must be in [0, 1]")
        payload["final_gripper"] = value
    if action == "gripper":
        value = number(data.get("value"), "value")
        if not 0 <= value <= 1:
            raise ValueError("gripper value must be in [0, 1]")
        payload["value"] = value
    return ManipulationRequest(request_id, action, group_id, payload)
