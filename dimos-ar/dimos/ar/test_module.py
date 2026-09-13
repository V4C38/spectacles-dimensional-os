from __future__ import annotations

from dataclasses import replace
import subprocess
import sys
import time
from types import SimpleNamespace

from dimos_lcm.std_msgs import Bool
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
import pytest

from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.module import (
    ARModule,
    ARModuleConfig,
    LocalizationConfig,
    LocalizationProviderConfig,
    _textual_ai_message,
)
from dimos.ar.navigation.types import NavGoalRequest, NavState
from dimos.ar.robot.capabilities import CapabilityName, CapabilitySet
from dimos.ar.robot.profiles import RobotName, RobotProfile
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
from dimos.ar.robot.safety import Safety
from dimos.ar.sensors.lidar_settings import LidarSettings
from dimos.ar.websocket.protocol import encode_state
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
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
    module._policy = LocalizationPolicy(providers)
    module._ws_server = _FakeWs()  # type: ignore[assignment]
    module._profile = profile
    module._agent_idle = True
    module.human_input = SimpleNamespace(transport=None, publish=lambda _text: None)
    module._capabilities = CapabilitySet.from_supported(
        profile.supported_capabilities,
        localization_available=bool(providers),
        agent_available=agent_available,
    )
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
    module._client_pose = None
    module._client_pose_received_at = None
    module._ar_marker_ids = set()
    return module


def test_ar_module_declares_stable_port_superset() -> None:
    ports = ARModule.__annotations__
    assert ports["odom"] == "In[PoseStamped]"
    assert ports["lidar"] == "In[PointCloud2]"
    assert ports["path"] == "In[Path]"
    assert ports["goal_reached"] == "In[Bool]"
    assert ports["color_image"] == "In[Image]"
    assert ports["camera_info"] == "In[CameraInfo]"
    assert ports["goal_request"] == "Out[PoseStamped]"
    assert ports["stop_movement"] == "Out[Bool]"
    assert ports["human_input"] == "Out[str]"
    assert ports["agent"] == "In[BaseMessage]"
    assert ports["agent_idle"] == "In[bool]"


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
    assert LocalizationConfig().providers == []


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


def test_hello_lidar_nav_estop_follow_profile() -> None:
    profile = replace(UNITREE_GO2_PROFILE, supported_capabilities=frozenset())
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


def test_state_snapshot_has_no_alignment() -> None:
    module = _module_with_policy([])
    text = encode_state(module._state_snapshot())
    assert "alignment" not in text
    assert '"nav"' in text


def test_ingest_relocalization_transform_when_map_frame_present() -> None:
    module = object.__new__(ARModule)
    captured: list[tuple[Transform, float]] = []

    def on_relocalization_transform(transform: Transform, *, ts_server: float) -> None:
        captured.append((transform, ts_server))

    module._coordinator = SimpleNamespace(
        on_relocalization_transform=on_relocalization_transform
    )
    module._last_relocalization_transform_poll_at = 0.0
    transform = Transform(
        translation=Vector3(5.0, 0.0, 0.0),
        rotation=Quaternion(0.0, 0.0, 0.0, 1.0),
        frame_id="world",
        child_frame_id="map",
        ts=42.0,
    )
    gets: list[tuple[str, str]] = []

    def get(parent: str, child: str) -> Transform | None:
        gets.append((parent, child))
        if parent == "world" and child == "map":
            return transform
        return None

    module._tf = SimpleNamespace(get_frames=lambda: {"world", "map"}, get=get)
    module._maybe_ingest_relocalization_transform(100.0)
    assert len(captured) == 1
    forwarded, ts_server = captured[0]
    assert forwarded.frame_id == "odom"
    assert forwarded.child_frame_id == "map"
    assert forwarded.ts == pytest.approx(42.0)
    assert forwarded.translation == transform.translation
    assert forwarded.rotation == transform.rotation
    assert ts_server == pytest.approx(100.0)
    assert gets == [("world", "map")]


def test_ingest_relocalization_transform_skips_without_map_frame() -> None:
    module = object.__new__(ARModule)
    captured: list[tuple[Transform, float]] = []

    def on_relocalization_transform(transform: Transform, *, ts_server: float) -> None:
        captured.append((transform, ts_server))

    module._coordinator = SimpleNamespace(
        on_relocalization_transform=on_relocalization_transform
    )
    module._last_relocalization_transform_poll_at = 0.0
    gets: list[tuple[str, str]] = []
    module._tf = SimpleNamespace(
        get_frames=lambda: set(),
        get=lambda parent, child: gets.append((parent, child)) or None,
    )
    module._maybe_ingest_relocalization_transform(100.0)
    assert captured == []
    assert gets == []


def test_vps_provider_requires_map_code() -> None:
    module = object.__new__(ARModule)
    module.config = ARModuleConfig(
        localization=LocalizationConfig(providers=[LocalizationProviderConfig(type="vps")]),
    )
    module._profile = UNITREE_GO2_PROFILE
    module._pose_buffer = SimpleNamespace()  # type: ignore[assignment]
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
    module._pose_buffer = SimpleNamespace()  # type: ignore[assignment]
    with pytest.raises(ValueError, match="T_base_camera_optical"):
        module._build_localizers()


def test_nav_goal_request_noops_without_navigation() -> None:
    profile = replace(
        UNITREE_GO2_PROFILE,
        supported_capabilities=frozenset({CapabilityName.ESTOP}),
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
    profile = replace(UNITREE_GO2_PROFILE, supported_capabilities=frozenset())
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
async def test_handle_odom_runs_without_optional_capabilities() -> None:
    module = _module_with_policy([], profile=_anvil_openyam_profile())
    pushed: list[object] = []
    published: list[object] = []
    module._pose_buffer = SimpleNamespace(  # type: ignore[assignment]
        push=lambda msg, ts_server: pushed.append(msg)
    )
    module._state_publisher = SimpleNamespace(  # type: ignore[assignment]
        publish_odom=published.append
    )
    module._last_corrected_xy = None
    module._speed_mps = 0.0
    module._policy = SimpleNamespace(  # type: ignore[assignment]
        on_odom=lambda _x, _y: ([], []),
        travel_m=0.0,
    )
    module._robot_observations = SimpleNamespace(expire=lambda _travel: None)  # type: ignore[assignment]
    module._flush_localization = lambda *_args: None  # type: ignore[method-assign]
    module._maybe_ingest_relocalization_transform = lambda _ts_server: None  # type: ignore[method-assign]
    pose = PoseStamped(
        ts=1.0,
        frame_id="world",
        position=[0.0, 0.0, 0.0],
        orientation=[0.0, 0.0, 0.0, 1.0],
    )
    await module.handle_odom(pose)
    assert pushed == [pose]
    assert published == [pose]


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
    assert '"type":"agent"' in broadcasts[0]
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


def test_human_input_requires_capability_and_transport() -> None:
    from dimos.ar.websocket.protocol import HumanInput

    published: list[str] = []
    module = _module_with_policy([])
    module.human_input = SimpleNamespace(transport=object(), publish=published.append)
    module._on_human_input(HumanInput(text="go"), None, "c1")  # type: ignore[arg-type]
    assert published == []

    module = _module_with_policy([], agent_available=True)
    module.human_input = SimpleNamespace(transport=None, publish=published.append)
    module._on_human_input(HumanInput(text="go"), None, "c1")  # type: ignore[arg-type]
    assert published == []

    module.human_input = SimpleNamespace(transport=object(), publish=published.append)
    module._on_human_input(HumanInput(text="go"), None, "c1")  # type: ignore[arg-type]
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
    assert module._ar_marker_ids == {"kitchen"}


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
    assert module._ar_marker_ids == set()
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
    assert "[1.0, 2.0, 3.0]" in text
    assert "[0.0, 0.0, 1.0]" in text
    module._client_pose_received_at = time.time() - 1.1
    assert "position" in module.ar_get_client_pose()
    module._client_pose_received_at = time.time() - 2.1
    assert module.ar_get_client_pose() == "No client pose"


def test_textual_ai_message_extracts_text_blocks() -> None:
    assert _textual_ai_message(HumanMessage(content="no")) is None
    assert _textual_ai_message(AIMessage(content="hello")) == "hello"
    assert (
        _textual_ai_message(AIMessage(content=[{"type": "text", "text": "block"}])) == "block"
    )
