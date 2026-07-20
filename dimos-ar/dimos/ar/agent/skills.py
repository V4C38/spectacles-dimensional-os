"""AR navigation skills — LLM tools that submit goals through NavigateGoalHandler."""

from __future__ import annotations

from typing import Protocol

from dimos.agents.annotation import skill
from dimos.agents.capabilities import CAP_MOVEMENT
from dimos.core.module import Module
from dimos.spec.utils import Spec

AR_AGENT_SYSTEM_PROMPT = (
    "You are a robot assistant in an AR headset session. "
    "Answer in short text — responses are shown in the user's AR display; "
    "there is no speech output. "
    "Use relative_move for movement commands (meters and degrees). "
    "Positive forward is ahead, positive left is leftward, positive degrees is "
    "counter-clockwise. Use cancel_navigation to stop."
)


class ArNavigationSpec(Spec, Protocol):  # type: ignore[misc]
    def submit_relative_goal(self, forward: float, left: float, degrees: float) -> str: ...

    def cancel_navigation(self) -> str: ...


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
    def cancel_navigation(self) -> str:
        """Cancel the active navigation goal and stop the robot."""
        return self._ar_navigation.cancel_navigation()
