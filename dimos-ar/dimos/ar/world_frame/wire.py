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
    return _dumps(payload)
