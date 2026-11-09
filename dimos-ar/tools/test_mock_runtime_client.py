"""Pure diagnostics-client checks; sockets and robot state are in-memory fakes."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from tools import mock_runtime_client as helper


@pytest.mark.parametrize("url", ["ws://127.0.0.1:8799", "wss://localhost/ar", "ws://[::1]:8799"])
def test_explicit_local_urls(url):
    helper.require_local_url(url)


@pytest.mark.parametrize("url", ["ws://robot:8799", "ws://192.168.1.3", "https://localhost",
                                 "ws://localhost.example.com", "ws://user:pass@localhost"])
def test_nonlocal_or_credential_urls_refused(url):
    with pytest.raises(ValueError):
        helper.require_local_url(url)


@pytest.mark.asyncio
async def test_motion_refused_without_explicit_simulation():
    socket = SimpleNamespace(send=AsyncMock())
    client = helper.MockRuntimeClient(socket)
    for method, arguments in [(client.command, ("resume",)),
                              (client.acquire, ("manipulation_following", {})),
                              (client.update_target, ({},)), (client.release, ())]:
        with pytest.raises(RuntimeError, match="explicitly simulated"):
            await method(*arguments)
    socket.send.assert_not_called()


@pytest.mark.asyncio
async def test_commands_bind_current_epoch_lease_and_target_revision():
    socket = SimpleNamespace(send=AsyncMock())
    client = helper.MockRuntimeClient(socket)
    client.simulated = True
    client.group = "arm"
    client.lease = "lease-2"
    client.shared = {"epoch": "epoch-2", "targets": [
        {"domain": "manipulation", "group_id": "arm", "revision": 37},
    ]}
    client.pending.put_nowait({"type": "manipulation_result", "request_id": "official-mock-1",
                               "status": "acquired"})
    await client.command("acquire")
    sent = json.loads(socket.send.call_args.args[0])
    assert {key: sent[key] for key in ("epoch", "lease_id", "target_revision", "group_id")} == {
        "epoch": "epoch-2", "lease_id": "lease-2", "target_revision": 37, "group_id": "arm",
    }


@pytest.mark.asyncio
async def test_stream_target_updates_use_shared_authority_and_increasing_sequence():
    socket = SimpleNamespace(send=AsyncMock())
    client = helper.MockRuntimeClient(socket)
    client.simulated = client.follow_stream = True
    client.shared = {"epoch": "epoch"}
    client.lease = "lease"
    pose = {"position": [0, 0, 1], "orientation": [0, 0, 0, 1]}
    first = await client.update_target(pose, speed_scale=0.25)
    second = await client.update_target(pose, speed_scale=0.5)
    sent = [json.loads(call.args[0]) for call in socket.send.call_args_list]
    assert second > first
    assert sent[0] == {"type": "interaction_request", "request_id": f"target-{first}",
                       "action": "update", "epoch": "epoch", "lease_id": "lease",
                       "sequence": first, **pose, "speed_scale": 0.25}


@pytest.mark.asyncio
async def test_control_reader_preserves_batched_frames_and_updates_feedback_without_requests():
    frames = [{"type": "interaction_state", "epoch": "epoch"},
              {"type": "manipulation_state", "following": True}]

    class Socket:
        async def __aiter__(self):
            yield "\n".join(json.dumps(frame) for frame in frames)

    client = helper.MockRuntimeClient(Socket())
    await client.read_control()
    assert client.shared == frames[0]
    assert client.state == frames[1]
    assert (await client.receive(lambda frame: frame["type"] == "manipulation_state")) == frames[1]
    assert len(client.frames) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("simulated", [False, None])
async def test_context_rejects_physical_runtime_before_any_motion(monkeypatch, simulated):
    hello = {"type": "hello", "protocol_version": 2, "capabilities": {
        "manipulation": {"available": True}}, "bulk_url": "/bulk", "client_id": "client",
        "bulk_token": "token", "time_sync": {"ts_server": 1}}
    control_frames = [{"type": "interaction_state", "epoch": "epoch"},
                      {"type": "manipulation_state", "available": True, "ts": 2,
                       "simulated": simulated}]

    class Socket:
        def __init__(self, first, frames):
            self.first, self.frames = first, frames
            self.send = AsyncMock()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def recv(self):
            return json.dumps(self.first)

        async def __aiter__(self):
            for frame in self.frames:
                yield json.dumps(frame)
            await asyncio.Event().wait()

    control = Socket(hello, control_frames)
    bulk = Socket({"type": "bulk_hello"}, [])
    monkeypatch.setattr(helper.websockets, "connect", lambda url: bulk if url.endswith("/bulk") else control)
    with pytest.raises(RuntimeError, match="physical hardware"):
        async with helper.mock_runtime("ws://localhost:8799"):
            pytest.fail("Physical runtime admitted")
    assert [json.loads(call.args[0])["type"] for call in control.send.call_args_list] == ["hello_request"]


@pytest.mark.asyncio
async def test_acquire_waits_for_authoritative_completion_after_native_result():
    client = helper.MockRuntimeClient(SimpleNamespace(send=AsyncMock()))
    client.simulated = True
    client.shared = {"epoch": "epoch", "motion_busy": True}
    client.request = AsyncMock(return_value={"status": "accepted", "lease_id": "lease"})
    client.receive = AsyncMock()
    acquire = asyncio.create_task(client.acquire("manipulation_planning", {}))
    await asyncio.sleep(0)
    client.request.assert_not_called()
    client.shared = {"epoch": "epoch", "motion_busy": False}
    await acquire
    client.request.assert_called_once()
