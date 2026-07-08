"""Tests for Go2RobotProfileModule and G1RobotProfileModule."""

from __future__ import annotations

from types import SimpleNamespace

from dimos.ar.robot_profile.base import (
    CapabilityState,
    RobotHandshake,
    merge_capability_availability,
)
from dimos.ar.robot_profile.g1 import G1RobotProfileModule
from dimos.ar.robot_profile.go2 import Go2RobotProfileModule


class _FakeStream:
    def __init__(self, *, connected: bool) -> None:
        self.transport = object() if connected else None
        self.published: list[object] = []

    def publish(self, msg: object) -> None:
        self.published.append(msg)


def _make_go2_profile() -> Go2RobotProfileModule:
    profile = object.__new__(Go2RobotProfileModule)
    profile._go2_connection = None
    profile.config = SimpleNamespace(robot_id="unitree_go2")
    return profile


def _make_g1_profile() -> G1RobotProfileModule:
    profile = object.__new__(G1RobotProfileModule)
    profile._g1_connection = None
    profile._g1_high_level = None
    profile.config = SimpleNamespace(robot_id="unitree_g1")
    return profile


def test_merge_capability_availability_overrides_profile_defaults() -> None:
    profile = _make_go2_profile()
    handshake = Go2RobotProfileModule.handshake_payload(profile)

    merged = merge_capability_availability(
        handshake,
        {"emergency_stop": False, "path": True},
    )

    assert merged.capability_states["emergency_stop"].available is False
    assert merged.capability_states["path"].available is True


def test_go2_robot_id_and_model() -> None:
    profile = _make_go2_profile()

    assert Go2RobotProfileModule.robot_id(profile) == "unitree_go2"
    assert Go2RobotProfileModule.robot_model(profile) == "unitree_go2"


def test_g1_capabilities_report_emergency_stop_unavailable_without_hw() -> None:
    profile = _make_g1_profile()

    capabilities = G1RobotProfileModule.capabilities(profile)

    assert capabilities["emergency_stop"].available is False
    assert "plan_preview" not in capabilities


def test_g1_robot_id_and_model() -> None:
    profile = _make_g1_profile()

    assert G1RobotProfileModule.robot_id(profile) == "unitree_g1"
    assert G1RobotProfileModule.robot_model(profile) == "unitree_g1"


def test_go2_registration_april_tag_capability_available() -> None:
    profile = _make_go2_profile()

    assert (
        Go2RobotProfileModule.capabilities(profile)["registration_april_tag"].available
        is True
    )


def test_g1_registration_april_tag_capability_available() -> None:
    profile = _make_g1_profile()

    assert (
        G1RobotProfileModule.capabilities(profile)["registration_april_tag"].available
        is True
    )


def test_go2_runtime_tag_tracking_profile_defaults() -> None:
    profile = _make_go2_profile()
    runtime = Go2RobotProfileModule.runtime_tag_tracking_profile(profile)
    assert runtime.runtime_static_speed_mps == 0.05
    assert runtime.runtime_speed_horizon_s == 0.4


def test_g1_runtime_tag_tracking_profile_overrides() -> None:
    profile = _make_g1_profile()
    runtime = G1RobotProfileModule.runtime_tag_tracking_profile(profile)
    assert runtime.runtime_static_speed_mps == 0.08
    assert runtime.runtime_speed_horizon_s == 0.9


def test_merge_capability_availability_preserves_handshake_metadata() -> None:
    handshake = RobotHandshake(
        robot_id="unitree_go2",
        display_name="Unitree Go2",
        capability_states={"nav": CapabilityState(True)},
        body_bounds_m=(0.7, 0.5, 0.55),
    )

    merged = merge_capability_availability(handshake, {"nav": False})

    assert merged.robot_id == handshake.robot_id
    assert merged.body_bounds_m == handshake.body_bounds_m
    assert merged.capability_states["nav"].available is False
