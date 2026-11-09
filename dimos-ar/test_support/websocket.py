from __future__ import annotations

import asyncio
import json
import socket
import struct
import threading

import websockets

from dimos.ar.navigation.types import NavGoalRequest
from dimos.ar.robot.capabilities import NAV_GOAL, NAV_JOYSTICK, Capability, CapabilityName
from dimos.ar.robot.profiles.profile import RobotDescription
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
from dimos.ar.websocket.bulk import binary_chunks
from dimos.ar.websocket.protocol import (
    LOCALIZATION_OBSERVATIONS_FOURCC,
    HelloBody,
    LocalizationStartRequest,
)
from dimos.ar.websocket.server import WebSocketServer


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _sample_hello(_client_id: str) -> HelloBody:
    return HelloBody(
        server_info={"robot_ip": "10.0.0.42", "armodule_version": "0.2.0"},
        robot=RobotDescription(
            display_name=UNITREE_GO2_PROFILE.display_name,
            body_bounds_m=UNITREE_GO2_PROFILE.body_bounds_m,
            footprint_m=UNITREE_GO2_PROFILE.footprint_m,
            base_height_m=UNITREE_GO2_PROFILE.base_height_m,
        ),
        capabilities={
            CapabilityName.LIDAR: Capability(available=True, reason=None),
            CapabilityName.NAVIGATION: Capability(available=True, reason=None),
            CapabilityName.LOCALIZATION: Capability(available=True, reason=None),
            CapabilityName.ESTOP: Capability(available=True, reason=None),
            CapabilityName.AGENT: Capability(
                available=False, reason="current blueprint has no DimOS agent"
            ),
        },
        navigation_inputs={
            NAV_GOAL: Capability(available=True, reason=None),
            NAV_JOYSTICK: Capability(available=True, reason=None),
        },
    )


async def _send_hello_request(ws: websockets.ClientConnection, ts_client: float = 1000.0) -> dict:
    await ws.send(json.dumps({"type": "hello_request", "ts_client": ts_client}))
    raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
    return json.loads(raw)


async def _upload_localization(
    harness: ServerHarness, control, hello: dict, payload: bytes
) -> None:
    harness._server.schedule_send_to_client(
        hello["client_id"],
        json.dumps(
            {
                "type": "localization_observations_request",
                "capture_policy": "any_angle",
                "observation_count": 1,
            }
        )
        + "\n",
    )
    capture = json.loads(await control.recv())
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}{hello['bulk_url']}") as bulk:
        await bulk.send(
            json.dumps(
                {
                    "type": "bulk_hello_request",
                    "protocol_version": 2,
                    "client_id": hello["client_id"],
                    "token": hello["bulk_token"],
                }
            )
        )
        assert json.loads(await bulk.recv())["type"] == "bulk_hello"
        await bulk.send(
            json.dumps(
                {
                    "type": "bulk_upload_begin",
                    "kind": "localization",
                    "upload_id": 1,
                    "total_bytes": len(payload),
                    "capture_id": capture["capture_id"],
                }
            )
        )
        assert json.loads(await bulk.recv())["type"] == "bulk_upload_ready"
        for chunk in binary_chunks(1, payload):
            await bulk.send(chunk)
        assert json.loads(await bulk.recv())["status"] == "accepted"


class ServerHarness:
    def __init__(self, **handler_kwargs: object) -> None:
        self.port = _pick_free_port()
        self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._server: WebSocketServer | None = None
        self.nav_goal_requests: list[NavGoalRequest] = []
        self.localization_start_requests: list[str] = []
        self.disconnected_client_ids: list[str] = []
        self._handler_kwargs = handler_kwargs
        self._admission = threading.Condition()
        self._admitted: dict[str, object] = {}

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def _on_nav_goal_request(
        self, msg: NavGoalRequest, _websocket: object, _client_id: str
    ) -> None:
        self.nav_goal_requests.append(msg)

    def _on_localization_start_request(
        self, _msg: LocalizationStartRequest, client_id: str
    ) -> None:
        self.localization_start_requests.append(client_id)

    def _on_disconnect(self, _websocket: object, client_id: str) -> None:
        self.disconnected_client_ids.append(client_id)

    async def wait_for_connection(self, client_id: str, timeout: float = 1) -> None:
        """Wait for publication, which may follow client receipt of hello.

        Match the current socket so a resumed identity cannot reuse its old
        connection's admission notification.
        """
        def wait() -> bool:
            with self._admission:
                return self._admission.wait_for(
                    lambda: self._admitted.get(client_id) is not None
                    and self._server._connections.get(client_id) is self._admitted[client_id],
                    timeout,
                )

        assert await asyncio.to_thread(wait), f"Connection {client_id} was not admitted"

    def start(self) -> None:
        self._thread.start()
        handlers = dict(self._handler_kwargs)
        callback = handlers.pop("on_connect", None)

        def connected(websocket: object, client_id: str) -> None:
            if callback is not None:
                callback(websocket, client_id)
            with self._admission:
                self._admitted[client_id] = websocket
                self._admission.notify_all()

        self._server = WebSocketServer(
            port=self.port,
            loop=self.loop,
            hello_supplier=_sample_hello,
            on_nav_goal_request=self._on_nav_goal_request,
            on_localization_start_request=self._on_localization_start_request,
            on_disconnect=self._on_disconnect,
            on_connect=connected,
            **handlers,  # type: ignore[arg-type]
        )
        self._server.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.stop()
        self.loop.call_soon_threadsafe(self.loop.stop)
        self._thread.join(timeout=2.0)


def _encode_localization_observations_frame(jpeg: bytes, intrinsics_json: bytes) -> bytes:
    ts_capture = 1.0
    camera_position = struct.pack("<3f", 0.0, 0.0, 0.0)
    camera_orientation = struct.pack("<4f", 0.0, 0.0, 0.0, 1.0)
    record_body = (
        struct.pack("<dII", ts_capture, len(jpeg), len(intrinsics_json))
        + struct.pack("<I", 0)
        + camera_position
        + camera_orientation
        + jpeg
        + intrinsics_json
    )
    record = struct.pack("<I", len(record_body)) + record_body
    return struct.pack("<IH", LOCALIZATION_OBSERVATIONS_FOURCC, 1) + record


TYPESCRIPT_LOCA_ONE = bytes.fromhex(
    "41434f4c01009a000000000000000000f03f0400000066000000000000000000803f"
    "00000040000040400000000000000000000000000000803fffd8ffd97b226678223a"
    "3130302c226679223a3130302c226378223a35302c226379223a35302c2277696474"
    "68223a3130302c22686569676874223a3130302c22646973746f7274696f6e5f6d6f"
    "64656c223a226e6f6e65222c22646973746f7274696f6e223a5b5d7d"
)
