from __future__ import annotations

from collections.abc import Sequence
import math


def finite_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be finite")  # noqa: TRY004 — wire validators promise ValueError
    try:
        result = float(value)
    except OverflowError as exc:
        raise ValueError(f"{name} must be finite") from exc
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def required_identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError(f"{name} must contain 1 to 128 characters")
    return value


def nonnegative_integer(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer")
    return value


def finite_vector(value: object, name: str, count: int) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != count:
        raise ValueError(f"{name} must contain {count} numbers")
    return tuple(finite_number(component, name) for component in value)


def quaternion_yaw(orientation: Sequence[float]) -> float:
    x, y, z, w = orientation
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def wrapped_angle(angle: float) -> float:
    return math.atan2(math.sin(angle), math.cos(angle))


def measurement_is_fresh(timestamp: float, now: float, max_age: float) -> bool:
    return 0 <= now - timestamp <= max_age
