"""Protocol-v2 client for local, explicitly simulated manipulation diagnostics.

No test-framework dependency: contract tests and executable probes share this owner
for handshakes, bulk records, interaction leases, and current target credentials.
"""

from __future__ import annotations

import asyncio
from collections import deque
from contextlib import asynccontextmanager
import json
import time
from urllib.parse import urljoin, urlparse

import websockets


def require_local_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in {"ws", "wss"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Mock diagnostics require an explicit localhost WebSocket URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Mock diagnostics do not accept URL credentials")


class MockRuntimeClient:
    def __init__(self, socket):
        self.socket = socket
        self.shared = None
        self.lease = None
        self.group = None
        self.sequence = 0
        self.assets = {}
        self.parts = {}
        self.pending = asyncio.Queue()
        self.frames = deque(maxlen=10000)
        self.state = None
        self.simulated = False

    async def read_control(self):
        async for message in self.socket:
            for line in message.splitlines():
                frame = json.loads(line)
                self.frames.append((time.monotonic(), frame))
                if frame["type"] == "interaction_state":
                    self.shared = frame
                elif frame["type"] == "manipulation_state":
                    self.state = frame
                self.pending.put_nowait(frame)

    async def receive(self, predicate, timeout=60):
        async with asyncio.timeout(timeout):
            while True:
                frame = await self.pending.get()
                if predicate(frame):
                    return frame

    async def wait(self, predicate, timeout=30):
        async with asyncio.timeout(timeout):
            while not predicate():
                await asyncio.sleep(0.01)

    def require_simulated(self):
        if not self.simulated:
            raise RuntimeError("Motion diagnostics require explicitly simulated hardware")

    async def request(self, message_type, action, **payload):
        self.sequence += 1
        request_id = f"official-mock-{self.sequence}"
        await self.socket.send(json.dumps({
            "type": message_type, "request_id": request_id, "action": action, **payload,
        }))
        return await self.receive(lambda frame: frame.get("request_id") == request_id)

    async def command(self, action, **payload):
        self.require_simulated()
        if action in {"execute", "reset_joints", "prepare_shutdown"} and self.shared["motion_busy"]:
            await self.wait(lambda: not self.shared["motion_busy"])
        credentials = {"epoch": self.shared["epoch"]}
        if self.lease is not None:
            credentials["lease_id"] = self.lease
        target = next((target for target in self.shared.get("targets", [])
                       if target["domain"] == "manipulation" and target["group_id"] == self.group), None)
        if target is not None:
            credentials["target_revision"] = target["revision"]
        return await self.request("manipulation_request", action,
                                  group_id=self.group, **credentials, **payload)

    async def acquire(self, kind, pose, speed_scale=0.2):
        self.require_simulated()
        await self.wait(lambda: not self.shared["motion_busy"])
        result = await self.request("interaction_request", "acquire", epoch=self.shared["epoch"],
                                    kind=kind, source_id="official-mock", group_id=self.group,
                                    **pose, speed_scale=speed_scale)
        assert result["status"] == "accepted", result
        self.lease = result["lease_id"]
        await self.receive(lambda frame: frame["type"] == "interaction_state"
                           and (frame.get("authority") or {}).get("lease_id") == self.lease)

    async def update_target(self, pose, speed_scale=0.5):
        self.require_simulated()
        self.sequence += 1
        sequence = self.sequence
        body = {"type": "interaction_request", "request_id": f"target-{sequence}",
                "action": "update", "epoch": self.shared["epoch"], "lease_id": self.lease,
                "sequence": sequence, **pose, "speed_scale": speed_scale}
        await self.socket.send(json.dumps(body))
        return sequence

    async def release(self):
        self.require_simulated()
        target = next(target for target in self.shared["targets"]
                      if target["domain"] == "manipulation" and target["group_id"] == self.group)
        result = await self.request("interaction_request", "release", epoch=self.shared["epoch"],
                                    lease_id=self.lease, sequence=self.sequence + 1,
                                    position=target["position"], orientation=target["orientation"])
        assert result["status"] == "accepted", result
        self.lease = None
        await self.receive(lambda frame: frame["type"] == "interaction_state"
                           and frame.get("authority") is None)

    async def renew(self):
        while True:
            await asyncio.sleep(0.1)
            if self.lease is not None:
                self.sequence += 1
                await self.socket.send(json.dumps({
                    "type": "interaction_request", "request_id": f"renew-{self.sequence}",
                    "action": "renew", "epoch": self.shared["epoch"], "lease_id": self.lease,
                }))

    async def read_bulk(self):
        async for message in self.bulk:
            if not isinstance(message, str):
                continue
            for line in message.splitlines():
                frame = json.loads(line)
                if frame["type"] != "bulk_record":
                    continue
                key = frame["kind"], frame["id"], frame["revision"]
                parts = self.parts.setdefault(key, {})
                parts[frame["part"]] = frame["data"]
                if len(parts) == frame["parts"]:
                    asset = {}
                    for part in range(frame["parts"]):
                        data = parts[part]
                        asset.update(data.get("metadata", {}))
                        for field, values in data.items():
                            if field != "metadata":
                                asset.setdefault(field, []).extend(values)
                    self.assets[key] = asset
                    self.parts.pop(key)

    async def asset(self, kind, ref):
        key = kind, ref["id"], ref["revision"]
        await self.bulk.send(json.dumps({"type": "bulk_get", "kind": kind, **ref}))
        async with asyncio.timeout(30):
            while key not in self.assets:
                await asyncio.sleep(0.01)
        return self.assets[key]


@asynccontextmanager
async def mock_runtime(url):
    require_local_url(url)
    async with websockets.connect(url) as socket:
        client = MockRuntimeClient(socket)
        await socket.send(json.dumps({"type": "hello_request", "protocol_version": 2,
                                     "ts_client": time.time()}))
        hello = json.loads(await socket.recv())
        if hello.get("protocol_version") != 2 or not hello.get("capabilities", {}).get("manipulation", {}).get("available"):
            raise RuntimeError("Runtime does not support protocol-v2 manipulation")
        bulk_url = urljoin(url, hello["bulk_url"])
        require_local_url(bulk_url)
        async with websockets.connect(bulk_url) as bulk:
            client.bulk = bulk
            await bulk.send(json.dumps({"type": "bulk_hello_request", "protocol_version": 2,
                                        "client_id": hello["client_id"], "token": hello["bulk_token"]}))
            assert json.loads(await bulk.recv())["type"] == "bulk_hello"
            tasks = [asyncio.create_task(client.read_control()),
                     asyncio.create_task(client.read_bulk()), asyncio.create_task(client.renew())]
            try:
                await client.receive(lambda frame: frame["type"] == "interaction_state")
                state = await client.receive(lambda frame: frame["type"] == "manipulation_state"
                                             and frame.get("available")
                                             and frame.get("ts", 0) >= hello["time_sync"]["ts_server"]
                                             and (not frame.get("stopped") or frame.get("stop_confirmed")))
                if state.get("simulated") is not True:
                    raise RuntimeError("Refusing motion diagnostics against physical hardware")
                client.simulated = True
                model = await client.asset("model", state["model_ref"])
                assert model["visual_profile"] == "openyam"
                assert set(model["gripper_joints"]) >= {"joint7", "joint8"}
                client.group = state["groups"][0]["id"]
                if state.get("stopped"):
                    assert (await client.command("resume"))["status"] == "resumed"
                yield client, state
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
