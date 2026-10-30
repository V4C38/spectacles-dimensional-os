"""Opt-in contract exercise against an explicitly simulated official runtime."""

from __future__ import annotations

import asyncio
import json
import os
import time

import pytest
import websockets

_URL = os.environ.get("DIMOS_AR_TEST_MANIPULATION_URL")
pytestmark = pytest.mark.skipif(
    not _URL, reason="requires an explicitly started mock manipulation runtime"
)


@pytest.mark.asyncio
async def test_official_mock_manipulation_contract() -> None:
    async with websockets.connect(str(_URL)) as socket:
        await socket.send(json.dumps({"type": "hello_request", "ts_client": time.time()}))
        hello = json.loads(await socket.recv())
        assert hello["capabilities"]["manipulation"]["available"]

        async def receive(predicate):
            async with asyncio.timeout(20):
                while True:
                    for line in (await socket.recv()).splitlines():
                        frame = json.loads(line)
                        if predicate(frame):
                            return frame

        state = await receive(
            lambda f: f.get("type") == "manipulation_state" and f.get("available")
        )
        # Refuse to send motion to a non-simulated runtime, even if a URL was set.
        assert state.get("simulated") is True, "this test only dispatches to mock hardware"
        assert state["model"]["visual_profile"] == "openyam"
        assert set(state["model"]["gripper_joints"]) >= {"joint7", "joint8"}
        group = state["groups"][0]["id"]
        pose = state["observations"][group]["pose"]
        target = {**pose, "position": [pose["position"][0] + 0.01, *pose["position"][1:]]}
        sequence = 0

        async def command(action, **payload):
            nonlocal sequence
            sequence += 1
            request_id = f"runtime-test-{sequence}"
            await socket.send(
                json.dumps(
                    {
                        "type": "manipulation_request",
                        "request_id": request_id,
                        "action": action,
                        "group_id": group,
                        **payload,
                    }
                )
            )
            return await receive(
                lambda f: (
                    f.get("type") == "manipulation_result" and f.get("request_id") == request_id
                )
            )

        evaluation = await command("evaluate", **target)
        assert evaluation["status"] == "feasible", evaluation
        plan = await command("plan", **target)
        assert plan["status"] == "planned", plan
        assert plan["trajectory"] and plan["joint_names"]
        rejected = await command("execute", plan_id="another-plan")
        assert rejected["status"] == "rejected"
        accepted = await command("execute", plan_id=plan["plan_id"])
        assert accepted["status"] == "accepted", accepted
        await receive(
            lambda f: f.get("type") == "manipulation_state" and f.get("execution") == "completed"
        )
        acquired = await command("acquire")
        assert acquired["status"] == "acquired", acquired
        valid = await command(
            "update", token=acquired["token"], sequence=1, ts=time.time(), **target
        )
        assert valid["status"] == "feasible", valid
        assert valid.get("joints"), valid
        stale = await command(
            "update", token=acquired["token"], sequence=2, ts=time.time() - 1, **target
        )
        assert stale["status"] == "rejected"
        released = await command("release", token=acquired["token"])
        assert released["status"] == "released", released
        await socket.send(json.dumps({"type": "estop_request"}))
        await receive(
            lambda f: (
                f.get("type") == "manipulation_state"
                and f.get("stopped")
                and f.get("stop_confirmed")
            )
        )
        resumed = await command("resume")
        assert resumed["status"] == "resumed", resumed


@pytest.mark.asyncio
async def test_mock_reset_repeated_zero_and_orderly_parking() -> None:
    """Exercise actual RPC workers and fresh feedback, never physical hardware."""
    async with websockets.connect(str(_URL)) as socket:
        await socket.send(json.dumps({"type": "hello_request", "ts_client": time.time()}))
        await socket.recv()

        async def receive(predicate):
            async with asyncio.timeout(25):
                while True:
                    for line in (await socket.recv()).splitlines():
                        frame = json.loads(line)
                        if predicate(frame):
                            return frame

        state = await receive(
            lambda f: f.get("type") == "manipulation_state" and f.get("available")
        )
        assert state.get("simulated") is True
        assert state["model"]["visual_profile"] == "openyam"
        assert set(state["model"]["gripper_joints"]) >= {"joint7", "joint8"}
        group = state["groups"][0]["id"]
        sequence = 0

        async def command(action):
            nonlocal sequence
            sequence += 1
            request_id = f"parking-contract-{sequence}"
            await socket.send(
                json.dumps(
                    {
                        "type": "manipulation_request",
                        "request_id": request_id,
                        "action": action,
                        "group_id": group,
                        "speed_scale": 0.2,
                    }
                )
            )
            return await receive(lambda f: f.get("request_id") == request_id)

        if state.get("stopped"):
            assert (await command("resume"))["status"] == "resumed"
        result = await command("reset_joints")
        assert result["status"] == "completed", result
        start = time.monotonic()
        result = await command("reset_joints")
        assert result["status"] == "completed", result
        assert time.monotonic() - start < 2
        start = time.monotonic()
        result = await command("prepare_shutdown")
        assert result["status"] == "completed", result
        assert result["quiescent"] is True
        assert time.monotonic() - start < 2
