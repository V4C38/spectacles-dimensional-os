from __future__ import annotations

import pytest

from dimos.ar.robot.capabilities import Capability, CapabilityName, CapabilitySet


def test_capability_set_from_supported() -> None:
    capabilities = CapabilitySet.from_supported(
        frozenset({CapabilityName.ESTOP}),
        localization_available=True,
    )
    assert capabilities.supports(CapabilityName.ESTOP) is True
    assert capabilities.supports(CapabilityName.LIDAR) is False
    assert capabilities.supports(CapabilityName.NAVIGATION) is False
    assert capabilities.supports(CapabilityName.LOCALIZATION) is True
    mapping = capabilities.as_mapping()
    assert mapping[CapabilityName.LIDAR].reason == "lidar not available on this robot"
    assert mapping[CapabilityName.LOCALIZATION].reason is None


def test_unavailable_capability_requires_reason() -> None:
    with pytest.raises(ValueError, match="reason"):
        Capability(available=False, reason=None)
    with pytest.raises(ValueError, match="reason"):
        Capability(available=True, reason="unexpected")
