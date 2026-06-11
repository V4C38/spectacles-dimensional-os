from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.spec.utils import Spec

from dimos_xr.tag_tracker import TagMount


@dataclass(frozen=True)
class CapabilityState:
    available: bool
    reason: str | None = None


@dataclass(frozen=True)
class RobotHandshake:
    robot_id: str
    robot_model: str
    display_name: str
    capabilities: list[str]
    capability_states: dict[str, CapabilityState]
    body_bounds_m: tuple[float, float, float] | None = None
    footprint_m: tuple[float, float] | None = None
    visual_origin_frame: str = "base_link"
    base_height_m: float | None = None
    default_render_offset_m: tuple[float, float, float] | None = None
    alignment_profile: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class XRRobotAdapterSpec(Spec, Protocol):
    def robot_id(self) -> str: ...

    def robot_model(self) -> str: ...

    def capabilities(self) -> dict[str, CapabilityState]: ...

    def handshake_payload(self) -> RobotHandshake: ...

    def send_nav_goal(self, goal: PoseStamped) -> bool: ...

    def cancel_goal(self) -> bool: ...

    def emergency_stop(self) -> bool: ...

    def supports_goal_orientation(self) -> bool: ...

    def tag_mounts(self) -> list[TagMount]: ...
