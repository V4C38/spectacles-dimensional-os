from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any, Protocol

from dimos.ar.tag_tracking.solve import TagMount
from dimos.spec.utils import Spec
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


@dataclass(frozen=True)
class CapabilityState:
    available: bool
    reason: str | None = None


@dataclass(frozen=True)
class BaselineMotionRecipe:
    """Baseline strafe parameters shared by all robot profiles."""

    strafe_speed: float  # cmd_vel.linear.y stick deflection [-1, 1]; timer-controlled legs
    leg_duration_s: tuple[float, float, float]
    leg_directions: tuple[float, float, float]
    leg_distance_multipliers: tuple[float, float, float]
    move_leg_target_m: float = 0.2


DEFAULT_BASELINE_MOTION_RECIPE = BaselineMotionRecipe(
    strafe_speed=0.4,
    leg_duration_s=(2.0, 3.5, 2.0),
    leg_directions=(1.0, -1.0, 1.0),
    leg_distance_multipliers=(1.0, 1.75, 1.0),
)


@dataclass(frozen=True)
class TagTrackingProfile:
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
    tag_tracking_profile: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class ARRobotProfileSpec(Spec, Protocol):  # type: ignore[misc]
    def robot_id(self) -> str: ...

    def robot_model(self) -> str: ...

    def capabilities(self) -> dict[str, CapabilityState]: ...

    def handshake_payload(self) -> RobotHandshake: ...

    def supports_goal_orientation(self) -> bool: ...

    def tag_mounts(self) -> list[TagMount]: ...

    def baseline_motion_available(self) -> bool: ...

    def baseline_motion_recipe(self) -> BaselineMotionRecipe: ...

    def runtime_tag_tracking_profile(self) -> TagTrackingProfile: ...

    def emergency_stop(self) -> bool: ...


def merge_capability_availability(
    handshake: RobotHandshake,
    overrides: dict[str, bool],
) -> RobotHandshake:
    capability_states = dict(handshake.capability_states)
    for name, available in overrides.items():
        previous = capability_states.get(name)
        reason = None if available else (
            previous.reason
            if previous is not None and previous.reason is not None
            else f"{name} transport is not present for this runtime."
        )
        capability_states[name] = CapabilityState(available, reason)
    return RobotHandshake(
        robot_id=handshake.robot_id,
        display_name=handshake.display_name,
        capability_states=capability_states,
        body_bounds_m=handshake.body_bounds_m,
        footprint_m=handshake.footprint_m,
        visual_origin_frame=handshake.visual_origin_frame,
        base_height_m=handshake.base_height_m,
        default_render_offset_m=handshake.default_render_offset_m,
        tag_tracking_profile=handshake.tag_tracking_profile,
        extra=handshake.extra,
    )


def resolve_baseline_motion_recipe(profile: ARRobotProfileSpec) -> BaselineMotionRecipe:
    try:
        recipe = profile.baseline_motion_recipe()
        if (
            isinstance(recipe, BaselineMotionRecipe)
            and math.isfinite(recipe.strafe_speed)
            and recipe.strafe_speed > 0
        ):
            logger.info(
                "Baseline motion recipe resolved",
                strafe_speed=recipe.strafe_speed,
            )
            return recipe
    except Exception as exc:
        logger.warning(
            "baseline_motion_recipe failed; using default",
            error=str(exc),
            default=DEFAULT_BASELINE_MOTION_RECIPE,
        )
    return DEFAULT_BASELINE_MOTION_RECIPE
