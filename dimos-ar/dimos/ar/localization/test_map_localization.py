"""Exercise the production VPS owner rather than the retired coordinator path."""

import asyncio
import json
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.localization.map_localization import MapLocalization
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.types import LocalizedPose
from dimos.ar.localization.vps.admission import VpsAdmission
from dimos.msgs.geometry_msgs.Pose import Pose
from test_support.localization import _observation


def runtime(localize):
    odometry = SimpleNamespace(generation=0, reference_id="odom")
    worker = BoundedWorker()
    messages = []
    service = MapLocalization(
        odometry=odometry, transforms=OdomMapTransform(), robot_images=SimpleNamespace(),
        marker=None, vps=SimpleNamespace(localize=localize), worker=worker,
        admission=VpsAdmission(), map_code="office",
        send=lambda client, text: messages.append((client, json.loads(text))),
        travel_threshold_m=0.75, heading_threshold_deg=30, marker_preference_s=1.5,
        headset_travel_threshold_m=10, timeout_s=1,
    )
    return service, odometry, worker, messages


async def test_headset_alignment_uses_current_robot_map_and_conservative_confidence():
    service, odometry, worker, messages = runtime(
        AsyncMock(return_value=LocalizedPose(Pose(1, 2, 0), "map", 0.7))
    )
    try:
        assert service._commit_robot(LocalizedPose(Pose(10, 0, 0), "map", 0.9), 10, 0, 0, 0)
        service.connect("client")
        client = service._clients["client"]
        client.reference = "tracking"
        episode = service._request("client", client, "headset")
        await service._headset("client", client, episode, _observation(11))
        result = next(body for _, body in messages if body["type"] == "localization_result")
        assert result["position"] == pytest.approx([-9, 2, 0])
        assert result["confidence"] == 0.7
        assert result["map_alignment"]["tracking_reference_id"] == "tracking"
        assert client.episode is None
    finally:
        await service.close()
        worker.close()


@pytest.mark.parametrize("change", ["disconnect", "source", "reference", "episode"])
async def test_late_headset_query_cannot_publish_after_identity_retirement(change):
    entered, release = asyncio.Event(), asyncio.Event()

    async def localize(_observations):
        entered.set()
        await release.wait()
        return LocalizedPose(Pose(1, 2, 0), "map", 0.8)

    service, odometry, worker, messages = runtime(localize)
    try:
        service._commit_robot(LocalizedPose(Pose(0, 0, 0), "map", 0.9), 10, 0, 0, 0)
        service.connect("client")
        client = service._clients["client"]
        client.reference = "tracking"
        episode = service._request("client", client, "headset")
        task = asyncio.create_task(service._headset("client", client, episode, _observation(11)))
        await entered.wait()
        if change == "disconnect":
            service.disconnect("client")
        elif change == "source":
            odometry.generation += 1
        elif change == "reference":
            client.reference = "replacement"
        else:
            client.episode = None
        release.set()
        await task
        assert not any(body["type"] == "localization_result" for _, body in messages)
    finally:
        release.set()
        await service.close()
        worker.close()


def test_robot_map_commit_rejects_older_samples_source_changes_and_nonfinite_quality():
    service, odometry, worker, _messages = runtime(AsyncMock())
    try:
        good = LocalizedPose(Pose(2, 3, 0), "map", 0.9)
        assert service._commit_robot(good, 10, 0, 0, 0)
        original = service._transforms.vps_sample()
        assert not service._commit_robot(good, 9, 0, 0, 0)
        assert not service._commit_robot(good, 11, 0, 0, 1)
        assert not service._commit_robot(LocalizedPose(Pose(0, 0, 0), "map", float("nan")), 11, 0, 0, 0)
        assert service._transforms.vps_sample() is original
        assert np.allclose(original.T_odom_map[:3, 3], [-2, -3, 0])
    finally:
        worker.close()


async def test_vendor_response_to_robot_and_headset_alignment_randomized() -> None:
    import cv2
    from scipy.spatial.transform import Rotation

    from dimos.ar.localization.types import Intrinsics, Observation
    from dimos.ar.localization.vps.localizer import VpsLocalizer
    from dimos.ar.localization.vps.multiset_client import _result_from_payload
    from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
    from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

    rng = np.random.default_rng(617)
    responses = []

    class Vendor:
        async def query(self, **_kwargs):
            return _result_from_payload(responses.pop(0))

        async def close(self):
            pass

    # Independent axis matrices used to construct vendor JSON fixtures.
    vendor_to_zup = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    optical_to_vendor = np.diag([1, -1, -1, 1])

    def transform(*, tilted=False):
        matrix = np.eye(4)
        matrix[:3, :3] = (
            Rotation.random(random_state=rng).as_matrix()
            if tilted
            else Rotation.from_euler("z", rng.uniform(-math.pi, math.pi)).as_matrix()
        )
        matrix[:3, 3] = rng.uniform(-10, 10, 3)
        return matrix

    def response(optical_in_map):
        vendor = np.linalg.inv(vendor_to_zup) @ optical_in_map @ optical_to_vendor
        xyz = vendor[:3, 3]
        quat = Rotation.from_matrix(vendor[:3, :3]).as_quat()
        return {
            "poseFound": True,
            "position": dict(zip("xyz", xyz, strict=True)),
            "rotation": dict(zip(("x", "y", "z", "w"), quat, strict=True)),
            "confidence": 0.9,
        }

    ok, encoded = cv2.imencode(".jpg", np.zeros((16, 16, 3), dtype=np.uint8))
    assert ok
    intrinsics = Intrinsics(10, 10, 8, 8, 16, 16, "none", ())
    worker = BoundedWorker()
    localizer = VpsLocalizer(client=Vendor(), worker=worker)
    service, odometry, unused_worker, messages = runtime(localizer.localize)
    unused_worker.close()
    try:
        for _ in range(300):
            expected_origin = transform()
            odom_in_map = transform()
            body_in_odom = transform(tilted=True)
            optical_in_client = transform(tilted=True)
            optical_in_odom = body_in_odom @ UNITREE_GO2_PROFILE.T_base_camera_optical
            responses.extend(
                [
                    response(odom_in_map @ optical_in_odom),
                    response(odom_in_map @ expected_origin @ optical_in_client),
                ]
            )
            service.reset()
            robot = await localizer.localize([Observation(
                encoded.tobytes(), intrinsics, matrix_to_pose(optical_in_odom), 100
            )])
            assert robot is not None
            assert service._commit_robot(robot, 100, 0, 0, odometry.generation)
            service.connect("client")
            client = service._clients["client"]
            client.reference = "tracking"
            episode = service._request("client", client, "headset")
            messages.clear()
            await service._headset("client", client, episode, Observation(
                encoded.tobytes(), intrinsics, matrix_to_pose(optical_in_client), 100
            ))
            result = next(body for _, body in messages if body["type"] == "localization_result")
            actual = pose_to_matrix(Pose(*result["position"], *result["orientation"]))
            assert np.allclose(actual, expected_origin, atol=1e-9)
    finally:
        await service.close()
        await localizer.close()
        worker.close()
