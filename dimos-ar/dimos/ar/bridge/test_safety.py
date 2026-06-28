from __future__ import annotations

from unittest.mock import MagicMock

from dimos.ar.bridge.safety import BridgeSafetyCoordinator
from dimos.ar.network.protocol import EmergencyStopMessage


def test_on_emergency_stop_delegates_to_nav_and_registration() -> None:
    nav = MagicMock()
    registration = MagicMock()
    motion_router = MagicMock()
    safety = BridgeSafetyCoordinator(
        nav=nav,
        registration=registration,
        motion_router=motion_router,
    )

    safety.on_emergency_stop(EmergencyStopMessage(ts=1.5, robot_id="test_robot"))

    nav.on_emergency_stop.assert_called_once_with(1.5)
    registration.on_emergency_stop.assert_called_once_with()
    motion_router.emergency_stop.assert_not_called()


def test_on_client_disconnect_stops_robot_and_clears_intent() -> None:
    nav = MagicMock()
    registration = MagicMock()
    motion_router = MagicMock()
    safety = BridgeSafetyCoordinator(
        nav=nav,
        registration=registration,
        motion_router=motion_router,
    )

    safety.on_client_disconnect()

    registration.clear_on_disconnect.assert_called_once_with()
    nav.reset_on_disconnect.assert_called_once_with()
    motion_router.emergency_stop.assert_called_once_with()
    motion_router.cancel_nav_goal.assert_called_once_with()
    motion_router.reset_intent.assert_called_once_with()
