from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class CapabilityName(StrEnum):
    OBJECT_DETECTION = "object_detection"
    MANIPULATION = "manipulation"
    LIDAR = "lidar"
    NAVIGATION = "navigation"
    LOCALIZATION = "localization"
    ESTOP = "estop"
    AGENT = "agent"


NAV_GOAL = "nav_goal"
NAV_JOYSTICK = "nav_joystick"
NAVIGATION_INPUT_NAMES: tuple[str, ...] = (NAV_GOAL, NAV_JOYSTICK)
NAVIGATION_INPUT_NAME_SET = frozenset(NAVIGATION_INPUT_NAMES)

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
    CapabilityName.AGENT: "current blueprint has no DimOS agent",
}

_NAVIGATION_INPUT_REASONS = {
    NAV_GOAL: "nav_goal not available on this robot",
    NAV_JOYSTICK: "nav_joystick not available on this robot",
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


def _capability(available: bool, reason: str) -> Capability:
    return Capability(available=available, reason=None if available else reason)


@dataclass(frozen=True)
class CapabilitySet:
    _items: dict[CapabilityName, Capability]
    _navigation: dict[str, Capability]

    @classmethod
    def from_supported(
        cls,
        supported: frozenset[CapabilityName],
        *,
        localization_available: bool,
        agent_available: bool,
        manipulation_available: bool = False,
        object_detection_available: bool = False,
        supported_navigation_inputs: frozenset[str] = frozenset(),
    ) -> CapabilitySet:
        unknown = supported_navigation_inputs - NAVIGATION_INPUT_NAME_SET
        if unknown:
            raise ValueError(f"unknown navigation inputs: {sorted(unknown)}")
        items: dict[CapabilityName, Capability] = {}
        for name in _ROBOT_CAPABILITIES:
            if name is CapabilityName.NAVIGATION:
                available = bool(supported_navigation_inputs)
            else:
                available = name in supported
            items[name] = _capability(available, _UNAVAILABLE_REASONS[name])
        items[CapabilityName.LOCALIZATION] = _capability(
            localization_available,
            _UNAVAILABLE_REASONS[CapabilityName.LOCALIZATION],
        )
        items[CapabilityName.AGENT] = _capability(
            agent_available,
            _UNAVAILABLE_REASONS[CapabilityName.AGENT],
        )
        navigation = {
            name: _capability(name in supported_navigation_inputs, _NAVIGATION_INPUT_REASONS[name])
            for name in NAVIGATION_INPUT_NAMES
        }
        items[CapabilityName.OBJECT_DETECTION] = _capability(
            object_detection_available, "current blueprint has no object detector"
        )
        if manipulation_available:
            items[CapabilityName.MANIPULATION] = Capability(True, None)
        return cls(_items=items, _navigation=navigation)

    def supports(self, name: CapabilityName) -> bool:
        capability = self._items.get(name)
        return capability.available if capability is not None else False

    def supports_navigation(self, name: str) -> bool:
        if name not in NAVIGATION_INPUT_NAME_SET:
            raise ValueError(f"unknown navigation input {name!r}")
        return self._navigation[name].available

    def as_mapping(self) -> dict[CapabilityName, Capability]:
        return dict(self._items)

    def navigation_as_mapping(self) -> dict[str, Capability]:
        return dict(self._navigation)


def blueprint_has_object_detection(blueprint: object) -> bool:
    """Recognize detector providers, not agent presence or AprilTag modules."""
    return any(
        any(
            cls.__module__.startswith("dimos.perception.detection.")
            and cls.__name__ in {"Detection2DModule", "Detection3DModule"}
            for cls in atom.module.__mro__
        )
        for atom in getattr(blueprint, "active_blueprints", ())
    )
