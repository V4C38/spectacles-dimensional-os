"""Change-key helpers for throttled lifecycle logging."""

from __future__ import annotations

from typing import Any


def log_info_on_change(
    logger: Any,
    store: dict[str, str],
    *,
    field: str,
    key: str,
    event: str,
    **fields: object,
) -> None:
    """Emit ``logger.info(event, **fields)`` only when ``key`` differs from the last value."""
    if store.get(field) == key:
        return
    store[field] = key
    logger.info(event, **fields)
