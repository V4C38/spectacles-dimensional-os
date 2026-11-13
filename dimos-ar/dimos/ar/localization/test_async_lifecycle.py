from __future__ import annotations

import asyncio
import math
import threading
from types import SimpleNamespace

import numpy as np
import pytest

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.runner import LocalizationOutcome, LocalizationRunner
from dimos.ar.localization.vps.robot_observation_buffer import (
    RobotObservationBuffer,
)
from dimos.ar.robot.odometry import PoseBuffer
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from test_support.localization import _advance, _camera_info, _image, _observation


def _pose(ts: float, *, x: float = 0, yaw: float = 0) -> PoseStamped:
    return PoseStamped(
        ts=ts,
        frame_id="world",
        position=[x, 0, 0.33],
        orientation=[0, 0, math.sin(yaw / 2), math.cos(yaw / 2)],
    )


def test_pose_history_preserves_baseline_bracket_interpolation() -> None:
    history = PoseBuffer()
    history.push(_pose(10), ts_server=10)
    history.push(_pose(15, x=5), ts_server=15)
    assert history.at_server_ts(10.01).position[0] == pytest.approx(0.01)


@pytest.mark.parametrize("timestamp", [float("nan"), float("inf"), 9.0])
def test_pose_history_rejects_invalid_or_out_of_order_time(timestamp: float) -> None:
    history = PoseBuffer()
    history.push(_pose(10), ts_server=10)
    with pytest.raises(ValueError):
        history.push(_pose(timestamp), ts_server=timestamp)
    assert history.latest().ts_server == 10


def test_pose_snapshot_is_independent_and_interpolates_capture_travel() -> None:
    history = PoseBuffer()
    history.push(_pose(10), ts_server=10)
    history.push(_pose(10.1, x=0.2), ts_server=10.1)
    frozen = history.snapshot()
    history.clear()
    assert history.latest() is None
    assert frozen.at_server_ts(10.05).travel_m == pytest.approx(0.1)


@pytest.mark.parametrize("rotating", [False, True])
def test_robot_capture_pairs_moving_pose_without_extrapolation(rotating: bool) -> None:
    history = PoseBuffer()
    buffer = RobotObservationBuffer(pose_buffer=history, T_base_camera_optical=np.eye(4))
    buffer.set_camera_info(_camera_info())
    history.push(_pose(9.95, x=0, yaw=0), ts_server=9.95)
    assert buffer.prepare_image(_image(10), ts_server=10, travel_m=0) is None
    history.push(_pose(10.05, x=0.2, yaw=0.2 if rotating else 0), ts_server=10.05)
    sample = buffer.prepare_image(_image(10), ts_server=10, travel_m=0.1)
    assert sample is not None
    assert sample.observation.camera_pose.x == pytest.approx(0.1)
    assert sample.observation.camera_pose.orientation.z == pytest.approx(
        math.sin(0.05) if rotating else 0
    )
    buffer.add_sample(sample)
    assert buffer.newest(now_server=11) is sample
    assert buffer.newest(now_server=12.01) is None
    buffer.clear()
    assert buffer.newest(now_server=11) is None


def test_robot_capture_rejects_pose_brackets_over_200ms() -> None:
    history = PoseBuffer()
    buffer = RobotObservationBuffer(pose_buffer=history, T_base_camera_optical=np.eye(4))
    buffer.set_camera_info(_camera_info())
    history.push(_pose(9.9), ts_server=9.9)
    history.push(_pose(10.11, x=1), ts_server=10.11)
    assert buffer.prepare_image(_image(10), ts_server=10, travel_m=0) is None


async def test_cancelled_cpu_work_keeps_actual_worker_admission_bounded() -> None:
    worker = BoundedWorker()
    started = threading.Event()
    release = threading.Event()
    calls = []

    def blocking():
        calls.append("first")
        started.set()
        release.wait(3)
        return "discarded"

    task = asyncio.create_task(worker.run(blocking))
    try:
        assert await asyncio.to_thread(started.wait, 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        next_task = asyncio.create_task(worker.run(lambda: calls.append("second")))
        await asyncio.sleep(0.02)
        assert calls == ["first"]
        release.set()
        await asyncio.wait_for(next_task, 1)
        assert calls == ["first", "second"]
    finally:
        release.set()
        worker.close()


@pytest.mark.parametrize("failure", ["timeout", "exception", "disconnect", "replacement"])
async def test_runner_bounds_episode_and_discards_retired_results(failure: str) -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("client")
    work = policy.on_observations("client", [_observation()])
    release = asyncio.Event()
    started = asyncio.Event()
    outcomes = []

    async def run(_observations, **_kwargs):
        started.set()
        await release.wait()
        if failure == "exception":
            raise ValueError("provider failed")
        return LocalizationOutcome()

    async def close():
        pass

    runner = LocalizationRunner(
        coordinator=SimpleNamespace(run=run, close=close),
        policy=policy,
        on_outcome=lambda *args: outcomes.append(args),
        on_prompt=lambda _client: None,
        timeout_s=0.05,
    )
    try:
        runner.submit(work)
        await started.wait()
        runner.submit(work)
        assert len(runner._tasks) == 1
        assert policy.on_observations("client", [_observation()]) is None
        if failure == "disconnect":
            runner.cancel("client")
            policy.on_disconnect("client")
        elif failure == "replacement":
            runner.cancel("client")
            policy.on_start_request("client")
        elif failure == "timeout":
            await asyncio.sleep(0.07)
        release.set()
        await asyncio.gather(*tuple(runner._jobs), return_exceptions=True)
        assert len(outcomes) == (1 if failure in ("timeout", "exception") else 0)
    finally:
        await runner.close()


def test_success_uses_capture_travel_not_http_completion_travel() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("client")
    _advance(policy, 0, 0)
    _advance(policy, 0.8, 0)
    policy.on_success("client", capture_travel_m=0)
    assert _advance(policy, 0.8, 0) == ["client"]


def test_exact_pose_remains_usable_beside_a_history_gap() -> None:
    history = PoseBuffer()
    history.push(_pose(10))
    history.push(_pose(15, x=5))
    assert history.at_server_ts(10).position[0] == 0
    assert history.at_server_ts(10.01).position[0] == pytest.approx(0.01)


@pytest.mark.asyncio
async def test_camera_stream_drops_replaceable_work_while_native_worker_is_busy():
    import threading

    entered, release = threading.Event(), threading.Event()
    worker = BoundedWorker()
    called = []

    def native():
        entered.set()
        assert release.wait(2)
        called.append("original")

    active = asyncio.create_task(worker.run_if_idle(native))
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        for _ in range(100):
            assert await worker.run_if_idle(lambda: called.append("stale-camera")) is None
        release.set()
        await active
        assert called == ["original"]
    finally:
        release.set()
        worker.close()


async def test_map_workflow_closes_shared_resources_after_jobs():
    from unittest.mock import AsyncMock

    order = []
    coordinator = SimpleNamespace(close=AsyncMock(side_effect=lambda: order.append("worker")))
    vps = SimpleNamespace(close=AsyncMock(side_effect=lambda: order.append("vps")))
    mapping = SimpleNamespace(close=AsyncMock(side_effect=lambda: order.append("map")))
    runner = LocalizationRunner(
        coordinator=coordinator, policy=LocalizationPolicy(["vps"]),
        map_localization=mapping, vps=vps,
        on_outcome=lambda *_args: None, on_prompt=lambda _client: None,
    )
    await runner.close()
    assert order == ["map", "vps", "worker"]
    coordinator.close.assert_awaited_once()
    vps.close.assert_awaited_once()


async def test_closing_worker_rejects_queued_replacement_after_cancelled_native_error():
    worker = BoundedWorker()
    entered, release = threading.Event(), threading.Event()
    calls = []

    def native():
        entered.set()
        assert release.wait(2)
        raise ValueError("late native failure")

    running = asyncio.create_task(worker.run(native))
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        running.cancel()
        with pytest.raises(asyncio.CancelledError):
            await running
        queued = asyncio.create_task(worker.run(lambda: calls.append("replacement")))
        await asyncio.sleep(0)
        worker.close()
        release.set()
        with pytest.raises(RuntimeError, match="closed"):
            await asyncio.wait_for(queued, 1)
        assert calls == []
    finally:
        release.set()
        worker.close()
