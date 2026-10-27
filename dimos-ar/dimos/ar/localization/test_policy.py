from __future__ import annotations

from weakref import WeakKeyDictionary

from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import (
    CapturePolicy,
    Intrinsics,
    LocalizationProviderType,
    Observation,
)
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

_histories: WeakKeyDictionary[LocalizationPolicy, PoseBuffer] = WeakKeyDictionary()


def _advance(policy: LocalizationPolicy, x: float, y: float):
    if policy not in _histories:
        history = PoseBuffer()
        _histories[policy] = history
        policy._travel = lambda: history.latest().travel_m if history.latest() else 0.0
    history = _histories[policy]
    latest = history.latest()
    timestamp = latest.ts_server + 0.1 if latest else 0.0
    history.push(PoseStamped(ts=timestamp, position=[x, y, 0]))
    return policy.on_odom()


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


def test_travel_prompts_at_075m_without_waiting_for_goal_reached() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_success("c1")
    _advance(policy, 0.0, 0.0)
    _advance(policy, 0.4, 0.0)
    assert policy.on_goal_reached(succeeded=True) == []
    assert _advance(policy, 0.749, 0.0) == ([], [])
    assert _advance(policy, 0.75, 0.0) == (["c1"], [])
    assert policy.on_goal_reached(succeeded=True) == []
    assert _advance(policy, 1.5, 0.0) == ([], [])  # Already pending.
    policy.on_success("c1")
    assert _advance(policy, 2.249, 0.0) == ([], [])
    assert _advance(policy, 2.25, 0.0) == (["c1"], [])


def test_travel_is_cumulative_and_disconnected_clients_are_not_prompted() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_hello("gone")
    policy.on_success("c1")
    policy.on_success("gone")
    policy.on_disconnect("gone")
    _advance(policy, 0.0, 0.0)
    assert _advance(policy, 0.5, 0.0) == ([], [])
    assert _advance(policy, 0.5, 0.25) == (["c1"], [])


def test_start_retry_reissues_pending_prompt_but_respects_vps_cooldown() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    assert policy.on_hello("c1") == "c1"
    assert policy.on_start_request("c1") == "c1"
    clock = _Clock()
    vps = LocalizationPolicy(["vps"], clock=clock)
    vps.begin_client_vps()
    assert vps.on_hello("c1") is None
    assert vps.on_start_request("c1") is None


def test_failed_goal_reached_does_not_prompt() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("c1")
    policy.on_success("c1")
    _advance(policy, 0.0, 0.0)
    _advance(policy, 2.0, 0.0)
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
    policy.defer_vps("c1")
    clock.t = 10.0
    _prompts, episodes = policy.poll()
    assert episodes == []
    clock.t = 30.0
    prompts, episodes = policy.poll()
    assert prompts == ["c1"]
    assert episodes == []  # Fresh capture, never queued JPEGs.


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


def test_vps_turns_are_fifo_across_cooldown_and_repeated_requests() -> None:
    clock = _Clock()
    policy = LocalizationPolicy(["vps"], clock=clock)
    assert policy.on_hello("first") == "first"
    assert policy.on_hello("second") is None
    assert policy.client_vps_ready("first")
    assert not policy.client_vps_ready("second")
    policy.begin_client_vps("first")
    policy.on_success("first")
    # First client reconnecting/retrying cannot jump ahead of the waiting client.
    assert policy.on_start_request("first") is None
    clock.t = 30
    assert policy.poll() == (["second"], [])
    assert policy.client_vps_ready("second")
    assert not policy.client_vps_ready("first")


def test_vps_camera_reservation_expires_without_blocking_other_clients() -> None:
    clock = _Clock()
    policy = LocalizationPolicy(["vps"], clock=clock)
    policy.on_hello("paused")
    policy.on_hello("ready")
    clock.t = 5.1
    assert policy.poll() == (["ready"], [])
    assert policy.client_vps_ready("ready")
    policy.on_disconnect("paused")
    assert list(policy._vps_waiters) == ["ready"]


def test_active_vps_work_is_not_preempted_by_camera_reservation_expiry() -> None:
    clock = _Clock()
    policy = LocalizationPolicy(["vps"], clock=clock)
    policy.on_hello("active")
    assert policy.on_observations("active", [_observation()]) is not None
    policy.on_hello("waiting")
    clock.t = 6
    assert policy.poll() == ([], [])
    assert policy.client_vps_ready("active")
