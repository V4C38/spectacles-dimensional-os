from __future__ import annotations

import json
import threading
from unittest.mock import MagicMock

from dimos_xr.bridge_status import BridgeStatusSnapshot
from dimos_xr.protocol import GetStatusMessage, encode_path
from dimos_xr.xr_bridge_module import XRBridge


def _make_bridge_stub() -> XRBridge:
    bridge = object.__new__(XRBridge)
    bridge._robot_id = "unitree_go2"
    bridge._ws_server = MagicMock()
    bridge._status_tracker = MagicMock()
    bridge._status_tracker.snapshot.return_value = BridgeStatusSnapshot(
        robot_id="unitree_go2",
        robot_connected=True,
        streams_active=True,
        registered=True,
        reconnecting=False,
        registration_method="marker",
        registration_approximate=False,
    )
    bridge._nav_state = "following_path"
    bridge._goal_reached = False
    bridge._goal_failed = False
    bridge._nav_recovering = False
    bridge._nav_error_code = None
    bridge._last_executing_path_payload = encode_path(
        ts=1.0,
        waypoints=[(1.0, 2.0, 3.0)],
        robot_id="unitree_go2",
    )
    bridge._nav_watchdog_lock = threading.Lock()
    return bridge


def test_runtime_sync_includes_bridge_nav_and_path() -> None:
    bridge = _make_bridge_stub()
    websocket = MagicMock()

    bridge._send_runtime_sync_to(websocket)

    payloads = [call.args[1] for call in bridge._ws_server.schedule_send_to.call_args_list]
    types = [json.loads(payload)["type"] for payload in payloads]
    assert types == ["bridge_status", "nav_status", "path"]
    nav_status = json.loads(payloads[1])
    assert nav_status["state"] == "following_path"


def test_get_status_triggers_runtime_sync() -> None:
    bridge = _make_bridge_stub()
    websocket = MagicMock()
    msg = GetStatusMessage(ts=1.0, robot_id="unitree_go2")

    bridge._on_get_status(msg, websocket)

    assert bridge._ws_server.schedule_send_to.call_count == 3
