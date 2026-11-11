"""Validated interaction wire commands; the coordinator rechecks authority."""

from __future__ import annotations

import math
from typing import Any, cast

from dimos.ar.numeric import finite_number
from dimos.ar.replication.interaction import (
    InteractionAction,
    InteractionKind,
    InteractionMode,
    InteractionRequest,
)

ACTIONS = frozenset(
    {
        "acquire",
        "renew",
        "update",
        "release",
        "confirm",
        "cancel",
        "cancel_acquire",
        "snapshot",
        "mode",
    }
)


def identifier(data: dict[str, Any], key: str, *, required: bool = False) -> str | None:
    value = data.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError(f"{key} must contain 1 to 128 characters")
    return value


def sequence(data: dict[str, Any], key: str = "sequence") -> int | None:
    value = data.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{key} must be a nonnegative integer")
    return value


def decode_interaction_request(data: dict[str, Any]) -> InteractionRequest:
    request_id = identifier(data, "request_id", required=True)
    assert request_id is not None
    action = data.get("action")
    if action not in ACTIONS:
        raise ValueError("unknown interaction action")
    kind, mode = data.get("kind"), data.get("mode")
    if kind is not None and kind not in (
        "live",
        "navigation_planning",
        "joystick",
        "manipulation_planning",
        "manipulation_following",
    ):
        raise ValueError("invalid interaction kind")
    if mode is not None and mode not in ("manual", "agent"):
        raise ValueError("invalid robot mode")
    pose: list[tuple[float, ...]] = []
    for name, length in (("position", 3), ("orientation", 4)):
        if name not in data:
            continue
        raw = data[name]
        if not isinstance(raw, list) or len(raw) != length:
            raise ValueError(f"{name} must contain {length} finite numbers")
        pose.append(tuple(finite_number(v, name) for v in raw))
    if len(pose) == 1:
        raise ValueError("position and orientation must be supplied together")
    if pose and math.hypot(*pose[1]) < 1e-6:
        raise ValueError("orientation must be nonzero")
    for field in ("speed_scale", "gripper"):
        if field in data:
            value = finite_number(data[field], field)
            lower = 0.0 if field == "gripper" else 0.000001
            if not lower <= value <= 1:
                raise ValueError(f"invalid {field}")
    return InteractionRequest(
        request_id=request_id,
        action=cast("InteractionAction", action),
        epoch=identifier(data, "epoch"),
        acquisition_id=identifier(data, "acquisition_id"),
        lease_id=identifier(data, "lease_id"),
        source_id=identifier(data, "source_id"),
        sequence=sequence(data),
        kind=cast("InteractionKind | None", kind),
        mode=cast("InteractionMode | None", mode),
        group_id=identifier(data, "group_id"),
        speed_scale=float(data["speed_scale"]) if "speed_scale" in data else None,
        gripper=float(data["gripper"]) if "gripper" in data else None,
        position=cast("tuple[float, float, float]", pose[0]) if pose else None,
        orientation=cast("tuple[float, float, float, float]", pose[1]) if pose else None,
    )
