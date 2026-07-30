from __future__ import annotations

from unittest.mock import MagicMock

from dimos.ar.bridge.safety import BridgeSafetyCoordinator
from dimos.ar.network.protocol import EmergencyStopMessage


def _make_safety() -> tuple[BridgeSafetyCoordinator, MagicMock, MagicMock, MagicMock, MagicMock]:
    nav = MagicMock()
    registration = MagicMock()
    motion_router = MagicMock()
    ar_skill_dispatcher = MagicMock()
    safety = BridgeSafetyCoordinator(
        nav=nav,
        registration=registration,
        motion_router=motion_router,
        ar_skill_dispatcher=ar_skill_dispatcher,
    )
    return safety, nav, registration, motion_router, ar_skill_dispatcher


def test_on_emergency_stop_delegates_to_nav_registration_and_cancels_skills() -> None:
    safety, nav, registration, motion_router, ar_skill_dispatcher = _make_safety()

    safety.on_emergency_stop(EmergencyStopMessage(ts=1.5, robot_id="test_robot"))

    ar_skill_dispatcher.cancel_all.assert_called_once_with("emergency_stop")
    nav.on_emergency_stop.assert_called_once_with(1.5)
    registration.on_emergency_stop.assert_called_once_with()
    motion_router.emergency_stop.assert_not_called()


def test_on_client_disconnect_stops_robot_and_cancels_skills() -> None:
    safety, nav, registration, motion_router, ar_skill_dispatcher = _make_safety()

    safety.on_client_disconnect()

    ar_skill_dispatcher.cancel_all.assert_called_once_with("client_disconnect")
    registration.clear_on_disconnect.assert_called_once_with()
    nav.reset_on_disconnect.assert_called_once_with()
    motion_router.emergency_stop.assert_called_once_with()
    motion_router.reset_intent.assert_called_once_with()
