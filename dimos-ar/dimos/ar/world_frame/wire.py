"""World-frame wire encode/decode."""

from __future__ import annotations

import json
import time
from typing import Any


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


def encode_world_frame_correction(
    *,
    ts: float | None,
    trans_delta_m: float,
    yaw_delta_deg: float | None,
    yaw_corrected: bool,
    solve_quality: float,
    solve_method: str,
    alignment_confidence: float | None = None,
    yaw_observable: bool | None = None,
    scale_observable: bool | None = None,
    scale_confidence: float | None = None,
    yaw_confidence: float | None = None,
    scale_held: bool | None = None,
    yaw_held: bool | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "world_frame_correction",
        "ts": round(ts, 3) if ts is not None else time.time(),
        "trans_delta_m": round(float(trans_delta_m), 4),
        "yaw_corrected": yaw_corrected,
        "solve_quality": round(float(solve_quality), 4),
        "solve_method": solve_method,
    }
    if yaw_delta_deg is not None:
        payload["yaw_delta_deg"] = round(float(yaw_delta_deg), 3)
    if alignment_confidence is not None:
        payload["alignment_confidence"] = round(float(alignment_confidence), 4)
    if yaw_observable is not None:
        payload["yaw_observable"] = bool(yaw_observable)
    if scale_observable is not None:
        payload["scale_observable"] = bool(scale_observable)
    if scale_confidence is not None:
        payload["scale_confidence"] = round(float(scale_confidence), 4)
    if yaw_confidence is not None:
        payload["yaw_confidence"] = round(float(yaw_confidence), 4)
    if scale_held is not None:
        payload["scale_held"] = bool(scale_held)
    if yaw_held is not None:
        payload["yaw_held"] = bool(yaw_held)
    return _dumps(payload)
