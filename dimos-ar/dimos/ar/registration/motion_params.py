"""Build-time baseline motion parameter resolution.

Registration hot paths must not call adapter RPC for motion parameters. Resolve
strafe speed once while ARBridge builds, with a strict deadline and default
that matches the known-good baseline behavior.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import time

from dimos.ar.bridge import adapter_rpc
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

DEFAULT_BASELINE_STRAFE_SPEED: float = 0.3


@dataclass(frozen=True)
class BaselineMotionParams:
    strafe_speed: float = DEFAULT_BASELINE_STRAFE_SPEED


def resolve_baseline_motion_params(
    adapter: object,
    *,
    timeout_s: float = 2.0,
) -> BaselineMotionParams:
    """Resolve baseline strafe speed with default on timeout or failure."""
    deadline = time.monotonic() + timeout_s
    strafe_speed = DEFAULT_BASELINE_STRAFE_SPEED
    speed_result, speed_error = adapter_rpc.call_with_timeout(
        adapter,
        "baseline_strafe_speed",
        timeout_s=_remaining(deadline),
    )
    if speed_error is not None:
        logger.warning(
            "baseline_strafe_speed failed; using default",
            error=str(speed_error),
            default=strafe_speed,
        )
    elif speed_result is None:
        logger.warning(
            "baseline_strafe_speed timed out; using default",
            timeout_s=timeout_s,
            default=strafe_speed,
        )
    else:
        try:
            parsed_speed = float(speed_result)
            if math.isfinite(parsed_speed) and parsed_speed > 0:
                strafe_speed = parsed_speed
        except (TypeError, ValueError):
            logger.warning(
                "baseline_strafe_speed invalid; using default",
                value=repr(speed_result),
                default=strafe_speed,
            )

    params = BaselineMotionParams(strafe_speed=strafe_speed)
    logger.info(
        "Baseline motion params resolved",
        strafe_speed=params.strafe_speed,
    )
    return params


def _remaining(deadline: float) -> float:
    return max(0.0, deadline - time.monotonic())
