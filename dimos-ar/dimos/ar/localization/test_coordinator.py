from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pytest

from dimos.ar.localization.coordinator import LocalizationCoordinator
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import Intrinsics, LocalizedPose, Observation
from dimos.ar.localization.vps.robot_observation_buffer import (
    RobotObservationBuffer,
    RobotObservationSample,
)
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3


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
    robot_observations = RobotObservationBuffer(
        pose_buffer=PoseBuffer(),
        T_base_camera_optical=np.eye(4),
    )
    if robot_sample is not None:
        robot_observations._samples.append(robot_sample)
    return LocalizationCoordinator(
        policy=policy,
        odom_map_transform=odom_map_transform,
        robot_observations=robot_observations,
        marker=marker,
        vps=vps,
        odom_scale_correction_factor=1.25,
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

    assert outcome.result is not None
    assert outcome.used_vps is False
    assert outcome.result.position == (1.25, 2.5, 3.0)
    assert outcome.result.ts_server == 100.0


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
    assert outcome.result is not None


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
    assert outcome.result is None
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

    assert outcome.result is None
    assert outcome.defer_vps is False
    assert outcome.used_vps is True


def test_on_relocalization_transform_stores_sample() -> None:
    coordinator = _coordinator(providers=[])
    transform = Transform(
        translation=Vector3(5.0, 0.0, 0.0),
        rotation=Quaternion(0.0, 0.0, 0.0, 1.0),
        frame_id="odom",
        child_frame_id="map",
        ts=42.0,
    )

    assert coordinator.on_relocalization_transform(transform, ts_server=100.0) is True
    sample = coordinator._odom_map_transform.relocalization_sample()
    assert sample is not None
    assert sample.confidence is None
    assert sample.ts_server == pytest.approx(100.0)


def test_result_in_odom_rejects_non_odom_frame() -> None:
    coordinator = _coordinator(providers=["fiducial_marker"])
    with pytest.raises(ValueError, match="odom"):
        coordinator._result_in_odom(
            LocalizedPose(pose=Pose(0.0, 0.0, 0.0), frame_id="map", confidence=1.0),
            1.0,
        )
