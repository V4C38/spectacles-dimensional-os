"""Opt-in v2 contract exercise against an explicitly simulated official runtime."""

from __future__ import annotations

import asyncio
import json
import os
import time

import pytest

from tools.mock_runtime_client import mock_runtime

_URL = os.environ.get("DIMOS_AR_TEST_MANIPULATION_URL")
pytestmark = pytest.mark.skipif(
    not _URL, reason="requires an explicitly started mock manipulation runtime"
)


@pytest.mark.asyncio
async def test_official_mock_manipulation_contract():
    async with mock_runtime(str(_URL)) as (client, state):
        pose = state["observations"][client.group]["pose"]
        target = {**pose, "position": [pose["position"][0] + 0.01, *pose["position"][1:]]}
        await client.acquire("manipulation_planning", target)
        evaluation = await client.command("evaluate", **target)
        assert evaluation["status"] == "feasible", evaluation
        plan = await client.command("plan", **target, speed_scale=0.2)
        assert plan["status"] == "planned", plan
        trajectory = await client.asset("trajectory", plan["plan_ref"])
        assert trajectory["points"] and trajectory["joint_names"]
        await client.release()
        rejected = await client.command("execute", plan_id="another-plan")
        assert rejected["status"] == "rejected"
        accepted = await client.command("execute", plan_id=plan["plan_id"])
        assert accepted["status"] == "accepted", accepted
        await client.receive(lambda frame: frame["type"] == "manipulation_state"
                             and frame.get("execution") == "completed"
                             and frame.get("operation_id") == accepted["operation_id"]
                             and frame.get("plan_ref") is None)
        await client.acquire("manipulation_following", target)
        acquired = await client.command("acquire")
        assert acquired["status"] == "acquired", acquired
        sequence = await client.update_target(target, speed_scale=0.2)
        await client.receive(lambda frame: frame["type"] == "manipulation_result"
                             and frame.get("action") == "update"
                             and frame.get("status") == "feasible"
                             and frame.get("sequence", -1) >= sequence)
        await client.release()
        await client.socket.send(json.dumps({"type": "estop_request"}))
        await client.receive(lambda frame: frame["type"] == "manipulation_state"
                             and frame.get("stopped") and frame.get("stop_confirmed"))
        assert (await client.resume_operation())["status"] == "resumed"


@pytest.mark.asyncio
async def test_held_ik_recovers_from_unreachable_target_without_releasing():
    async with mock_runtime(str(_URL)) as (client, state):
        pose = state["observations"][client.group]["pose"]
        await client.acquire("manipulation_following", pose, speed_scale=0.5)
        acquired = await client.command("acquire")
        assert acquired["status"] == "acquired", acquired
        corrected_at = 0
        for index in range(90):
            target = pose if index < 15 or index >= 60 else {
                **pose, "position": [100.0, 0.0, 100.0],
            }
            if index == 60:
                corrected_at = time.monotonic()
            await client.update_target(target, speed_scale=0.5)
            await asyncio.sleep(1 / 30)
        await client.wait(lambda: any(
            stamp >= corrected_at and frame.get("type") == "manipulation_result"
            and frame.get("action") == "update" and frame.get("status") == "feasible"
            for stamp, frame in client.frames
        ))
        replies = [frame for _, frame in client.frames
                   if frame.get("type") == "manipulation_result" and frame.get("action") == "update"]
        assert any(frame.get("status") == "infeasible" for frame in replies), replies
        assert client.state.get("following") is True, client.state
        await client.release()
        assert client.state.get("stopped") is False


@pytest.mark.asyncio
async def test_mock_reset_repeated_zero_and_orderly_parking():
    async with mock_runtime(str(_URL)) as (client, _state):
        for _ in range(2):
            result = await client.command("reset_joints", speed_scale=0.2)
            assert result["status"] == "completed", result
        pose = client.state["observations"][client.group]["pose"]
        await client.acquire("manipulation_planning", pose)
        await client.release()
        result = await client.command("prepare_shutdown", speed_scale=0.2)
        assert result["status"] == "completed", result
        assert result["quiescent"] is True


def test_official_workers_follow_authoritative_scene_changes():
    from pathlib import Path
    import subprocess
    import sys

    python = os.environ.get("DIMOS_AR_PLANNING_PYTHON", sys.executable)
    subprocess.run([python, str(Path(__file__).with_name("check_manipulation_scene.py"))],
                   check=True, timeout=120)
