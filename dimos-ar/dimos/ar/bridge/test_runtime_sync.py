from __future__ import annotations

import json
from unittest.mock import MagicMock

from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.network.bridge_status import BridgeStatusSnapshot
from dimos.ar.network.protocol import GetStatusMessage


def _make_runtime_sync_stub() -> tuple[MagicMock, BridgeSender, MagicMock, MagicMock]:
    """Return (bridge, mock_server, mock_status, mock_nav)."""
    from dimos.ar.bridge.module import ARBridge

    bridge = object.__new__(ARBridge)

    mock_server = MagicMock()
    sender = BridgeSender()
    sender.bind(mock_server)
    bridge._sender = sender  # type: ignore[attr-defined]

    mock_status = MagicMock()
    bridge_snapshot = BridgeStatusSnapshot(
        robot_id="unitree_go2",
        robot_connected=True,
        streams_active=True,
        registered=True,
        reconnecting=False,
        registration_method=None,
        registration_approximate=False,
    )
    mock_status.snapshot.return_value = bridge_snapshot
    bridge._status = mock_status  # type: ignore[attr-defined]

    mock_adapter = MagicMock()
    mock_adapter.robot_id.return_value = "unitree_go2"
    bridge._adapter = mock_adapter  # type: ignore[attr-defined]
    bridge._robot_id = "unitree_go2"  # type: ignore[attr-defined]

    mock_nav = MagicMock()
    mock_nav.nav_phase_dict.return_value = {"phase": "navigating"}
    mock_nav.runtime_snapshot_path.return_value = {
        "kind": "active",
        "waypoints": [[1.0, 2.0, 3.0]],
    }
    bridge._nav = mock_nav  # type: ignore[attr-defined]

    return bridge, sender, mock_status, mock_nav


def test_runtime_sync_sends_single_runtime_snapshot() -> None:
    bridge, _sender, _mock_status, _mock_nav = _make_runtime_sync_stub()
    websocket = MagicMock()

    bridge._send_runtime_sync_to(websocket)  # type: ignore[attr-defined]

    send_to_calls = bridge._sender._server.schedule_send_to.call_args_list  # type: ignore[attr-defined]
    assert len(send_to_calls) == 1
    payload = json.loads(send_to_calls[0].args[1])
    assert payload["type"] == "runtime_snapshot"
    assert payload["robot_id"] == "unitree_go2"
    assert payload["nav"]["phase"] == "navigating"
    assert payload["path"]["kind"] == "active"
    assert "streams_active" not in payload["bridge"]


def test_get_status_triggers_runtime_sync() -> None:
    bridge, _sender, _mock_status, _mock_nav = _make_runtime_sync_stub()
    websocket = MagicMock()
    msg = GetStatusMessage(ts=1.0, robot_id="unitree_go2")

    bridge._on_get_status(msg, websocket)  # type: ignore[attr-defined]

    assert bridge._sender._server.schedule_send_to.call_count == 1  # type: ignore[attr-defined]
