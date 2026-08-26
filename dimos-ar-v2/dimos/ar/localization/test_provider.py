from __future__ import annotations

from collections.abc import Sequence

from dimos.ar.localization.provider import (
    AlignmentProvider,
    Intrinsics,
    Localization,
    Observation,
)
from dimos.msgs.geometry_msgs.Pose import Pose


class _FixedProvider:
    def localize(self, observations: Sequence[Observation]) -> Localization | None:
        if not observations:
            return None
        return Localization(
            pose=Pose(1.0, 2.0, 3.0),
            frame_id="odom",
            confidence=0.9,
        )


def test_alignment_provider_protocol() -> None:
    provider: AlignmentProvider = _FixedProvider()
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
        capture_ts=100.0,
    )

    result = provider.localize([observation])

    assert result is not None
    assert result.frame_id == "odom"
    assert result.confidence == 0.9
    assert result.pose.x == 1.0
    assert result.pose.y == 2.0
    assert result.pose.z == 3.0


def test_localize_empty_observations_returns_none() -> None:
    provider: AlignmentProvider = _FixedProvider()

    assert provider.localize([]) is None
