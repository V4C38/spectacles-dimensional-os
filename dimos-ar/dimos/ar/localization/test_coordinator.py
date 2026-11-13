from __future__ import annotations

import threading

import pytest

from dimos.ar.localization.types import LocalizedPose
from dimos.msgs.geometry_msgs.Pose import Pose
from test_support.localization import _coordinator, _FixedLocalizer, _observation


async def test_marker_success_preserves_metric_alignment() -> None:
    marker = _FixedLocalizer(
        LocalizedPose(
            pose=Pose(1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="odom",
            confidence=0.8,
        )
    )
    coordinator = _coordinator(marker=marker)
    coordinator._clock = lambda: 100.0
    outcome = await coordinator.run([_observation(ts_server=100.0)])

    assert outcome.result is not None
    assert outcome.result.position == (1.0, 2.0, 3.0)
    assert outcome.result.ts_server == 100.0


def test_result_in_odom_rejects_non_odom_frame() -> None:
    coordinator = _coordinator()
    with pytest.raises(ValueError, match="odom"):
        coordinator._result_in_odom(
            LocalizedPose(pose=Pose(0.0, 0.0, 0.0), frame_id="map", confidence=1.0),
            1.0,
        )


async def test_marker_snapshot_is_created_on_owner_loop_before_worker_dispatch() -> None:
    calls = []
    owner_thread = threading.get_ident()
    result = LocalizedPose(pose=Pose(1, 2, 3), frame_id="odom", confidence=0.8)

    class Frozen:
        def localize(self, observations):
            calls.append(("localize", threading.get_ident(), tuple(observations)))
            return result

    class Marker:
        def snapshot(self):
            calls.append(("snapshot", threading.get_ident(), ()))
            return Frozen()

        def localize(self, observations):
            raise AssertionError("the live provider must not run on the worker")

    coordinator = _coordinator()
    coordinator._marker = Marker()
    coordinator._clock = lambda: 10.0
    try:
        outcome = await coordinator.run([_observation()])
        assert outcome.result.position == (1, 2, 3)
        assert calls[0] == ("snapshot", owner_thread, ())
        assert calls[1][0] == "localize"
        assert calls[1][1] != owner_thread
        assert len(calls[1][2]) == 1
    finally:
        await coordinator.close()
