from __future__ import annotations

from unittest.mock import MagicMock

from dimos.ar.bridge.module import ARBridge


def test_on_client_disconnect_skips_safety_when_clients_remain() -> None:
    bridge = ARBridge.__new__(ARBridge)
    bridge._ws_server = MagicMock()
    bridge._ws_server.connection_count = 1
    bridge._safety = MagicMock()
    bridge._telemetry = MagicMock()

    bridge._on_client_disconnect(MagicMock())

    bridge._safety.on_client_disconnect.assert_not_called()
    bridge._telemetry.reset_lidar_mode.assert_not_called()


def test_on_client_disconnect_runs_safety_when_last_client_gone() -> None:
    bridge = ARBridge.__new__(ARBridge)
    bridge._ws_server = MagicMock()
    bridge._ws_server.connection_count = 0
    bridge._safety = MagicMock()
    bridge._telemetry = MagicMock()

    bridge._on_client_disconnect(MagicMock())

    bridge._safety.on_client_disconnect.assert_called_once_with()
    bridge._telemetry.reset_lidar_mode.assert_called_once_with()
