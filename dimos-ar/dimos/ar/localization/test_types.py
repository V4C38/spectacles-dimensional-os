from __future__ import annotations

from collections.abc import Sequence

from dimos.ar.localization.types import (
    CapturePolicy,
    Intrinsics,
    LocalizationProviderType,
    LocalizedPose,
    Localizer,
    Observation,
)
from dimos.msgs.geometry_msgs.Pose import Pose


class _FixedLocalizer:
    def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None:
        if not observations:
            return None
        return LocalizedPose(
            pose=Pose(1.0, 2.0, 3.0),
            frame_id="odom",
            confidence=0.9,
        )


def test_localizer_protocol() -> None:
    localizer: Localizer = _FixedLocalizer()
    observation = Observation(
        jpeg=b"\xff\xd8\xff",
        intrinsics=Intrinsics(
            fx=500.0,
            fy=500.0,
            cx=640.0,
            cy=360.0,
            width=1280,
            height=720,
            distortion_model="none",
            distortion=(),
        ),
        camera_pose=Pose(0.0, 0.0, 1.5),
        ts_server=100.0,
    )

    result = localizer.localize([observation])

    assert result is not None
    assert result.frame_id == "odom"
    assert result.confidence == 0.9
    assert result.pose.x == 1.0
    assert result.pose.y == 2.0
    assert result.pose.z == 3.0


def test_localize_empty_observations_returns_none() -> None:
    localizer: Localizer = _FixedLocalizer()

    assert localizer.localize([]) is None


def test_capture_policy_wire_values() -> None:
    assert CapturePolicy.ROBOT_LOS_REQUIRED == "robot_los_required"
    assert CapturePolicy.ROBOT_LOS_PREFERRED == "robot_los_preferred"
    assert CapturePolicy.ANY_ANGLE == "any_angle"
    assert CapturePolicy("any_angle") is CapturePolicy.ANY_ANGLE


def test_localization_provider_type_wire_values() -> None:
    assert LocalizationProviderType.FIDUCIAL_MARKER == "fiducial_marker"
    assert LocalizationProviderType.VPS == "vps"
