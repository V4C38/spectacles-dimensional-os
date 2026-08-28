from __future__ import annotations

from collections.abc import Sequence
import json

import numpy as np
import pytest

from dimos.ar.localization.coordinator import LocalizationCoordinator
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.robot_pose_buffer import RobotPoseBuffer
from dimos.ar.localization.types import Intrinsics, LocalizedPose, Observation
from dimos.ar.localization.vps.robot_observation_buffer import (
    RobotObservationBuffer,
    RobotObservationSample,
)
from dimos.msgs.geometry_msgs.Pose import Pose


def _observation(ts_server: float = 10.0) -> Observation:
    return Observation(
        jpeg=b"jpeg",
        intrinsics=Intrinsics(
            fx=100.0,
            fy=100.0,
            cx=50.0,
            cy=50.0,
            width=100,
            height=100,
            distortion_model="none",
            distortion=(),
        ),
        camera_pose=Pose(0.0, 0.0, 0.0),
        ts_server=ts_server,
    )


class _FixedLocalizer:
    def __init__(self, result: LocalizedPose | None) -> None:
        self.result = result
        self.calls: list[list[Observation]] = []

    def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None:
        self.calls.append(list(observations))
        return self.result


def _coordinator(
    *,
    providers: list[str],
    marker: _FixedLocalizer | None = None,
    vps: _FixedLocalizer | None = None,
    robot_sample: RobotObservationSample | None = None,
) -> LocalizationCoordinator:
    policy = LocalizationPolicy(providers)
    odom_map_transform = OdomMapTransform()
    robot_buffer = RobotObservationBuffer(
        robot_pose_buffer=RobotPoseBuffer(),
        T_base_camopt=np.eye(4),
    )
    if robot_sample is not None:
        robot_buffer._samples.append(robot_sample)
    return LocalizationCoordinator(
        policy=policy,
        odom_map_transform=odom_map_transform,
        robot_buffer=robot_buffer,
        marker=marker,
        vps=vps,
        odom_correction_factor=1.25,
        map_code="office",
    )


def test_marker_success_applies_xy_scale() -> None:
    marker = _FixedLocalizer(
        LocalizedPose(
            pose=Pose(1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="odom",
            confidence=0.8,
        )
    )
    coordinator = _coordinator(providers=["fiducial_marker"], marker=marker)
    outcome = coordinator.run([_observation(ts_server=100.0)])

    assert outcome.payload is not None
    assert outcome.used_vps is False
    msg = json.loads(outcome.payload.strip())
    assert msg["type"] == "localization_result"
    assert msg["position"] == [1.25, 2.5, 3.0]
    assert msg["ts"] == 100.0


def test_mixed_falls_through_to_vps_on_newest_observation() -> None:
    marker = _FixedLocalizer(None)
    vps = _FixedLocalizer(
        LocalizedPose(
            pose=Pose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        )
    )
    first = _observation(ts_server=1.0)
    newest = _observation(ts_server=3.0)
    robot = RobotObservationSample(observation=_observation(ts_server=2.0), travel_m=0.0)
    coordinator = _coordinator(
        providers=["fiducial_marker", "vps"],
        marker=marker,
        vps=vps,
        robot_sample=robot,
    )

    outcome = coordinator.run([first, newest])

    assert marker.calls and len(marker.calls[0]) == 2
    assert vps.calls[0][0] is robot.observation
    assert vps.calls[1][0] is newest
    assert outcome.used_vps is True
    assert outcome.payload is not None


def test_vps_defers_during_client_cooldown() -> None:
    vps = _FixedLocalizer(
        LocalizedPose(
            pose=Pose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        )
    )
    coordinator = _coordinator(providers=["vps"], vps=vps)
    coordinator._policy.begin_client_vps()

    outcome = coordinator.run([_observation()])

    assert outcome.defer_vps is True
    assert outcome.payload is None
    assert vps.calls == []


def test_vps_fails_without_robot_observation() -> None:
    vps = _FixedLocalizer(
        LocalizedPose(
            pose=Pose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="map",
            confidence=0.9,
        )
    )
    coordinator = _coordinator(providers=["vps"], vps=vps)

    outcome = coordinator.run([_observation()])

    assert outcome.payload is None
    assert outcome.defer_vps is False
    assert outcome.used_vps is True


def test_encode_rejects_non_odom_frame() -> None:
    coordinator = _coordinator(providers=["fiducial_marker"])
    with pytest.raises(ValueError, match="odom"):
        coordinator._encode_odom(
            LocalizedPose(pose=Pose(0.0, 0.0, 0.0), frame_id="map", confidence=1.0),
            1.0,
        )
