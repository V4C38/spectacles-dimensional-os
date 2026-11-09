#!/usr/bin/env python3
"""Synthetic transport benchmark; no hardware or physical-motion commands.

Run from the repository with the installed DimOS Python environment. Results are
application bytes and local loopback timings, excluding TCP/TLS and headset work.
The descriptor, observations, trajectory, and five peers are synthetic fixtures.
"""

import asyncio
import json
import math
import socket
import statistics
import sys
import threading
import time
from contextlib import AsyncExitStack
from pathlib import Path

import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "dimos-ar"))
from dimos.ar.robot.capabilities import (
    NAV_GOAL,
    NAV_JOYSTICK,
    Capability,
    CapabilityName,
)
from dimos.ar.robot.profiles.profile import RobotDescription
from dimos.ar.websocket.bulk import BulkAssetStore
from dimos.ar.websocket.protocol import HelloBody
from dimos.ar.websocket.server import WebSocketServer


def sample_hello(_client):
    return HelloBody(
        robot=RobotDescription(
            display_name="Synthetic arm",
            body_bounds_m=(0.2, 0.2, 0.2),
            footprint_m=(0.2, 0.2),
            base_height_m=0.2,
        ),
        capabilities={name: Capability(True, None) for name in CapabilityName},
        navigation_inputs={NAV_GOAL: Capability(True, None), NAV_JOYSTICK: Capability(True, None)},
    )


async def _send_hello_request(socket):
    await socket.send(json.dumps({"type": "hello_request", "protocol_version": 2, "ts_client": time.time()}))
    return json.loads(await socket.recv())


class ServerHarness:
    def __init__(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self._handler_kwargs = {}

    def start(self):
        self.thread.start()
        self._server = WebSocketServer(
            port=self.port,
            loop=self.loop,
            hello_supplier=sample_hello,
            **self._handler_kwargs,
        )
        self._server.start()

    def stop(self):
        self._server.stop()
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(2)


def payload(joints, count):
    model = {
        "revision": "x" * 64,
        "visual_signature": "y" * 64,
        "root": "base",
        "links": [
            {
                "name": f"link{i}",
                "bounds": {"center": [0.0, 0.0, 0.0], "size": [0.1, 0.1, 0.2]},
            }
            for i in range(joints + 1)
        ],
        "joints": [
            {
                "name": f"j{i}",
                "parent": f"link{i}",
                "child": f"link{i + 1}",
                "kind": "revolute",
                "axis": [0.0, 0.0, 1.0],
                "origin": {
                    "position": [0.0, 0.0, 0.1],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                },
                "limits": {"lower": -3.14, "upper": 3.14},
                "mimic": None,
            }
            for i in range(joints)
        ],
        "asset_url": "/models/arm.glb",
        "gripper_joints": {},
    }
    plan = (
        {
            "plan_id": "p" * 32,
            "joint_names": [f"j{i}" for i in range(joints)],
            "target_revision": 7,
            "group_id": "arm",
            "duration": count * 0.01,
            "trajectory": [
                {
                    "time": i * 0.01,
                    "positions": [
                        math.sin(i * 0.001 + j) * 1.123456789 for j in range(joints)
                    ],
                }
                for i in range(count)
            ],
        }
        if count
        else None
    )
    return {
        "type": "manipulation_state",
        "available": True,
        "ts": 1234.567,
        "model": model,
        "groups": [
            {
                "id": "arm",
                "joint_names": [f"j{i}" for i in range(joints)],
                "base_frame": "base",
                "tip_frame": "tool",
                "following": True,
                "has_gripper": True,
            }
        ],
        "observations": {
            "arm": {
                "joints": {f"j{i}": 0.123456789 for i in range(joints)},
                "pose": {"position": [0.1, 0.2, 0.3], "orientation": [0, 0, 0, 1]},
                "measured_at": 1234.56,
                "gripper": 0.5,
            }
        },
        "execution": "idle",
        "owner": None,
        "following": False,
        "stopped": False,
        "stop_confirmed": False,
        "plan": plan,
        "operation_id": None,
    }


p = payload(6, 1000)
p["model"]["root"] = "link0"
p["groups"][0]["base_frame"] = "link0"
p["groups"][0]["tip_frame"] = "link6"
store = BulkAssetStore()
begin = time.perf_counter()
compact = store.compact(p)
cold = (time.perf_counter() - begin) * 1000
raw = json.dumps(p, separators=(",", ":"))
current = json.dumps(compact, separators=(",", ":")) + "\n"
times = []
for _ in range(100):
    begin = time.perf_counter()
    json.dumps(store.compact(p), separators=(",", ":"))
    times.append((time.perf_counter() - begin) * 1000)
asset_bytes = sum(
    store.get(k, compact[f]).size
    for k, f in [("model", "model_ref"), ("trajectory", "plan_ref")]
)
print(
    json.dumps(
        {
            "complete_representative_6j1000": {
                "old_state_bytes": len(raw) + 1,
                "compact_state_bytes": len(current),
                "cold_asset_packing_ms": round(cold, 2),
                "cached_compact_encode_median_ms": round(statistics.median(times), 4),
                "one_time_bulk_bytes_each_peer": asset_bytes,
                "five_peers_10Hz_control_state_bytes_s": len(current) * 50,
                "five_peers_one_time_asset_bytes": asset_bytes * 5,
            }
        }
    ),
    flush=True,
)


async def run():
    h = ServerHarness()
    h._handler_kwargs["on_state_request"] = lambda _msg, sock: (
        h._server.schedule_send_to(sock, '{"type":"agent_message","text":"ack"}\n')
    )
    h.start()
    rtts = []
    try:
        async with AsyncExitStack() as stack:
            controls = []
            bulks = []
            for i in range(5):
                c = await stack.enter_async_context(
                    websockets.connect(f"ws://127.0.0.1:{h.port}/ws")
                )
                hello = await _send_hello_request(c)
                b = await stack.enter_async_context(
                    websockets.connect(f"ws://127.0.0.1:{h.port}{hello['bulk_url']}")
                )
                await b.send(
                    json.dumps(
                        {
                            "type": "bulk_hello_request",
                            "protocol_version": 2,
                            "client_id": hello["client_id"],
                            "token": hello["bulk_token"],
                        }
                    )
                )
                await b.recv()
                controls.append(c)
                bulks.append(b)

            async def drain(b):
                async for _message in b:
                    pass

            drains = [asyncio.create_task(drain(b)) for b in bulks]
            h._server.schedule_broadcast_text(raw + "\n")

            async def actor(c):
                for _ in range(30):
                    start = time.perf_counter()
                    await c.send('{"type":"state_request"}')
                    while True:
                        body = json.loads(await asyncio.wait_for(c.recv(), 2))
                        if body.get("text") == "ack":
                            break
                    rtts.append((time.perf_counter() - start) * 1000)
                    await asyncio.sleep(max(0, 1 / 30 - (time.perf_counter() - start)))

            await asyncio.gather(*(actor(c) for c in controls))
            for task in drains:
                task.cancel()
            await asyncio.gather(*drains, return_exceptions=True)
            ordered = sorted(rtts)
            print(
                json.dumps(
                    {
                        "actual_5_peer_loopback_while_bulk": {
                            "acks": len(rtts),
                            "messages_per_peer_hz": 30,
                            "p50_ms": round(statistics.median(rtts), 3),
                            "p95_ms": round(ordered[int(len(ordered) * 0.95) - 1], 3),
                            "max_ms": round(max(rtts), 3),
                            "control_compression": False,
                            "application_ack_bytes": len(
                                '{"type":"agent_message","text":"ack"}\n'
                            ),
                            "control_request_bytes": len('{"type":"state_request"}'),
                        }
                    }
                ),
                flush=True,
            )
    finally:
        h.stop()


asyncio.run(run())
