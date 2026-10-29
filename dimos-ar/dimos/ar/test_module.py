from __future__ import annotations

import asyncio
from dataclasses import replace
import json
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

from dimos_lcm.std_msgs import Bool
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
import numpy as np
import pytest

from dimos.ar.localization.coordinator import LocalizationOutcome
from dimos.ar.localization.policy import EpisodeWork, LocalizationPolicy
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import Intrinsics
from dimos.ar.module import (
    ARModule,
    ARModuleConfig,
    LocalizationConfig,
    LocalizationProviderConfig,
    profile_for_config,
)
from dimos.ar.navigation.preview_service import NavigationPreviewService
from dimos.ar.navigation.tele_cmd_vel import TeleCmdVelPublisher
from dimos.ar.navigation.types import NavGoalRequest, NavJoystickRequest, NavState
from dimos.ar.robot.agent_service import ARAgentService, _textual_ai_message
from dimos.ar.robot.capabilities import NAV_GOAL, NAV_JOYSTICK, CapabilityName, CapabilitySet
from dimos.ar.robot.odometry import RobotOdometry
from dimos.ar.robot.profiles.profile import FiducialMarkerMount, RobotName, RobotProfile
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
from dimos.ar.robot.safety import Safety
from dimos.ar.sensors.lidar_settings import LidarSettings
from dimos.ar.websocket.protocol import (
    LocalizationObservation,
    TimeSync,
    UserMessageRequest,
    encode_state,
)
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


class _FakeWs:
    def __init__(self) -> None:
        self.connection_count = 1
        self.sent: list[tuple[str, str]] = []
        self.broadcasts: list[str] = []

    def schedule_send_to_client(self, client_id: str, text: str) -> None:
        self.sent.append((client_id, text))

    def schedule_broadcast_text(self, text: str) -> None:
        self.broadcasts.append(text)


def _anvil_openyam_profile() -> RobotProfile:
    return RobotProfile(
        display_name="Anvil OpenYAM",
        body_bounds_m=(0.40, 0.40, 0.80),
        footprint_m=(0.30, 0.30),
        base_height_m=0.0,
        odom_scale_correction_factor=1.0,
        fiducial_dictionary=None,
        fiducial_marker_mounts=(),
        T_base_camera_optical=None,
        supported_capabilities=frozenset(),
    )


def _module_with_policy(
    providers: list[str],
    *,
    profile: RobotProfile = UNITREE_GO2_PROFILE,
    agent_available: bool = False,
) -> ARModule:
    module = object.__new__(ARModule)
    module._map_localization = None
    module._pairing_log_at = 0.0
    module._pairing_rejected = 0
    module._pairing_accepted = 0
    module._odometry = RobotOdometry(factor=profile.odom_scale_correction_factor)
    module._policy = LocalizationPolicy(providers, travel=module._odometry.travel)
    module._replay_mode = False
    module._ws_server = _FakeWs()  # type: ignore[assignment]
    module._profile = profile
    module.human_input = SimpleNamespace(transport=None, publish=lambda _text: None)
    module._capabilities = CapabilitySet.from_supported(
        profile.supported_capabilities,
        localization_available=bool(providers),
        agent_available=agent_available,
        supported_navigation_inputs=profile.supported_navigation_inputs,
    )
    module._tele_cmd_vel_publisher = None
    module._lidar_settings = LidarSettings(
        enabled=False, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0
    )
    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        on_estop=lambda: False,
    )
    module.stop_movement = SimpleNamespace(transport=None, publish=lambda _msg: None)
    module._safety = Safety(
        estop_available=module._capabilities.supports(CapabilityName.ESTOP),
        effects=(module._clear_navigation, module._publish_stop),
    )
    module._agent_service = ARAgentService(
        factor=profile.odom_scale_correction_factor,
        connection_count=lambda: module._ws_server.connection_count,
        broadcast=module._ws_server.schedule_broadcast_text,
    )
    module._previews = NavigationPreviewService(
        SimpleNamespace(plan=lambda *_args: None),
        factor=profile.odom_scale_correction_factor,
        odometry=module._odometry.latest,
        send=module._ws_server.schedule_send_to_client,
    )
    return module


def test_ar_module_declares_stable_port_superset() -> None:
    ports = set(ARModule.__annotations__)
    assert {
        "odom",
        "tf",
        "lidar",
        "path",
        "goal_reached",
        "color_image",
        "camera_info",
        "goal_request",
        "stop_movement",
        "human_input",
        "tele_cmd_vel",
        "agent",
        "agent_idle",
    }.issubset(ports)


def test_importing_ar_module_does_not_load_unitree_go2() -> None:
    script = (
        "import sys\n"
        "from dimos.ar.module import ARModule\n"
        "assert ARModule.__name__ == 'ARModule'\n"
        "assert 'dimos.ar.robot.profiles.unitree_go2' not in sys.modules\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_localization_config_defaults_empty() -> None:
    config = ARModuleConfig()
    assert config.robot is RobotName.UNITREE_GO2
    assert config.localization.providers == []
    assert config.fiducial_marker_mounts is None
    assert LocalizationConfig().providers == []


def test_profile_for_config_none_keeps_go2_mounts() -> None:
    profile = profile_for_config(ARModuleConfig())
    assert profile.fiducial_marker_mounts == UNITREE_GO2_PROFILE.fiducial_marker_mounts


def test_profile_for_config_replaces_mounts() -> None:
    orientation = UNITREE_GO2_PROFILE.fiducial_marker_mounts[0].orientation
    mount = FiducialMarkerMount(
        marker_id=0,
        size_m=0.08,
        position=(0.2, 0.0, 0.07),
        orientation=orientation,
    )
    profile = profile_for_config(ARModuleConfig(fiducial_marker_mounts=[mount]))
    assert profile.fiducial_marker_mounts == (mount,)


def test_profile_for_config_empty_mounts_raises() -> None:
    with pytest.raises(ValueError, match="fiducial_marker_mounts"):
        profile_for_config(ARModuleConfig(fiducial_marker_mounts=[]))


def test_armodule_config_parses_mounts_from_dict() -> None:
    orientation = UNITREE_GO2_PROFILE.fiducial_marker_mounts[0].orientation
    config = ARModuleConfig.model_validate(
        {
            "fiducial_marker_mounts": [
                {
                    "marker_id": 0,
                    "size_m": 0.08,
                    "position": [0.2, 0.0, 0.07],
                    "orientation": list(orientation),
                }
            ]
        }
    )
    assert config.fiducial_marker_mounts is not None
    assert len(config.fiducial_marker_mounts) == 1
    mount = config.fiducial_marker_mounts[0]
    assert mount.marker_id == 0
    assert mount.size_m == pytest.approx(0.08)
    assert mount.position == (0.2, 0.0, 0.07)
    assert profile_for_config(config).fiducial_marker_mounts == (mount,)


def test_localization_only_config_defaults_to_go2() -> None:
    config = ARModuleConfig(
        localization=LocalizationConfig(
            providers=[LocalizationProviderConfig(type="fiducial_marker")]
        )
    )
    assert config.robot is RobotName.UNITREE_GO2
    assert config.localization.providers[0].type == "fiducial_marker"


def test_hello_includes_estop_capability() -> None:
    module = _module_with_policy(["fiducial_marker"])
    hello = module._hello_body("c1")
    assert hello.capabilities[CapabilityName.ESTOP].available is True
    assert hello.capabilities[CapabilityName.ESTOP].reason is None
    assert hello.capabilities[CapabilityName.LOCALIZATION].available is True
    assert hello.capabilities[CapabilityName.LOCALIZATION].reason is None
    assert hello.capabilities[CapabilityName.AGENT].available is False
    assert hello.capabilities[CapabilityName.AGENT].reason == (
        "current blueprint has no DimOS agent"
    )
    assert hello.robot.display_name == UNITREE_GO2_PROFILE.display_name
    assert hello.navigation_inputs[NAV_GOAL].available is True
    assert hello.navigation_inputs[NAV_JOYSTICK].available is True


def test_hello_lidar_nav_estop_follow_profile() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset(),
        supported_navigation_inputs=frozenset(),
    )
    module = _module_with_policy(["fiducial_marker"], profile=profile)
    hello = module._hello_body("c1")
    assert hello.capabilities[CapabilityName.LIDAR].available is False
    assert hello.capabilities[CapabilityName.LIDAR].reason is not None
    assert hello.capabilities[CapabilityName.NAVIGATION].available is False
    assert hello.capabilities[CapabilityName.NAVIGATION].reason is not None
    assert hello.capabilities[CapabilityName.ESTOP].available is False
    assert hello.capabilities[CapabilityName.ESTOP].reason is not None
    assert hello.capabilities[CapabilityName.LOCALIZATION].available is True


def test_hello_anvil_openyam_profile_has_no_mobile_capabilities() -> None:
    module = _module_with_policy([], profile=_anvil_openyam_profile())
    hello = module._hello_body("c1")
    assert hello.robot.display_name == "Anvil OpenYAM"
    assert hello.capabilities[CapabilityName.LIDAR].available is False
    assert hello.capabilities[CapabilityName.NAVIGATION].available is False
    assert hello.capabilities[CapabilityName.ESTOP].available is False
    assert hello.capabilities[CapabilityName.LOCALIZATION].available is False


def test_hello_localization_unavailable_without_providers() -> None:
    module = _module_with_policy([])
    hello = module._hello_body("c1")
    assert hello.capabilities[CapabilityName.LOCALIZATION].available is False
    assert hello.capabilities[CapabilityName.LOCALIZATION].reason is not None


def test_hello_prompts_observations_request() -> None:
    module = _module_with_policy(["fiducial_marker"])
    module._on_client_connect(None, "c1")  # type: ignore[arg-type]
    assert module._ws_server.sent  # type: ignore[union-attr]
    client_id, text = module._ws_server.sent[0]  # type: ignore[union-attr]
    assert client_id == "c1"
    assert "localization_observations_request" in text
    assert "robot_los_required" in text


@pytest.mark.parametrize("replay", [False, True])
@pytest.mark.parametrize("has_pose", [False, True])
def test_replay_hello_sends_retained_corrected_pose(replay: bool, has_pose: bool) -> None:
    module = _module_with_policy(["fiducial_marker"])
    module._replay_mode = replay
    module._odometry.history = PoseBuffer()
    if has_pose:
        module._odometry.history.push(
            PoseStamped(ts=10.0, position=[2.5, -3.75, 0.33]),
            ts_server=10.0,
        )

    module._on_client_connect(None, "late-client")  # type: ignore[arg-type]

    sent = [(client, json.loads(text)) for client, text in module._ws_server.sent]  # type: ignore[union-attr]
    poses = [(client, body) for client, body in sent if body["type"] == "pose"]
    if not (replay and has_pose):
        assert poses == []
        return
    assert poses == [
        (
            "late-client",
            {
                "type": "pose",
                "position": [2.5, -3.75, 0.33],
                "orientation": [0.0, 0.0, 0.0, 1.0],
                "ts": 10.0,
            },
        )
    ]


@pytest.mark.parametrize(
    ("replay", "provider", "expected_travel"),
    [(True, "fiducial_marker", 2.0), (False, "fiducial_marker", None), (True, "vps", None)],
)
def test_marker_capture_travel_uses_replay_pose_policy(
    replay: bool,
    provider: str,
    expected_travel: float | None,
) -> None:
    module = _module_with_policy([provider])
    module._replay_mode = replay
    module._odometry.history = PoseBuffer()
    module._odometry.history.push(PoseStamped(ts=10.0, position=[0, 0, 0]), ts_server=10.0)
    module._odometry.history.push(PoseStamped(ts=10.1, position=[2, 0, 0]), ts_server=10.1)
    module._policy.on_hello("c1")
    on_observations = Mock(wraps=module._policy.on_observations)
    module._policy.on_observations = on_observations  # type: ignore[method-assign]
    submitted: list[EpisodeWork] = []
    module._localization_runner = SimpleNamespace(submit=submitted.append)  # type: ignore[assignment]
    observation = LocalizationObservation(
        ts_capture=time.time(),
        jpeg=b"jpeg",
        intrinsics=Intrinsics(600, 600, 400, 400, 800, 800, "none", ()),
        camera_position=(0, 0, 0),
        camera_orientation=(0, 0, 0, 1),
    )

    module._on_localization_observations((observation,), "c1", TimeSync(0, 0))

    assert len(submitted) == 1
    assert on_observations.call_args.kwargs["capture_travel_m"] == expected_travel


@pytest.mark.asyncio
@pytest.mark.parametrize("disconnected", [False, True])
async def test_failed_localization_requests_next_batch_without_result_timeout(
    disconnected: bool,
) -> None:
    module = _module_with_policy(["fiducial_marker"])
    module._policy.on_hello("c1")
    if disconnected:
        module._policy.on_disconnect("c1")
    module._complete_localization(
        EpisodeWork(client_id="c1", observations=()), LocalizationOutcome()
    )
    assert module._ws_server.sent == []
    if not disconnected:
        prompts, episodes = module._policy.poll()
        assert prompts == [] and episodes == []  # Retry waits for backoff.


def test_state_snapshot_has_no_alignment() -> None:
    module = _module_with_policy([])
    text = encode_state(module._state_snapshot())
    assert "alignment" not in text
    assert '"nav"' in text


def test_vps_provider_requires_map_code() -> None:
    module = object.__new__(ARModule)
    module.config = ARModuleConfig(
        localization=LocalizationConfig(providers=[LocalizationProviderConfig(type="vps")]),
    )
    module._profile = UNITREE_GO2_PROFILE
    module._odometry = RobotOdometry(factor=module._profile.odom_scale_correction_factor)
    with pytest.raises(ValueError, match="map_code"):
        module._build_localizers()


def test_vps_provider_requires_camera_extrinsic() -> None:
    module = object.__new__(ARModule)
    module.config = ARModuleConfig(
        localization=LocalizationConfig(
            providers=[LocalizationProviderConfig(type="vps", map_code="office")]
        ),
    )
    module._profile = replace(UNITREE_GO2_PROFILE, T_base_camera_optical=None)
    module._odometry = RobotOdometry(factor=module._profile.odom_scale_correction_factor)
    with pytest.raises(ValueError, match="T_base_camera_optical"):
        module._build_localizers()


def test_nav_goal_request_noops_without_navigation() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset({CapabilityName.ESTOP}),
        supported_navigation_inputs=frozenset(),
    )
    module = _module_with_policy([], profile=profile)
    published: list[object] = []
    module.goal_request = SimpleNamespace(transport=object(), publish=published.append)
    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        submit_goal=lambda msg: published.append(msg),
    )
    module._on_nav_goal_request(
        NavGoalRequest(position=(1.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
        None,  # type: ignore[arg-type]
        "c1",
    )
    assert published == []
    assert module._ws_server.broadcasts == []  # type: ignore[union-attr]


def test_estop_request_noops_without_estop() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset(),
        supported_navigation_inputs=frozenset(),
    )
    module = _module_with_policy([], profile=profile)
    called = False

    def on_estop() -> bool:
        nonlocal called
        called = True
        return True

    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        on_estop=on_estop,
    )
    published: list[object] = []
    module.stop_movement = SimpleNamespace(transport=object(), publish=published.append)
    module._on_estop_request(SimpleNamespace(), None)  # type: ignore[arg-type]
    assert called is False
    assert published == []


def test_estop_request_clears_navigation_and_publishes_stop() -> None:
    module = _module_with_policy([])
    called = False

    def on_estop() -> bool:
        nonlocal called
        called = True
        return True

    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        on_estop=on_estop,
    )
    published: list[object] = []
    module.stop_movement = SimpleNamespace(transport=object(), publish=published.append)
    module._on_estop_request(SimpleNamespace(), None)  # type: ignore[arg-type]
    assert called is True
    assert [msg.data for msg in published] == [True]
    assert module._ws_server.broadcasts  # type: ignore[union-attr]


def test_last_disconnect_runs_safety() -> None:
    module = _module_with_policy([])
    called = False

    def on_estop() -> bool:
        nonlocal called
        called = True
        return True

    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        on_estop=on_estop,
    )
    published: list[object] = []
    module.stop_movement = SimpleNamespace(transport=object(), publish=published.append)
    module._ws_server.connection_count = 0  # type: ignore[union-attr]
    module._on_client_disconnect(None, "c1")  # type: ignore[arg-type]
    assert called is True
    assert [msg.data for msg in published] == [True]


def test_disconnect_does_not_stop_while_clients_remain() -> None:
    module = _module_with_policy([])
    called = False

    def on_estop() -> bool:
        nonlocal called
        called = True
        return True

    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        on_estop=on_estop,
    )
    published: list[object] = []
    module.stop_movement = SimpleNamespace(transport=object(), publish=published.append)
    module._ws_server.connection_count = 1  # type: ignore[union-attr]
    module._on_client_disconnect(None, "c1")  # type: ignore[arg-type]
    assert called is False
    assert published == []


def test_lidar_settings_request_noops_without_lidar() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset({CapabilityName.ESTOP}),
        supported_navigation_inputs=frozenset(),
    )
    module = _module_with_policy([], profile=profile)
    module._on_lidar_settings_request(
        SimpleNamespace(enabled=True, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0),
        None,  # type: ignore[arg-type]
    )
    assert module._lidar_settings.enabled is False
    assert module._ws_server.broadcasts == []  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_handle_goal_reached_skips_policy_without_navigation() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset({CapabilityName.ESTOP}),
        supported_navigation_inputs=frozenset(),
    )
    module = _module_with_policy(["fiducial_marker"], profile=profile)
    prompts: list[bool] = []
    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        on_goal_reached=lambda _msg: prompts.append(True),
    )
    module._policy = SimpleNamespace(  # type: ignore[assignment]
        on_goal_reached=lambda **_kwargs: prompts.append(True),
        providers=["fiducial_marker"],
    )
    await module.handle_goal_reached(Bool(True))
    assert prompts == []
    assert module._ws_server.broadcasts == []  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_handle_path_noops_without_navigation() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset({CapabilityName.ESTOP}),
        supported_navigation_inputs=frozenset(),
    )
    module = _module_with_policy([], profile=profile)
    called = False

    def on_path(_msg: Path) -> tuple[object, bool]:
        nonlocal called
        called = True
        return SimpleNamespace(), True

    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        on_path=on_path,
    )
    await module.handle_path(Path(frame_id="odom", poses=[]))
    assert called is False
    assert module._ws_server.broadcasts == []  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_handle_lidar_noops_without_lidar() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset({CapabilityName.ESTOP}),
        supported_navigation_inputs=frozenset(),
    )
    module = _module_with_policy([], profile=profile)
    published: list[object] = []
    module._state_publisher = SimpleNamespace(  # type: ignore[assignment]
        publish_lidar=lambda msg, lidar: published.append(msg)
    )
    await module.handle_lidar(SimpleNamespace())  # type: ignore[arg-type]
    assert published == []


@pytest.mark.asyncio
async def test_handle_camera_streams_noop_without_extrinsic() -> None:
    module = _module_with_policy([], profile=_anvil_openyam_profile())
    called = False

    def unexpected(*_args: object, **_kwargs: object) -> None:
        nonlocal called
        called = True

    module._robot_observations = SimpleNamespace(  # type: ignore[assignment]
        set_camera_info=unexpected,
        push_image=unexpected,
    )
    await module.handle_camera_info(SimpleNamespace())  # type: ignore[arg-type]
    await module.handle_color_image(SimpleNamespace())  # type: ignore[arg-type]
    assert called is False


@pytest.mark.asyncio
@pytest.mark.parametrize("profile", [_anvil_openyam_profile(), UNITREE_GO2_PROFILE])
async def test_handle_odom_uses_corrected_robot_position_for_localization(
    profile: RobotProfile,
) -> None:
    module = _module_with_policy([], profile=profile)
    published: list[object] = []
    module._state_publisher = SimpleNamespace(publish_odom=published.append)
    module._robot_observations = SimpleNamespace(expire=lambda _travel: None)
    module._flush_localization = lambda *_args: None
    pose = PoseStamped(
        ts=time.time(),
        frame_id="world",
        position=[2.0, -3.0, 0.33],
        orientation=[0.0, 0.0, 0.0, 1.0],
    )
    await module.handle_odom(pose)
    buffered = module._odometry.history.latest()
    assert buffered.position == pytest.approx(
        (
            2.0 * profile.odom_scale_correction_factor,
            -3.0 * profile.odom_scale_correction_factor,
            0.33,
        )
    )
    assert len(published) == 1
    assert (published[0].x, published[0].y, published[0].z) == (pose.x, pose.y, pose.z)
    assert published[0].ts == pose.ts


def test_hello_agent_capability_follows_config() -> None:
    module = _module_with_policy([], agent_available=True)
    hello = module._hello_body("c1")
    assert hello.capabilities[CapabilityName.AGENT].available is True
    assert hello.capabilities[CapabilityName.AGENT].reason is None


def test_state_snapshot_includes_agent_idle() -> None:
    module = _module_with_policy([])
    text = encode_state(module._state_snapshot())
    assert '"agent"' in text
    assert '"idle":true' in text.replace(" ", "")


@pytest.mark.asyncio
async def test_handle_agent_forwards_textual_aimessage_only() -> None:
    module = _module_with_policy([], agent_available=True)
    await module.handle_agent(HumanMessage(content="ignore me"))
    await module.handle_agent(ToolMessage(content="tool", tool_call_id="1"))
    await module.handle_agent(AIMessage(content=""))
    await module.handle_agent(AIMessage(content="  Heading out.  "))
    broadcasts = module._ws_server.broadcasts  # type: ignore[union-attr]
    assert len(broadcasts) == 1
    assert '"type":"agent_message"' in broadcasts[0]
    assert "Heading out." in broadcasts[0]


@pytest.mark.asyncio
async def test_handle_agent_idle_broadcasts_state_change() -> None:
    module = _module_with_policy([], agent_available=True)
    await module.handle_agent_idle(False)
    await module.handle_agent_idle(False)
    await module.handle_agent_idle(True)
    broadcasts = module._ws_server.broadcasts  # type: ignore[union-attr]
    assert len(broadcasts) == 2
    assert '"idle":false' in broadcasts[0].replace(" ", "")
    assert '"idle":true' in broadcasts[1].replace(" ", "")


def test_user_message_request_requires_capability_and_transport() -> None:
    published: list[str] = []
    module = _module_with_policy([])
    module.human_input = SimpleNamespace(transport=object(), publish=published.append)
    module._on_user_message_request(UserMessageRequest(text="go"), None, "c1")  # type: ignore[arg-type]
    assert published == []

    module = _module_with_policy([], agent_available=True)
    module.human_input = SimpleNamespace(transport=None, publish=published.append)
    module._on_user_message_request(UserMessageRequest(text="go"), None, "c1")  # type: ignore[arg-type]
    assert published == []

    module.human_input = SimpleNamespace(transport=object(), publish=published.append)
    module._on_user_message_request(UserMessageRequest(text="go"), None, "c1")  # type: ignore[arg-type]
    assert published == ["go"]


def test_ar_place_marker_validates_and_requires_fresh_pose() -> None:
    from dimos.ar.websocket.protocol import ClientPose

    module = _module_with_policy([], agent_available=True)
    module._ws_server.connection_count = 0  # type: ignore[union-attr]
    assert module.ar_place_marker("kitchen", 1.0, 0.0, 0.0) == "No AR client connected"
    assert module.ar_place_marker("  ", 1.0, 0.0, 0.0) == "id is blank"
    assert module.ar_place_marker("x" * 65, 1.0, 0.0, 0.0) == "id is too long"
    assert "x" in module.ar_place_marker("kitchen", float("nan"), 0.0, 0.0)  # type: ignore[arg-type]
    assert "title" in module.ar_place_marker("kitchen", 1.0, 0.0, 0.0, title=1)  # type: ignore[arg-type]
    module._ws_server.connection_count = 1  # type: ignore[union-attr]
    assert module.ar_place_marker("kitchen", 1.0, 0.0, 0.0) == "No client pose"
    module._on_client_pose(
        ClientPose(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0), ts=1.0),
        None,  # type: ignore[arg-type]
        "c1",
    )
    assert module.ar_place_marker("kitchen", 1.0, 0.0, 0.0, "Kitchen") == "ok"
    payload = module._ws_server.broadcasts[-1]  # type: ignore[union-attr]
    assert "ar_place_marker" in payload
    assert '"id":"kitchen"' in payload
    assert '"title":"Kitchen"' in payload
    assert module.ar_place_marker("kitchen", 2.0, 0.0, 0.0) == "ok"
    assert "title" not in module._ws_server.broadcasts[-1]  # type: ignore[union-attr]
    assert module._agent_service.marker_ids == {"kitchen"}


def test_ar_remove_marker_and_clear_on_last_disconnect() -> None:
    from dimos.ar.websocket.protocol import ClientPose

    module = _module_with_policy([], agent_available=True)
    module._ws_server.connection_count = 1  # type: ignore[union-attr]
    module._on_client_pose(
        ClientPose(position=(0.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0), ts=1.0),
        None,  # type: ignore[arg-type]
        "c1",
    )
    assert module.ar_place_marker("door", 1.0, 0.0, 0.0) == "ok"
    assert module.ar_remove_marker("missing") == "unknown marker id"
    assert module.ar_remove_marker("door") == "ok"
    payload = module._ws_server.broadcasts[-1]  # type: ignore[union-attr]
    assert "ar_remove_marker" in payload
    assert '"id":"door"' in payload
    assert module.ar_remove_marker("door") == "unknown marker id"
    assert module.ar_place_marker("door", 1.0, 0.0, 0.0) == "ok"
    module._ws_server.connection_count = 0  # type: ignore[union-attr]
    module._on_client_disconnect(None, "c1")  # type: ignore[arg-type]
    assert module._agent_service.marker_ids == set()
    assert module.ar_get_client_pose() == "No client pose"


def test_ar_get_client_pose_empty_stale_fresh() -> None:
    from dimos.ar.websocket.protocol import ClientPose

    module = _module_with_policy([], agent_available=True)
    assert module.ar_get_client_pose() == "No client pose"
    module._on_client_pose(
        ClientPose(position=(1.0, 2.0, 3.0), orientation=(0.0, 0.0, 0.0, 1.0), ts=12.5),
        None,  # type: ignore[arg-type]
        "c1",
    )
    text = module.ar_get_client_pose()
    assert "position" in text
    assert "orientation" in text
    assert "look_dir" in text
    assert "[0.8, 1.6, 3.0]" in text
    assert "[0.0, 0.0, 1.0]" in text
    module._agent_service._received_at = time.time() - 1.1
    assert "position" in module.ar_get_client_pose()
    module._agent_service._received_at = time.time() - 2.1
    assert module.ar_get_client_pose() == "No client pose"


def test_textual_ai_message_extracts_text_blocks() -> None:
    assert _textual_ai_message(HumanMessage(content="no")) is None
    assert _textual_ai_message(AIMessage(content="hello")) == "hello"
    assert _textual_ai_message(AIMessage(content=[{"type": "text", "text": "block"}])) == "block"


def test_nav_joystick_request_noops_without_nav_joystick() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_navigation_inputs=frozenset({NAV_GOAL}),
    )
    module = _module_with_policy([], profile=profile)
    published: list[object] = []
    module.tele_cmd_vel = SimpleNamespace(transport=object(), publish=published.append)
    module._on_nav_joystick_request(
        NavJoystickRequest(linear=(0.4, 0.0, 0.0), angular=(0.0, 0.0, 0.0)),
        None,  # type: ignore[arg-type]
        "c1",
    )
    assert published == []


def test_nav_joystick_request_publishes_tele_cmd_vel() -> None:
    module = _module_with_policy([])
    published: list[object] = []
    module.tele_cmd_vel = SimpleNamespace(transport=object(), publish=published.append)
    module._tele_cmd_vel_publisher = TeleCmdVelPublisher(
        publish=published.append,
        max_linear_mps=1.5,
        max_angular_rps=2.0,
        loop=asyncio.new_event_loop(),
    )
    module._on_nav_joystick_request(
        NavJoystickRequest(linear=(0.4, 0.0, 0.0), angular=(0.0, 0.0, 0.3)),
        None,  # type: ignore[arg-type]
        "c1",
    )
    assert len(published) == 1
    twist = published[0]
    assert twist.linear.x == pytest.approx(0.4)
    assert twist.angular.z == pytest.approx(0.3)


def test_estop_and_last_disconnect_cancel_tele_cmd_vel() -> None:
    module = _module_with_policy([])
    cancelled: list[bool] = []
    module._tele_cmd_vel_publisher = SimpleNamespace(cancel=lambda: cancelled.append(True))
    module.stop_movement = SimpleNamespace(transport=object(), publish=lambda _msg: None)
    module._on_estop_request(SimpleNamespace(), None)  # type: ignore[arg-type]
    assert cancelled == [True]
    cancelled.clear()
    module._ws_server.connection_count = 0  # type: ignore[union-attr]
    module._on_client_disconnect(None, "c1")  # type: ignore[arg-type]
    assert cancelled == [True]


@pytest.mark.parametrize("failure", ["missing_odom", "missing_map", "exception"])
def test_preview_returns_empty_without_changing_motion_or_state(failure: str) -> None:
    module = _module_with_policy([])
    if failure != "missing_odom":
        module._odometry.accept(PoseStamped(ts=time.time(), position=[1, 2, 0]))
    module._previews._planner = Mock()
    module._previews._planner.plan.return_value = None
    if failure == "exception":
        module._previews._planner.plan.side_effect = RuntimeError("planner failed")
    module.goal_request = SimpleNamespace(transport=object(), publish=Mock())
    before = module._state_snapshot()
    frame = module._previews.compute(
        NavGoalRequest((4, 6, 0), (0, 0, 0, 1), preview=True), module._odometry.latest()
    )
    assert frame.preview is True
    assert frame.pose is None
    assert frame.path_poses == []
    assert module._state_snapshot() == before
    module.goal_request.publish.assert_not_called()
    assert module._ws_server.broadcasts == []


async def test_preview_is_requester_only_off_loop_and_does_not_submit_motion() -> None:
    module = _module_with_policy(
        [], profile=replace(UNITREE_GO2_PROFILE, odom_scale_correction_factor=2.0)
    )
    module._odometry.accept(PoseStamped(ts=time.time(), position=[1, 2, 0]))
    module._previews._tasks = {}
    module.goal_request = SimpleNamespace(transport=object(), publish=Mock())
    loop_thread = threading.get_ident()
    worker_threads = []

    def plan(start, goal):
        worker_threads.append(threading.get_ident())
        assert start == (1, 2)
        assert goal == (2, 3)
        return [(1, 2, 0), (2, 3, 0)]

    module._previews._planner = SimpleNamespace(plan=plan)
    before = module._state_snapshot()
    request = NavGoalRequest((4, 6, 0.5), (0, 0, 0, 1), preview=True, preview_id="aim")
    module._on_nav_goal_request(request, None, "requester")
    task = module._previews._tasks["requester"]
    module._on_nav_goal_request(request, None, "requester")
    assert module._previews._tasks["requester"] is task
    await task
    assert worker_threads and worker_threads[0] != loop_thread
    assert list(module._previews._tasks) == []
    assert len(module._ws_server.sent) == 2
    busy = json.loads(module._ws_server.sent[0][1])
    assert busy["path_poses"] == [] and busy["preview_id"] == "aim"
    client_id, text = module._ws_server.sent[1]
    assert client_id == "requester"
    response = json.loads(text)
    assert response["preview"] is True
    assert response["preview_id"] == "aim"
    assert response["path_poses"] == [[2, 4, 0.5, 0], [4, 6, 0.5, 0]]
    assert response["pose"] == [4, 6, 0.5, 0]
    assert module._ws_server.broadcasts == []
    module.goal_request.publish.assert_not_called()
    assert module._state_snapshot() == before


def test_hello_advertises_preview_support() -> None:
    module = _module_with_policy([])
    assert module._hello_body("client").nav_goal_preview is True


@pytest.mark.asyncio
async def test_disconnect_cancels_preview_delivery_while_worker_finishes() -> None:
    module = _module_with_policy([])
    module._previews._tasks = {}
    module._odometry.accept(PoseStamped(ts=time.time(), position=[0, 0, 0]))
    started = threading.Event()
    release = threading.Event()

    def plan(_start, _goal):
        started.set()
        release.wait(timeout=5)
        return [(0, 0, 0), (1, 1, 0)]

    module._previews._planner = SimpleNamespace(plan=plan)
    request = NavGoalRequest((1, 1, 0), (0, 0, 0, 1), preview=True, preview_id="retired")
    module._on_nav_goal_request(request, None, "retired-client")
    task = module._previews._tasks["retired-client"]
    try:
        assert await asyncio.to_thread(started.wait, 5)
        module._on_client_disconnect(None, "retired-client")
        with pytest.raises(asyncio.CancelledError):
            await task
        assert module._previews._tasks == {}
        assert module._ws_server.sent == []
    finally:
        release.set()


def test_new_goal_broadcasts_cleared_state_before_planner_can_complete() -> None:
    module = _module_with_policy([])
    order: list[str] = []
    module._nav_goal_coordinator = SimpleNamespace(
        nav_state=lambda: NavState("idle", None),
        submit_goal=lambda _msg: object(),
    )
    module._broadcast_state = lambda: order.append("state")  # type: ignore[method-assign]
    module.goal_request = SimpleNamespace(
        transport=object(), publish=lambda _goal: order.append("planner")
    )
    module._on_nav_goal_request(
        NavGoalRequest(position=(1.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0)),
        None,  # type: ignore[arg-type]
        "c1",
    )
    assert order == ["state", "planner"]


async def test_changed_robot_frame_retires_origins_and_requires_mapping_restart() -> None:
    from dimos.ar.localization.pose_buffer import PoseBuffer

    module = _module_with_policy(["vps"])
    module._odometry.history = PoseBuffer()
    module._odometry.history.push(PoseStamped(ts=time.time(), position=[0, 0, 0.33]))
    module._odometry.generation = 0
    module._odometry._source_frame = "world"
    module._localization_runner = SimpleNamespace(cancel_all=Mock())
    module._coordinator = SimpleNamespace(invalidate_source=Mock())
    module._ws_server.schedule_disconnect_all = Mock()
    module._tele_cmd_vel_publisher = SimpleNamespace(cancel=Mock())
    stopped = []
    module.stop_movement = SimpleNamespace(transport=object(), publish=stopped.append)
    await module.handle_odom(
        PoseStamped(ts=time.time(), frame_id="new-world", position=[0, 0, 0.33])
    )
    assert module._odometry.generation == 1
    assert module._odometry.history.latest() is None
    assert stopped
    module._localization_runner.cancel_all.assert_called_once()
    module._coordinator.invalidate_source.assert_called_once()
    module._ws_server.schedule_disconnect_all.assert_called_once()
    hello = module._hello_body("client")
    assert not hello.capabilities[CapabilityName.NAVIGATION].available
    assert not hello.navigation_inputs[NAV_GOAL].available
    module.goal_request = SimpleNamespace(transport=object(), publish=Mock())
    module._on_nav_goal_request(NavGoalRequest((1, 0, 0), (0, 0, 0, 1)), None, "client")
    module.goal_request.publish.assert_not_called()


async def test_robot_image_pairing_preserves_producer_time_and_encodes_off_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dimos.ar.localization.pose_buffer import PoseBuffer
    from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
    from dimos.ar.localization.vps.test_robot_observation_buffer import _camera_info
    from dimos.ar.localization.worker import LocalizationWorker
    import dimos.ar.module as ar_module

    module = _module_with_policy(["vps"])
    module._odometry.generation = 0
    module._odometry.history = PoseBuffer()
    for t in [99.9, 100.0, 100.1]:
        module._odometry.history.push(PoseStamped(ts=t, position=[1, 0, 0.33]), ts_server=t)
    module._robot_observations = RobotObservationBuffer(
        pose_buffer=module._odometry.history,
        T_base_camera_optical=np.eye(4),
        timing_uncertainty_s=0.1,
    )
    module._robot_observations.set_camera_info(_camera_info())
    module._localization_worker = LocalizationWorker()
    monkeypatch.setattr(ar_module.time, "time", lambda: 100.8)
    loop_thread = threading.get_ident()
    encode_threads = []

    def encode():
        encode_threads.append(threading.get_ident())
        return b"jpeg"

    try:
        await module.handle_color_image(SimpleNamespace(ts=100.0, to_jpeg_bytes=encode))
        sample = module._robot_observations.newest(now_server=100.8)
        assert sample.observation.ts_server == 100.0
        assert sample.observation.camera_pose.x == 1
        assert encode_threads[0] != loop_thread
    finally:
        module._localization_worker.close()


def test_robot_odometry_heuristic_is_configurable_at_startup_and_advertised() -> None:
    from pydantic import ValidationError

    assert profile_for_config(ARModuleConfig()).odom_scale_correction_factor == 1.25
    configured = profile_for_config(ARModuleConfig(odom_scale_correction_factor=1.1))
    assert configured.description.odom_scale_correction_factor == 1.1
    assert configured.fiducial_marker_mounts == UNITREE_GO2_PROFILE.fiducial_marker_mounts
    for invalid in [0, -1, float("nan"), float("inf")]:
        with pytest.raises(ValidationError):
            ARModuleConfig(odom_scale_correction_factor=invalid)


def test_agent_native_points_and_corrected_client_pose_round_trip() -> None:
    from dimos.ar.websocket.protocol import ClientPose

    module = _module_with_policy([], agent_available=True)
    module._on_client_pose(
        ClientPose(position=(5, -2.5, 1.5), orientation=(0, 0, 0, 1), ts=1), None, "client"
    )
    assert "position=[4.0, -2.0, 1.5]" in module.ar_get_client_pose()
    assert module.ar_place_marker("person", 4, -2, 1.5) == "ok"
    args = json.loads(module._ws_server.broadcasts[-1])["args"]
    assert [args["x"], args["y"], args["z"]] == [5, -2.5, 1.5]


async def test_duplicate_odometry_has_no_telemetry_or_localization_effects() -> None:
    module = _module_with_policy([])
    published = []
    module._state_publisher = SimpleNamespace(publish_odom=published.append)
    module._robot_observations = SimpleNamespace(expire=Mock())
    module._flush_localization = Mock()
    timestamp = time.time()
    for x in (0, 1, 2):
        await module.handle_odom(PoseStamped(ts=timestamp, frame_id="world", position=[x, 0, 0.33]))
    assert len(published) == 1
    assert module._odometry.latest().position == (0, 0, 0.33)
    assert module._policy.travel_m == 0
    module._robot_observations.expire.assert_called_once_with(0)
    module._flush_localization.assert_called_once()


def test_unwired_goal_does_not_mutate_navigation() -> None:
    module = _module_with_policy([])
    module.goal_request = SimpleNamespace(transport=None, publish=Mock())
    module._nav_goal_coordinator.submit_goal = Mock()
    module._on_nav_goal_request(NavGoalRequest((1, 0, 0), (0, 0, 0, 1)), None, "client")
    module._nav_goal_coordinator.submit_goal.assert_not_called()
    assert module._ws_server.broadcasts == []
