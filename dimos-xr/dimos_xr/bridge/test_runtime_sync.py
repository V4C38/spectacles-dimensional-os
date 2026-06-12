from __future__ import annotations

import json
from unittest.mock import MagicMock

from dimos_xr.bridge.sender import BridgeSender
from dimos_xr.network.protocol import GetStatusMessage, encode_path


def _make_runtime_sync_stub() -> tuple[MagicMock, BridgeSender, MagicMock, MagicMock]:
    """Return (bridge, mock_server, mock_status, mock_nav).

    Builds a minimal stand-in for XRBridge that exercises _send_runtime_sync_to
    without requiring a full DimOS Module construction.
    """
    from dimos_xr.bridge.module import XRBridge

    bridge = object.__new__(XRBridge)

    mock_server = MagicMock()
    sender = BridgeSender()
    sender.bind(mock_server)
    bridge._sender = sender  # type: ignore[attr-defined]

    mock_status = MagicMock()
    mock_status.status_payload.return_value = json.dumps(
        {
            "type": "bridge_status",
            "robot_id": "unitree_go2",
            "robot_connected": True,
            "streams_active": True,
            "registered": True,
            "reconnecting": False,
        }
    )
    bridge._status = mock_status  # type: ignore[attr-defined]

    last_path = encode_path(
        ts=1.0,
        waypoints=[(1.0, 2.0, 3.0)],
        robot_id="unitree_go2",
    )
    mock_nav = MagicMock()
    mock_nav.nav_status_payload.return_value = json.dumps(
        {
            "type": "nav_status",
            "state": "following_path",
            "goal_reached": False,
            "goal_failed": False,
            "recovering": False,
            "error_code": None,
            "robot_id": "unitree_go2",
        }
    )
    mock_nav.last_executing_path_payload = last_path
    bridge._nav = mock_nav  # type: ignore[attr-defined]

    return bridge, sender, mock_status, mock_nav


def test_runtime_sync_includes_bridge_nav_and_path() -> None:
    bridge, _sender, _mock_status, _mock_nav = _make_runtime_sync_stub()
    websocket = MagicMock()

    bridge._send_runtime_sync_to(websocket)  # type: ignore[attr-defined]

    payloads = [call.args[1] for call in websocket.mock_calls if call[0] == ""]
    # schedule_send_to is called as mock_server.schedule_send_to(ws, payload)
    send_to_calls = [
        call
        for call in bridge._sender._server.schedule_send_to.call_args_list  # type: ignore[attr-defined]
    ]
    payloads = [call.args[1] for call in send_to_calls]
    types = [json.loads(payload)["type"] for payload in payloads]
    assert types == ["bridge_status", "nav_status", "path"]
    nav_status = json.loads(payloads[1])
    assert nav_status["state"] == "following_path"


def test_get_status_triggers_runtime_sync() -> None:
    bridge, _sender, _mock_status, _mock_nav = _make_runtime_sync_stub()
    websocket = MagicMock()
    msg = GetStatusMessage(ts=1.0, robot_id="unitree_go2")

    bridge._on_get_status(msg, websocket)  # type: ignore[attr-defined]

    assert bridge._sender._server.schedule_send_to.call_count == 3  # type: ignore[attr-defined]
