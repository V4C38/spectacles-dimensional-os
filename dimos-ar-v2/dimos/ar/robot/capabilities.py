from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class CapabilityName(StrEnum):
    LIDAR = "lidar"
    NAVIGATION = "navigation"
    LOCALIZATION = "localization"
    ESTOP = "estop"


_ROBOT_CAPABILITIES = (
    CapabilityName.LIDAR,
    CapabilityName.NAVIGATION,
    CapabilityName.ESTOP,
)

_UNAVAILABLE_REASONS = {
    CapabilityName.LIDAR: "lidar not available on this robot",
    CapabilityName.NAVIGATION: "navigation not available on this robot",
    CapabilityName.ESTOP: "estop not available on this robot",
    CapabilityName.LOCALIZATION: "no localization provider configured",
}


@dataclass(frozen=True)
class Capability:
    available: bool
    reason: str | None

    def __post_init__(self) -> None:
        if self.available and self.reason is not None:
            raise ValueError("available capability must have reason=None")
        if not self.available and not self.reason:
            raise ValueError("unavailable capability requires a reason")


@dataclass(frozen=True)
class CapabilitySet:
    _items: dict[CapabilityName, Capability]

    @classmethod
    def from_supported(
        cls,
        supported: frozenset[CapabilityName],
        *,
        localization_available: bool,
    ) -> CapabilitySet:
        items: dict[CapabilityName, Capability] = {}
        for name in _ROBOT_CAPABILITIES:
            available = name in supported
            items[name] = Capability(
                available=available,
                reason=None if available else _UNAVAILABLE_REASONS[name],
            )
        items[CapabilityName.LOCALIZATION] = Capability(
            available=localization_available,
            reason=None
            if localization_available
            else _UNAVAILABLE_REASONS[CapabilityName.LOCALIZATION],
        )
        return cls(_items=items)

    def supports(self, name: CapabilityName) -> bool:
        return self._items[name].available

    def as_mapping(self) -> dict[CapabilityName, Capability]:
        return dict(self._items)
