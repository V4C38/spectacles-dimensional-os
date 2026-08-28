from __future__ import annotations

from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.types import (
    CapturePolicy,
    Intrinsics,
    LocalizationProviderType,
    Observation,
)
from dimos.msgs.geometry_msgs.Pose import Pose


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
    assert policy.capture_spec.capture_policy is CapturePolicy.ROBOT_LOS_PREFERRED
    assert policy.capture_spec.observation_count == 3
    assert policy.capture_spec.wait_timeout_s == 2.0


def test_marker_only_capture_spec() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ROBOT_LOS_REQUIRED
    assert policy.capture_spec.wait_timeout_s is None


def test_vps_only_capture_spec() -> None:
    policy = LocalizationPolicy(["vps"])
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ANY_ANGLE
    assert policy.capture_spec.observation_count == 1


def test_hello_prompts_when_provider_configured() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    assert policy.on_hello("c1") == "c1"
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ROBOT_LOS_REQUIRED
    assert policy.on_hello("c1") is None


def test_no_providers_does_not_prompt() -> None:
    policy = LocalizationPolicy([])
    assert policy.on_hello("c1") is None


def test_goal_reached_requires_travel_since_last_success() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_success("c1")
    policy.on_odom(0.0, 0.0)
    policy.on_odom(0.4, 0.0)
    assert policy.on_goal_reached(succeeded=True) == []
    policy.on_odom(1.1, 0.0)
    client_ids = policy.on_goal_reached(succeeded=True)
    assert client_ids == ["c1"]


def test_failed_goal_reached_does_not_prompt() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_success("c1")
    policy.on_odom(0.0, 0.0)
    policy.on_odom(2.0, 0.0)
    assert policy.on_goal_reached(succeeded=False) == []


def test_vps_only_waits_for_global_cooldown_before_prompt() -> None:
    clock = _Clock(0.0)
    policy = LocalizationPolicy(["vps"], clock=clock)
    policy.begin_client_vps()
    assert policy.on_hello("c1") is None
    clock.t = 29.0
    prompts, _episodes = policy.poll()
    assert prompts == []
    clock.t = 30.0
    client_ids, _episodes = policy.poll()
    assert client_ids == ["c1"]
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ANY_ANGLE


def test_mixed_defers_vps_until_global_cooldown() -> None:
    clock = _Clock(0.0)
    policy = LocalizationPolicy(["fiducial_marker", "vps"], clock=clock)
    assert policy.on_hello("c1") == "c1"
    policy.begin_client_vps()
    work = policy.on_observations("c1", [_observation()])
    assert work is not None
    policy.hold_for_client_vps("c1", work.observations)
    clock.t = 10.0
    _prompts, episodes = policy.poll()
    assert episodes == []
    clock.t = 30.0
    _prompts, episodes = policy.poll()
    assert len(episodes) == 1
    assert episodes[0].client_id == "c1"


def test_client_and_robot_vps_cooldowns_are_separate() -> None:
    clock = _Clock(0.0)
    policy = LocalizationPolicy(["vps"], clock=clock)
    policy.begin_client_vps()
    assert policy.client_vps_ready() is False
    assert policy.robot_vps_ready() is True
    policy.begin_robot_vps()
    clock.t = 30.0
    assert policy.client_vps_ready() is True
    assert policy.robot_vps_ready() is True


def test_disconnect_drops_pending_episode() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_disconnect("c1")
    assert policy.on_observations("c1", [_observation()]) is None
    assert policy.on_hello("c1") == "c1"


def test_start_request_opens_same_capture_path() -> None:
    policy = LocalizationPolicy(["vps"])
    assert policy.on_start_request("c1") == "c1"
    assert policy.capture_spec is not None
    assert policy.capture_spec.capture_policy is CapturePolicy.ANY_ANGLE
