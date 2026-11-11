import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from dimos.ar.localization.map_localization import MapLocalization
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import LocalizedPose
from dimos.ar.localization.vps.admission import VpsAdmission
from dimos.ar.websocket.protocol import LocalizationCaptureProgress, LocalizationTracking, TimeSync
from dimos.ar.worker import BoundedWorker
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from test_support.localization import _observation


@pytest.mark.asyncio
async def test_public_capture_submission_retains_relative_fix_and_retires_late_generation():
    now = [100.0]
    history = PoseBuffer()
    for stamp in [99.95, 100.05]:
        history.push(PoseStamped(ts=stamp), ts_server=stamp)
    odometry = SimpleNamespace(generation=0, reference_id="source", history=history,
                               travel=lambda: 0)
    worker = BoundedWorker()
    messages = []
    marker = SimpleNamespace(localize=lambda observations: LocalizedPose(Pose(1, 2, 0), "odom", .8))
    marker.snapshot = lambda: marker
    service = MapLocalization(
        odometry=odometry, transforms=OdomMapTransform(),
        robot_images=SimpleNamespace(newest=lambda **kwargs: None), marker=marker,
        vps=SimpleNamespace(localize=AsyncMock()), worker=worker,
        admission=VpsAdmission(clock=lambda: now[0], wall_clock=lambda: now[0]),
        map_code="office", send=lambda key, text: messages.append(json.loads(text)),
        travel_threshold_m=.75, heading_threshold_deg=30, marker_preference_s=3,
        headset_travel_threshold_m=10, timeout_s=12,
        clock=lambda: now[0], wall_clock=lambda: now[0],
    )
    try:
        service.connect("a")
        service.progress(LocalizationTracking("tracking", 0, True), "a", TimeSync(0, 0))
        service._tick()
        await asyncio.gather(*service._jobs)
        service._tick()
        request = next(item for item in messages if item["type"] == "localization_observations_request")
        service.progress(LocalizationCaptureProgress(request["episode_id"], "capturing", 0),
                         "a", TimeSync(0, 0))
        service.progress(LocalizationCaptureProgress(request["episode_id"], "submitted", 0, 100.02),
                         "a", TimeSync(0, 0))
        service.observations([_observation(stamp) for stamp in [99.98, 100, 100.02]], "a")
        await asyncio.gather(*service._jobs)
        result = next(item for item in messages if item["type"] == "localization_result")
        assert result["ts"] == 100.02
        assert result["position"] == [1, 2, 0]
        assert "map_alignment" not in result and "map_transform" not in result
        count = len(messages)
        service._tick()
        assert len(messages) == count
        service.progress(LocalizationTracking("tracking", 10, True), "a", TimeSync(0, 0))
        service._tick()
        assert messages[-1]["type"] == "localization_observations_request"
        episode = messages[-1]["episode_id"]
        service.progress(LocalizationTracking("replacement", 0, True), "a", TimeSync(0, 0))
        service.progress(LocalizationCaptureProgress(episode, "submitted", 10, 100.02),
                         "a", TimeSync(0, 0))
        service.observations([_observation(100.02)], "a")
        assert sum(item["type"] == "localization_result" for item in messages) == 1
    finally:
        await service.close()
        worker.close()
