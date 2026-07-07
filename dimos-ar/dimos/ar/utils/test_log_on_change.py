"""Tests for change-key logging helper."""

from __future__ import annotations

from unittest.mock import MagicMock

from dimos.ar.utils.log_on_change import log_info_on_change


def test_log_info_on_change_emits_once_per_key() -> None:
    logger = MagicMock()
    store: dict[str, str] = {}

    log_info_on_change(
        logger,
        store,
        field="state",
        key="idle",
        event="state updated",
        state="idle",
    )
    log_info_on_change(
        logger,
        store,
        field="state",
        key="idle",
        event="state updated",
        state="idle",
    )
    log_info_on_change(
        logger,
        store,
        field="state",
        key="navigating",
        event="state updated",
        state="navigating",
    )

    assert logger.info.call_count == 2
    logger.info.assert_any_call("state updated", state="idle")
    logger.info.assert_any_call("state updated", state="navigating")
