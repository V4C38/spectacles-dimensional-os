"""World-frame goal resolution for navigation and preview."""

from __future__ import annotations

from dataclasses import dataclass

from dimos.ar.network.protocol import NavGoalMessage
from dimos.ar.world_frame.state import WorldFrameState


@dataclass(frozen=True)
class OdomGoal:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]
    ts: float | None


def resolve_world_goal(state: WorldFrameState, msg: NavGoalMessage) -> OdomGoal | None:
    if not state.is_committed:
        return None
    if msg.orientation is not None:
        odom_position, odom_orientation = state.inverse_transform_pose(
            msg.position,
            msg.orientation,
        )
    else:
        odom_position = state.inverse_transform_point(msg.position)
        odom_orientation = (0.0, 0.0, 0.0, 1.0)
    return OdomGoal(
        position=odom_position,
        orientation=odom_orientation,
        ts=msg.ts,
    )
