from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from dimos.ar.tracking.robot_tag_tracker import TagMount
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.spec.utils import Spec


@dataclass(frozen=True)
class CapabilityState:
    available: bool
    reason: str | None = None


@dataclass(frozen=True)
class BaselineMotionRecipe:
    strafe_speed: float
    leg_duration_s: tuple[float, float, float]
    leg_directions: tuple[float, float, float]
    leg_distance_multipliers: tuple[float, float, float]
    move_leg_target_m: float = 0.20


DEFAULT_BASELINE_MOTION_RECIPE = BaselineMotionRecipe(
    strafe_speed=0.3,
    leg_duration_s=(2.0, 4.0, 2.0),
    leg_directions=(1.0, -1.0, 1.0),
    leg_distance_multipliers=(1.0, 2.0, 1.0),
)


@dataclass(frozen=True)
class RuntimeRegistrationProfile:
    runtime_static_speed_mps: float = 0.05
    runtime_max_correct_speed_mps: float = 1.5
    runtime_cruise_window_s: float = 12.0
    runtime_speed_horizon_s: float = 0.4
    runtime_yaw_min_baseline_m: float = 0.40
    runtime_yaw_straightness_max: float = 0.20


@dataclass(frozen=True)
class RobotHandshake:
    robot_id: str
    display_name: str
    capability_states: dict[str, CapabilityState]
    body_bounds_m: tuple[float, float, float] | None = None
    footprint_m: tuple[float, float] | None = None
    visual_origin_frame: str = "base_link"
    base_height_m: float | None = None
    default_render_offset_m: tuple[float, float, float] | None = None
    registration_profile: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class ARRobotAdapterSpec(Spec, Protocol):  # type: ignore[misc]
    def robot_id(self) -> str: ...

    def robot_model(self) -> str: ...

    def capabilities(self) -> dict[str, CapabilityState]: ...

    def handshake_payload(self) -> RobotHandshake: ...

    def send_nav_goal(self, goal: PoseStamped) -> bool: ...

    def cancel_goal(self) -> bool: ...

    def emergency_stop(self) -> bool: ...

    def supports_goal_orientation(self) -> bool: ...

    def tag_mounts(self) -> list[TagMount]: ...

    def baseline_motion_available(self) -> bool: ...

    def baseline_set_lateral_velocity(self, vy_m_s: float) -> bool: ...

    def baseline_motion_recipe(self) -> BaselineMotionRecipe: ...

    def runtime_registration_profile(self) -> RuntimeRegistrationProfile: ...
