"""Optional runtime AprilTag mount overrides via ``DIMOS_AR_TAG_MOUNTS`` JSON."""

from __future__ import annotations

import json
import os
from typing import Any

from dimos.ar.tag_tracking.solve import TAG_BLACK_SIZE_M, TagMount

ENV_TAG_MOUNTS = "DIMOS_AR_TAG_MOUNTS"


def _as_float_triple(value: Any, *, field: str) -> tuple[float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{field} must be a length-3 array")
    return (float(value[0]), float(value[1]), float(value[2]))


def _as_float_quat(value: Any, *, field: str) -> tuple[float, float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError(f"{field} must be a length-4 array")
    return (float(value[0]), float(value[1]), float(value[2]), float(value[3]))


def parse_tag_mounts_json(raw: str) -> list[TagMount]:
    """Parse launcher/bridge mount JSON. Raises ``ValueError`` when malformed."""
    data = json.loads(raw)
    if not isinstance(data, list) or not data:
        raise ValueError("DIMOS_AR_TAG_MOUNTS must be a non-empty JSON array")
    mounts: list[TagMount] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            raise TypeError(f"mount[{i}] must be an object")
        if "tag_id" not in item:
            raise ValueError(f"mount[{i}] missing tag_id")
        tag_id = int(item["tag_id"])
        size_m = float(item["size_m"]) if "size_m" in item else TAG_BLACK_SIZE_M
        position = _as_float_triple(item.get("position", (0.0, 0.0, 0.0)), field=f"mount[{i}].position")
        orientation = _as_float_quat(
            item.get("orientation", (0.0, 0.0, 0.0, 1.0)),
            field=f"mount[{i}].orientation",
        )
        mounts.append(
            TagMount(
                tag_id=tag_id,
                size_m=size_m,
                position=position,
                orientation=orientation,
            )
        )
    return mounts


def resolve_tag_mounts(defaults: list[TagMount]) -> list[TagMount]:
    """Return env overrides when set; otherwise ``defaults``.

    Absent/empty env → defaults. Present but invalid JSON/shape → raise.
    """
    raw = os.environ.get(ENV_TAG_MOUNTS, "").strip()
    if not raw:
        return list(defaults)
    return parse_tag_mounts_json(raw)
