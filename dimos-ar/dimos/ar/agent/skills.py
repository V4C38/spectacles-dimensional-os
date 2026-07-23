"""AR navigation and annotation skills — LLM tools via ARBridge RPCs."""

from __future__ import annotations

from typing import Protocol
import uuid

from dimos.agents.annotation import skill
from dimos.agents.capabilities import CAP_MOVEMENT
from dimos.core.module import Module
from dimos.spec.utils import Spec

AR_AGENT_SYSTEM_PROMPT = (
    "You are a robot assistant in an AR headset session. "
    "Answer in short text — responses are shown in the user's AR display; "
    "there is no speech output. "
    "All coordinates are robot-relative meters: positive forward is ahead, "
    "positive left is leftward, positive up is upward; positive degrees is "
    "counter-clockwise from the robot's current heading. "
    "A marker at the robot itself is (forward=0, left=0). "
    "Use relative_move for movement commands. "
    "Use navigate_to_user when the user asks you to come to them / come here. "
    "Call get_user_pose to locate the user before place_marker or draw_line "
    "involving them (e.g. mark where I am, draw a line from you to me). "
    "Use place_marker and draw_line for AR annotations; use clear_annotation "
    "to remove them. Use cancel_navigation to stop. "
    "After any tool returns an error or failure, always reply with one short "
    "user-facing sentence explaining what failed and what to try next. "
    "Never finish a turn with only tool calls and no text — the AR display "
    "has no speech; your text reply is the only feedback channel."
)


class ArNavigationSpec(Spec, Protocol):  # type: ignore[misc]
    def submit_relative_goal(self, forward: float, left: float, degrees: float) -> str: ...

    def navigate_to_user(self) -> str: ...

    def get_user_pose(self) -> str: ...

    def cancel_navigation(self) -> str: ...


class ArAnnotationSpec(Spec, Protocol):  # type: ignore[misc]
    def draw_world_annotation(
        self,
        *,
        annotation_id: str,
        kind: str | None = None,
        points: list[list[float]] | None = None,
        label: str | None = None,
        active: bool = True,
        duration_s: float | None = None,
        color: list[float] | None = None,
    ) -> str: ...


class ArNavigationSkillContainer(Module):  # type: ignore[misc]
    _ar_navigation: ArNavigationSpec

    @skill(uses=[CAP_MOVEMENT])
    def relative_move(
        self,
        forward: float = 0.0,
        left: float = 0.0,
        degrees: float = 0.0,
    ) -> str:
        """Move the robot relative to its current pose.

        Args:
            forward: Meters ahead (negative = backward).
            left: Meters to the left (negative = right).
            degrees: Counter-clockwise yaw change at the target (negative = clockwise).

        Examples:
            relative_move(forward=2, left=0, degrees=0)
            relative_move(forward=0, left=0, degrees=-90)
            relative_move(forward=1, left=1, degrees=45)
        """
        return self._ar_navigation.submit_relative_goal(
            float(forward),
            float(left),
            float(degrees),
        )

    @skill(uses=[CAP_MOVEMENT])
    def navigate_to_user(self) -> str:
        """Come to the user / come here — approach the AR headset position."""
        return self._ar_navigation.navigate_to_user()

    @skill()
    def get_user_pose(self) -> str:
        """Where the user is relative to the robot (meters ahead/left/up, facing degrees).

        Call before placing markers or drawing lines that involve the user.
        """
        return self._ar_navigation.get_user_pose()

    @skill(uses=[CAP_MOVEMENT])
    def cancel_navigation(self) -> str:
        """Cancel the active navigation goal and stop the robot."""
        return self._ar_navigation.cancel_navigation()


class ArAnnotationSkillContainer(Module):  # type: ignore[misc]
    _ar_annotation: ArAnnotationSpec

    @skill()
    def place_marker(
        self,
        forward: float,
        left: float,
        up: float = 0.0,
        label: str = "",
        annotation_id: str | None = None,
        duration_s: float | None = None,
    ) -> str:
        """Place a world-anchored marker relative to the robot's current pose.

        Args:
            forward: Meters ahead of the robot (negative = behind).
            left: Meters to the left of the robot (negative = right).
            up: Meters above the robot (negative = below).
            label: Optional text shown on the marker.
            annotation_id: Stable id; omit to auto-generate.
            duration_s: Auto-remove after N seconds; omit to persist.
        """
        ann_id = (
            annotation_id.strip()
            if isinstance(annotation_id, str) and annotation_id.strip()
            else uuid.uuid4().hex[:8]
        )
        return self._ar_annotation.draw_world_annotation(
            annotation_id=ann_id,
            kind="marker",
            points=[[float(forward), float(left), float(up)]],
            label=str(label) if label else None,
            active=True,
            duration_s=float(duration_s) if duration_s is not None else None,
        )

    @skill()
    def draw_line(
        self,
        forward1: float,
        left1: float,
        up1: float,
        forward2: float,
        left2: float,
        up2: float,
        annotation_id: str | None = None,
        duration_s: float | None = None,
        color_r: float | None = None,
        color_g: float | None = None,
        color_b: float | None = None,
    ) -> str:
        """Draw a world-anchored line between two robot-relative points.

        Args:
            forward1, left1, up1: Start point in meters relative to the robot.
            forward2, left2, up2: End point in meters relative to the robot.
            annotation_id: Stable id; omit to auto-generate.
            duration_s: Auto-remove after N seconds; omit to persist.
            color_r, color_g, color_b: Optional RGB in 0..1 for the whole line.
        """
        ann_id = (
            annotation_id.strip()
            if isinstance(annotation_id, str) and annotation_id.strip()
            else uuid.uuid4().hex[:8]
        )
        color: list[float] | None = None
        if color_r is not None or color_g is not None or color_b is not None:
            color = [
                float(color_r if color_r is not None else 1.0),
                float(color_g if color_g is not None else 1.0),
                float(color_b if color_b is not None else 0.0),
            ]
        return self._ar_annotation.draw_world_annotation(
            annotation_id=ann_id,
            kind="line",
            points=[
                [float(forward1), float(left1), float(up1)],
                [float(forward2), float(left2), float(up2)],
            ],
            active=True,
            duration_s=float(duration_s) if duration_s is not None else None,
            color=color,
        )

    @skill()
    def clear_annotation(self, annotation_id: str) -> str:
        """Remove a previously drawn world annotation by id."""
        return self._ar_annotation.draw_world_annotation(
            annotation_id=str(annotation_id),
            active=False,
        )
