from __future__ import annotations

from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.types import (
    CapturePolicy,
    Intrinsics,
    LocalizationProviderType,
    Observation,
)
from dimos.msgs.geometry_msgs.Pose import Pose
from test_support.localization import _advance


class _Clock:
    def __init__(self, t: float = 0.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def _observation(ts_server: float = 1.0) -> Observation:
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


def test_config_order_does_not_change_provider_order() -> None:
    policy = LocalizationPolicy(["vps", "fiducial_marker"])
    assert policy.providers == (
        LocalizationProviderType.FIDUCIAL_MARKER,
        LocalizationProviderType.VPS,
    )
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ROBOT_LOS_REQUIRED
    assert policy.capture_spec.observation_count == 3
    assert policy.capture_spec.wait_timeout_s is None


def test_marker_only_capture_spec() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ROBOT_LOS_REQUIRED
    assert policy.capture_spec.wait_timeout_s is None




def test_hello_prompts_when_provider_configured() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    assert policy.on_hello("c1") == "c1"
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ROBOT_LOS_REQUIRED
    assert policy.on_hello("c1") is None


def test_no_providers_does_not_prompt() -> None:
    policy = LocalizationPolicy([])
    assert policy.on_hello("c1") is None


def test_travel_prompts_at_075m_without_waiting_for_goal_reached() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_success("c1")
    _advance(policy, 0.0, 0.0)
    _advance(policy, 0.4, 0.0)
    assert policy.on_goal_reached(succeeded=True) == []
    assert _advance(policy, 0.749, 0.0) == []
    assert _advance(policy, 0.75, 0.0) == ["c1"]
    assert policy.on_goal_reached(succeeded=True) == []
    assert _advance(policy, 1.5, 0.0) == []  # Already pending.
    policy.on_success("c1")
    assert _advance(policy, 2.249, 0.0) == []
    assert _advance(policy, 2.25, 0.0) == ["c1"]


def test_travel_is_cumulative_and_disconnected_clients_are_not_prompted() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_hello("gone")
    policy.on_success("c1")
    policy.on_success("gone")
    policy.on_disconnect("gone")
    _advance(policy, 0.0, 0.0)
    assert _advance(policy, 0.5, 0.0) == []
    assert _advance(policy, 0.5, 0.25) == ["c1"]


def test_start_retry_reissues_pending_prompt() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    assert policy.on_hello("c1") == "c1"
    assert policy.on_start_request("c1") == "c1"


def test_failed_goal_reached_does_not_prompt() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_success("c1")
    _advance(policy, 0.0, 0.0)
    _advance(policy, 2.0, 0.0)
    assert policy.on_goal_reached(succeeded=False) == []








def test_disconnect_drops_pending_episode() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_disconnect("c1")
    assert policy.on_observations("c1", [_observation()]) is None
    assert policy.on_hello("c1") == "c1"


def test_start_request_opens_same_capture_path() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    assert policy.on_start_request("c1") == "c1"
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ROBOT_LOS_REQUIRED
