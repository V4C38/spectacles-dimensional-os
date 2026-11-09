from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import Mock

from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.module import (
    ARModule,
    ARModuleConfig,
)
from dimos.ar.navigation.preview_service import NavigationPreviewService
from dimos.ar.navigation.types import NavState
from dimos.ar.replication.interaction import InteractionCoordinator, InteractionRequest
from dimos.ar.robot.agent_service import ARAgentService
from dimos.ar.robot.capabilities import CapabilityName, CapabilitySet
from dimos.ar.robot.odometry import RobotOdometry
from dimos.ar.robot.profiles.profile import RobotProfile
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
from dimos.ar.robot.safety import Safety
from dimos.ar.sensors.lidar_settings import LidarSettings


class _FakeWs:
    def __init__(self) -> None:
        self.connection_count = 1
        self.sent: list[tuple[str, str]] = []
        self.broadcasts: list[str] = []
        self.interaction_sent: list[tuple[str, str]] = []
        self.state_sent: list[tuple[str, str]] = []
        self.interaction_broadcasts: list[str] = []

    @property
    def logical_session_count(self):
        return self.connection_count

    async def prepare_outbound_async(self, value):
        return value

    def schedule_send_to_client(self, client_id: str, text: str) -> None:
        if json.loads(text).get("type", "").startswith("interaction_"):
            self.interaction_sent.append((client_id, text))
        elif json.loads(text).get("type") == "state":
            self.state_sent.append((client_id, text))
        else:
            self.sent.append((client_id, text))

    def schedule_broadcast_text(self, text: str) -> None:
        if json.loads(text).get("type", "").startswith("interaction_"):
            self.interaction_broadcasts.append(text)
        else:
            self.broadcasts.append(text)


def _module_with_policy(
    providers: list[str],
    *,
    profile: RobotProfile = UNITREE_GO2_PROFILE,
    agent_available: bool = False,
) -> ARModule:
    module = object.__new__(ARModule)
    module.config = ARModuleConfig()
    module._interaction = InteractionCoordinator()
    module._lidar_subscriptions = {}
    module._native_sequences = {}
    module._allow_unfenced_navigation = True
    module._interaction_sent_revision = -1
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


def _arm_module_with_two_clients() -> ARModule:
    module = _module_with_policy([])
    module._capabilities = CapabilitySet.from_supported(
        frozenset(),
        localization_available=False,
        agent_available=False,
        manipulation_available=True,
    )
    module._manipulation_service = Mock()
    for client_id in ("a", "b"):
        module._interaction.connect(client_id)
    return module


def _arm_grab(module: ARModule, client_id: str, *, planning: bool = False) -> None:
    module._on_interaction_request(
        InteractionRequest(
            f"grab-{client_id}-{len(module._ws_server.interaction_sent)}",
            "acquire",
            module._interaction.epoch,
            kind="manipulation_planning" if planning else "manipulation_following",
            source_id="right-hand",
            group_id="arm",
            position=(0.1, 0.2, 0.3),
            orientation=(0, 0, 0, 1),
        ),
        client_id,
    )


def _release_arm_grab(module: ARModule) -> None:
    authority = module._interaction.authority
    assert authority is not None
    module._on_interaction_request(
        InteractionRequest(
            "release-a",
            "release",
            module._interaction.epoch,
            lease_id=authority.lease_id,
            sequence=0,
            position=(0.1, 0.2, 0.3),
            orientation=(0, 0, 0, 1),
        ),
        "a",
    )
