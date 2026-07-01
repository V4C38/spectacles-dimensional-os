"""BridgeSafetyCoordinator — centralized estop and client-disconnect policy."""

from __future__ import annotations

from typing import TYPE_CHECKING

from dimos.ar.network.protocol import EmergencyStopMessage
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

if TYPE_CHECKING:
    from dimos.ar.bridge.motion_router import MotionRouter
    from dimos.ar.navigation.navigate import NavigateGoalHandler
    from dimos.ar.registration.session import RegistrationSession


class BridgeSafetyCoordinator:
    def __init__(
        self,
        *,
        nav: NavigateGoalHandler,
        registration: RegistrationSession,
        motion_router: MotionRouter,
    ) -> None:
        self._nav = nav
        self._registration = registration
        self._motion_router = motion_router

    def on_emergency_stop(self, msg: EmergencyStopMessage) -> None:
        logger.info("XR emergency_stop received")
        self._nav.on_emergency_stop(msg.ts)
        self._registration.on_emergency_stop()

    def on_client_disconnect(self) -> None:
        logger.info("XR client disconnect handled nav_reset=true registration_cleared=true")
        self._registration.clear_on_disconnect()
        self._nav.reset_on_disconnect()
        self._motion_router.emergency_stop()
        self._motion_router.cancel_nav_goal()
        self._motion_router.reset_intent()
