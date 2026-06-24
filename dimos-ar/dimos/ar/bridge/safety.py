"""BridgeSafetyCoordinator — centralized estop and client-disconnect policy."""

from __future__ import annotations

from typing import TYPE_CHECKING

from dimos.ar.network.protocol import EmergencyStopMessage

if TYPE_CHECKING:
    from dimos.ar.bridge.adapter_command_queue import AdapterCommandQueue
    from dimos.ar.bridge.navigation import NavController
    from dimos.ar.registration.session import RegistrationSession


class BridgeSafetyCoordinator:
    def __init__(
        self,
        *,
        nav: NavController,
        registration: RegistrationSession,
        command_queue: AdapterCommandQueue,
    ) -> None:
        self._nav = nav
        self._registration = registration
        self._command_queue = command_queue

    def on_emergency_stop(self, msg: EmergencyStopMessage) -> None:
        self._nav.on_emergency_stop(msg.ts)
        self._registration.on_emergency_stop()

    def on_client_disconnect(self) -> None:
        self._registration.clear_on_disconnect()
        self._nav.reset_on_disconnect()
        self._command_queue.submit_cancel_goal()
