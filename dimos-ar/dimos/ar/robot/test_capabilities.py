from __future__ import annotations

import pytest

from dimos.ar.robot.capabilities import (
    NAV_GOAL,
    NAV_JOYSTICK,
    Capability,
    CapabilityName,
    CapabilitySet,
)


def test_capability_set_from_supported() -> None:
    capabilities = CapabilitySet.from_supported(
        frozenset({CapabilityName.ESTOP}),
        localization_available=True,
        agent_available=False,
    )
    assert capabilities.supports(CapabilityName.ESTOP) is True
    assert capabilities.supports(CapabilityName.LIDAR) is False
    assert capabilities.supports(CapabilityName.NAVIGATION) is False
    assert capabilities.supports(CapabilityName.LOCALIZATION) is True
    assert capabilities.supports(CapabilityName.AGENT) is False
    assert capabilities.supports_navigation(NAV_GOAL) is False
    assert capabilities.supports_navigation(NAV_JOYSTICK) is False
    mapping = capabilities.as_mapping()
    assert mapping[CapabilityName.LIDAR].reason == "lidar not available on this robot"
    assert mapping[CapabilityName.LOCALIZATION].reason is None
    assert mapping[CapabilityName.AGENT].reason == "current blueprint has no DimOS agent"
    navigation = capabilities.navigation_as_mapping()
    assert navigation[NAV_GOAL].available is False
    assert navigation[NAV_JOYSTICK].available is False


def test_unavailable_capability_requires_reason() -> None:
    with pytest.raises(ValueError, match="reason"):
        Capability(available=False, reason=None)
    with pytest.raises(ValueError, match="reason"):
        Capability(available=True, reason="unexpected")


def test_parent_navigation_available_if_any_subset() -> None:
    capabilities = CapabilitySet.from_supported(
        frozenset({CapabilityName.NAVIGATION, CapabilityName.ESTOP}),
        localization_available=False,
        agent_available=False,
        supported_navigation_inputs=frozenset({NAV_JOYSTICK}),
    )
    assert capabilities.supports(CapabilityName.NAVIGATION) is True
    assert capabilities.supports_navigation(NAV_JOYSTICK) is True
    assert capabilities.supports_navigation(NAV_GOAL) is False
    mapping = capabilities.as_mapping()
    assert mapping[CapabilityName.NAVIGATION].available is True
    assert mapping[CapabilityName.NAVIGATION].reason is None


def test_supports_navigation_rejects_unknown_key() -> None:
    capabilities = CapabilitySet.from_supported(
        frozenset(),
        localization_available=False,
        agent_available=False,
    )
    with pytest.raises(ValueError, match="unknown navigation input"):
        capabilities.supports_navigation("tele_cmd_vel")
