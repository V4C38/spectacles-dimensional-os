from __future__ import annotations

import asyncio
from unittest.mock import Mock

import numpy as np
import pytest

from dimos.ar.localization.native import NativeMapAdapter, NativeMapSample
from dimos.msgs.geometry_msgs.Transform import Transform


def _buffer(matrix: np.ndarray, ts: float = 100.0) -> Mock:
    return Mock(get=Mock(return_value=Transform.from_matrix(
        matrix, ts=ts, frame_id="world", child_frame_id="map"
    )))


def test_native_map_inverts_tf_once_and_ignores_periodic_republication() -> None:
    world_map = np.array([
        [0, -1, 0, 3], [1, 0, 0, 4], [0, 0, 1, 0.5], [0, 0, 0, 1],
    ], dtype=float)
    adapter = NativeMapAdapter("saved-office")
    buffer = _buffer(world_map)
    sample = adapter.poll(buffer)
    assert sample is not None
    assert sample.native_map_id == "saved-office"
    assert sample.ts_server == 100.0
    np.testing.assert_allclose(sample.T_native_odom @ world_map, np.eye(4), atol=1e-12)
    assert not sample.T_native_odom.flags.writeable
    buffer.get.assert_called_once_with("world", "map", warn=False)
    buffer.get.return_value = Transform.from_matrix(world_map, ts=110.0)
    assert adapter.poll(buffer) is None
    world_map[0, 3] += 1
    buffer.get.return_value = Transform.from_matrix(world_map, ts=120.0)
    assert adapter.poll(buffer) is not None


def test_native_map_waits_for_transform_and_validates_identity() -> None:
    with pytest.raises(ValueError, match="identity"):
        NativeMapAdapter(" ")
    adapter = NativeMapAdapter("office")
    assert adapter.poll(Mock(get=Mock(return_value=None))) is None
    buffer = Mock(get=Mock(return_value=Mock(ts=100.0, to_matrix=lambda: np.zeros((4, 4)))))
    assert adapter.poll(buffer) is None
    assert adapter.poll(_buffer(np.eye(4), ts=float("nan"))) is None


@pytest.mark.asyncio
async def test_native_map_lifecycle_retries_unaccepted_fix_and_stops_polling() -> None:
    adapter = NativeMapAdapter("office")
    buffer = _buffer(np.eye(4))
    accepted = asyncio.Event()
    calls = 0

    def on_sample(sample: NativeMapSample) -> bool:
        nonlocal calls
        calls += 1
        if calls == 2:
            accepted.set()
            return True
        return False

    adapter.start(buffer, on_sample)
    adapter.start(buffer, on_sample)
    await asyncio.wait_for(accepted.wait(), timeout=1)
    await adapter.close()
    reads = buffer.get.call_count
    await asyncio.sleep(0.12)
    assert buffer.get.call_count == reads
    assert calls == 2
    await adapter.close()


def test_source_retirement_rejects_even_freshly_republished_old_native_fix() -> None:
    adapter = NativeMapAdapter("office")
    assert adapter.poll(_buffer(np.eye(4))) is not None
    adapter.reset()
    assert adapter.poll(_buffer(np.eye(4), ts=200)) is None
    replacement = NativeMapAdapter("office")
    assert replacement.poll(_buffer(np.eye(4), ts=200)) is not None


def test_native_map_projects_small_tilt_and_rejects_excessive_tilt() -> None:
    import math

    def tilted(degrees: float) -> np.ndarray:
        angle = math.radians(degrees)
        c, s = math.cos(angle), math.sin(angle)
        return np.array([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]])

    sample = NativeMapAdapter("office").poll(_buffer(tilted(2)))
    assert sample is not None
    np.testing.assert_allclose(sample.T_native_odom, np.eye(4), atol=1e-12)
    assert NativeMapAdapter("office").poll(_buffer(tilted(8))) is None
