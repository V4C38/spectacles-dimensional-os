"""Tests for tag_tracking/solve.py geometry helpers."""

from __future__ import annotations

import pytest

from dimos.ar.tag_tracking.solve import (
    CAPTURE_MAX_DISTANCE_MARGIN,
    TAG_TOTAL_SIZE_M,
    capture_max_stream_distance_m,
    max_detection_distance_m,
)


def test_max_detection_distance_m() -> None:
    assert max_detection_distance_m(560.0, 0.070, 24.0) == pytest.approx(1.6333, abs=1e-4)
    assert max_detection_distance_m(560.0, 0.056, 28.0) == pytest.approx(1.12)


def test_capture_max_stream_distance_m_applies_margin() -> None:
    base = max_detection_distance_m(560.0, TAG_TOTAL_SIZE_M, 24.0)
    assert capture_max_stream_distance_m(560.0, TAG_TOTAL_SIZE_M, 24.0) == pytest.approx(
        base * CAPTURE_MAX_DISTANCE_MARGIN,
    )
    assert capture_max_stream_distance_m(560.0, TAG_TOTAL_SIZE_M, 24.0) == pytest.approx(
        2.0417,
        abs=1e-4,
    )


def test_max_detection_distance_m_rejects_non_positive_inputs() -> None:
    with pytest.raises(ValueError, match="positive"):
        max_detection_distance_m(0.0, 0.056, 28.0)
    with pytest.raises(ValueError, match="positive"):
        max_detection_distance_m(560.0, 0.0, 28.0)
    with pytest.raises(ValueError, match="positive"):
        max_detection_distance_m(560.0, 0.056, 0.0)


def test_capture_max_stream_distance_m_rejects_non_positive_margin() -> None:
    with pytest.raises(ValueError, match="positive margin"):
        capture_max_stream_distance_m(560.0, TAG_TOTAL_SIZE_M, 24.0, margin=0.0)
