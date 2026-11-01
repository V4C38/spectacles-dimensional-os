"""Real multi-socket transport with production ARModule interaction callbacks.

Only native robot ports and measurements are simulated. No per-client server
state or ownership logic is replaced by a fixture implementation.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
import websockets

from dimos.ar.navigation.coordinator import NavGoalCoordinator
from dimos.ar.test_module import _module_with_policy
from dimos.ar.websocket.server import WebSocketServer
from dimos.ar.websocket.test_server import ServerHarness, _sample_hello


async def receive(ws, kind, request_id=None):
    async with asyncio.timeout(2):
        while True:
            raw = await ws.recv()
            for line in raw.splitlines():
                frame = json.loads(line)
                if frame["type"] == kind and (
                    request_id is None or frame.get("request_id") == request_id
                ):
                    return frame


async def connect(url):
    ws = await websockets.connect(url)
    await ws.send(json.dumps({"type": "hello_request", "ts_client": 1.0}))
    hello = await receive(ws, "hello")
    state = await receive(ws, "interaction_state")
    return ws, hello["client_id"], state


@pytest.fixture
def runtime():
    h = ServerHarness()
    module = _module_with_policy([])
    goals, stops = [], []
    module._nav_goal_coordinator = NavGoalCoordinator(odom_scale_correction_factor=1.0)
    module.goal_request = SimpleNamespace(transport=object(), publish=goals.append)
    module.stop_movement = SimpleNamespace(transport=object(), publish=stops.append)
    h._thread.start()
    h._server = WebSocketServer(
        port=h.port,
        loop=h.loop,
        hello_supplier=_sample_hello,
        on_connect=module._on_client_connect,
        on_disconnect=module._on_client_disconnect,
        on_interaction_request=module._on_interaction_request,
        on_nav_goal_request=module._on_nav_goal_request,
        on_estop_request=module._on_estop_request,
        on_lidar_settings_request=module._on_lidar_settings_request,
    )
    module._ws_server = h._server
    h._server.start()
    h.loop.call_soon_threadsafe(module._start_interaction_poll)
    yield h, module, goals, stops
    if module._interaction_task:
        h.loop.call_soon_threadsafe(module._interaction_task.cancel)
    h.stop()


async def send(ws, identity, action, state, **extra):
    await ws.send(
        json.dumps(
            {
                "type": "interaction_request",
                "request_id": identity,
                "action": action,
                "epoch": state["epoch"],
                **extra,
            }
        )
    )
    return await receive(ws, "interaction_result", identity)


@pytest.mark.asyncio
async def test_selected_planner_excludes_second_socket_and_shared_target_survives_confirmation(
    runtime,
):
    h, _module, goals, _stops = runtime
    url = f"ws://127.0.0.1:{h.port}/ws"
    a, actor_a, initial = await connect(url)
    b, actor_b, _ = await connect(url)
    try:
        assert actor_a != actor_b
        granted = await send(
            a,
            "grab-a",
            "acquire",
            initial,
            kind="navigation_planning",
            source_id="right",
            position=[1, 2, 0],
            orientation=[0, 0, 0, 1],
        )
        assert granted["status"] == "accepted"
        lease = granted["lease_id"]
        blocked = await send(b, "grab-b", "acquire", initial, kind="live", source_id="left")
        assert blocked["status"] == "busy"
        released = await send(
            a,
            "first-release",
            "release",
            initial,
            lease_id=lease,
            sequence=1,
            position=[3, 4, 0],
            orientation=[0, 0, 0, 1],
        )
        assert released["status"] == "accepted" and not goals
        shared = await receive(b, "interaction_state")
        while shared["target"]["position"] != [3, 4, 0]:
            shared = await receive(b, "interaction_state")
        assert shared["authority"]["client_id"] == actor_a and not shared["authority"]["held"]
        assert (await send(b, "another-grab-b", "acquire", initial, kind="navigation_planning"))[
            "status"
        ] == "busy"
        confirmed = await send(
            a,
            "confirm",
            "confirm",
            initial,
            lease_id=lease,
            sequence=2,
            position=[3, 4, 0],
            orientation=[0, 0, 0, 1],
        )
        assert confirmed["status"] == "accepted" and len(goals) == 1
        c, _, snapshot = await connect(url)
        try:
            assert snapshot["authority"] is None
            assert snapshot["target"]["position"] == [3, 4, 0]
            assert snapshot["target"]["phase"] == "committed"
            assert snapshot["active_goal"]["pose"][:3] == [3, 4, 0]
        finally:
            await c.close()
        assert (await send(b, "handover", "acquire", initial, kind="live"))["status"] == "accepted"
    finally:
        await a.close()
        await b.close()


@pytest.mark.asyncio
async def test_unowned_motion_rejected_and_owner_disconnect_stops_with_observer(runtime):
    h, _module, goals, stops = runtime
    url = f"ws://127.0.0.1:{h.port}/ws"
    a, _, initial = await connect(url)
    b, _, _ = await connect(url)
    try:
        await b.send(
            json.dumps(
                {"type": "nav_goal_request", "position": [9, 0, 0], "orientation": [0, 0, 0, 1]}
            )
        )
        await send(b, "barrier", "snapshot", initial)
        assert not goals
        acquired = await send(
            a, "grab", "acquire", initial, kind="live", position=[1, 0, 0], orientation=[0, 0, 0, 1]
        )
        await a.send(
            json.dumps(
                {
                    "type": "nav_goal_request",
                    "epoch": initial["epoch"],
                    "lease_id": acquired["lease_id"],
                    "sequence": 1,
                    "position": [2, 0, 0],
                    "orientation": [0, 0, 0, 1],
                }
            )
        )
        await send(a, "barrier2", "snapshot", initial)
        assert len(goals) == 1
        await a.close()
        async with asyncio.timeout(2):
            while not stops:
                await asyncio.sleep(0.01)
        assert h._server.connection_count == 1
        result = await send(b, "takeover", "acquire", initial, kind="live")
        assert result["status"] == "accepted"
    finally:
        await a.close()
        await b.close()


@pytest.mark.asyncio
async def test_lidar_modes_remain_per_connection(runtime):
    h, module, _, _ = runtime
    a, actor_a, initial = await connect(f"ws://127.0.0.1:{h.port}/ws")
    b, actor_b, _ = await connect(f"ws://127.0.0.1:{h.port}/ws")
    try:
        await a.send(
            json.dumps(
                {
                    "type": "lidar_settings_request",
                    "enabled": True,
                    "min_height_m": 0.1,
                    "max_height_m": 1.5,
                    "max_range_m": 2.0,
                }
            )
        )
        await send(a, "barrier-lidar-a", "snapshot", initial)
        await b.send(
            json.dumps(
                {
                    "type": "lidar_settings_request",
                    "enabled": False,
                    "min_height_m": 0.1,
                    "max_height_m": 1.5,
                    "max_range_m": 5.0,
                }
            )
        )
        await send(b, "barrier-lidar-b", "snapshot", initial)
        assert module._lidar_subscriptions[actor_a].enabled
        assert not module._lidar_subscriptions[actor_b].enabled
        assert module._lidar_settings.enabled and module._lidar_settings.max_range_m == 2.0
    finally:
        await a.close()
        await b.close()
