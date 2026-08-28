from __future__ import annotations

from types import SimpleNamespace

import pytest

from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.module import (
    ARModule,
    ARModuleConfig,
    LocalizationConfig,
    LocalizationProviderConfig,
)
from dimos.ar.websocket.protocol import CapabilityName, LidarSettings, NavState, encode_state


class _FakeWs:
    def __init__(self) -> None:
        self.connection_count = 1
        self.sent: list[tuple[str, str]] = []
        self.broadcasts: list[str] = []

    def schedule_send_to_client(self, client_id: str, text: str) -> None:
        self.sent.append((client_id, text))

    def schedule_broadcast_text(self, text: str) -> None:
        self.broadcasts.append(text)


def _module_with_policy(providers: list[str]) -> ARModule:
    module = object.__new__(ARModule)
    module._policy = LocalizationPolicy(providers)
    module._ws_server = _FakeWs()  # type: ignore[assignment]
    module._lidar = LidarSettings(
        enabled=False, min_height_m=0.1, max_height_m=1.5, max_range_m=5.0
    )
    module._nav_goal_coordinator = SimpleNamespace(nav_state=lambda: NavState("idle", None))
    return module


def test_localization_config_defaults_empty() -> None:
    config = ARModuleConfig()
    assert config.localization.providers == []
    assert LocalizationConfig().providers == []


def test_hello_includes_estop_capability() -> None:
    module = _module_with_policy(["fiducial_marker"])
    hello = module._hello_body("c1")
    assert hello.capabilities[CapabilityName.ESTOP].available is True
    assert hello.capabilities[CapabilityName.ESTOP].reason is None
    assert hello.capabilities[CapabilityName.LOCALIZATION].available is True
    assert hello.capabilities[CapabilityName.LOCALIZATION].reason is None


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


def test_vps_provider_requires_map_code() -> None:
    module = object.__new__(ARModule)
    module.config = ARModuleConfig(
        localization=LocalizationConfig(providers=[LocalizationProviderConfig(type="vps")])
    )
    module._robot_pose_buffer = SimpleNamespace()  # type: ignore[assignment]
    with pytest.raises(ValueError, match="map_code"):
        module._build_localizers()
