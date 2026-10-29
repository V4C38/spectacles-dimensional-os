"""Shutdown sequencing uses fake processes and sockets; no robot is contacted."""

import asyncio
import importlib.util
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

spec = importlib.util.spec_from_file_location(
    "arm_supervisor", Path(__file__).parents[2] / "launcher/scripts/supervise-arm.py"
)
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


@pytest.mark.asyncio
async def test_supervisor_parks_before_signalling_dimos(monkeypatch):
    order = []
    done = asyncio.Event()

    class Child:
        pid = 123456
        returncode = None

        async def wait(self):
            await done.wait()
            self.returncode = 0
            return 0

    child = Child()
    monkeypatch.setattr(supervisor.asyncio, "create_subprocess_exec", AsyncMock(return_value=child))
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(loop, "add_signal_handler", lambda sig, callback: callback())

    async def park():
        order.append("zero-confirmed")

    monkeypatch.setattr(supervisor, "prepare_shutdown", park)

    def signal_child(pid, sig):
        order.append("signal-child")
        done.set()

    monkeypatch.setattr(supervisor.os, "killpg", signal_child)
    assert await supervisor.main(["fake-dimos"]) == 0
    assert order == ["zero-confirmed", "signal-child"]


@pytest.mark.asyncio
@pytest.mark.parametrize("stopped", [False, True])
async def test_shutdown_request_and_estop_skip(monkeypatch, stopped):
    sent = []

    class Socket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def send(self, data):
            sent.append(json.loads(data))

        def __aiter__(self):
            async def frames():
                yield json.dumps(
                    {"type": "manipulation_state", "stopped": stopped, "groups": [{"id": "arm"}]}
                )
                yield json.dumps({"request_id": "shutdown-zero", "status": "completed"})

            return frames()

    monkeypatch.setattr(supervisor, "connect", lambda *args, **kwargs: Socket())
    await supervisor.prepare_shutdown()
    actions = [m.get("action") for m in sent if m.get("action")]
    assert actions == ([] if stopped else ["prepare_shutdown"])
