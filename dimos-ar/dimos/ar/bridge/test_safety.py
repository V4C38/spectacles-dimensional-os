from __future__ import annotations

from unittest.mock import MagicMock

from dimos.ar.bridge.safety import BridgeSafetyCoordinator
from dimos.ar.network.protocol import EmergencyStopMessage


def test_on_emergency_stop_delegates_to_nav_and_registration() -> None:
    nav = MagicMock()
    registration = MagicMock()
    command_queue = MagicMock()
    safety = BridgeSafetyCoordinator(
        nav=nav,
        registration=registration,
        command_queue=command_queue,
    )

    safety.on_emergency_stop(EmergencyStopMessage(ts=1.5, robot_id="test_robot"))

    nav.on_emergency_stop.assert_called_once_with(1.5)
    registration.on_emergency_stop.assert_called_once_with()
    command_queue.submit_cancel_goal.assert_not_called()


def test_on_client_disconnect_clears_registration_nav_and_cancels_goal() -> None:
    nav = MagicMock()
    registration = MagicMock()
    command_queue = MagicMock()
    safety = BridgeSafetyCoordinator(
        nav=nav,
        registration=registration,
        command_queue=command_queue,
    )

    safety.on_client_disconnect()

    registration.clear_on_disconnect.assert_called_once_with()
    nav.reset_on_disconnect.assert_called_once_with()
    command_queue.submit_cancel_goal.assert_called_once_with()
