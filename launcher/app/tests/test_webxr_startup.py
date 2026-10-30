"""Exercise startup ordering with in-memory child processes; never contact a robot."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import aclosing
from pathlib import Path
from typing import cast
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from armodule import Phase, ProcessManager

READY = "ARModule started websocket=ws://0.0.0.0:8787"
BANNER = "WebSocket: ws://0.0.0.0:8787 (not listening yet — booting DimOS stack…)"


class Child:
    def __init__(self) -> None:
        self.stdout = asyncio.StreamReader()
        self.returncode: int | None = None
        self.exited = asyncio.Event()

    def output(self, line: str) -> None:
        self.stdout.feed_data((line + "\n").encode())

    def finish(self, code: int = 0) -> None:
        if self.returncode is None:
            self.returncode = code
            self.stdout.feed_eof()
            self.exited.set()

    async def wait(self) -> int:
        await self.exited.wait()
        assert self.returncode is not None
        return self.returncode


@pytest_asyncio.fixture
async def runtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[tuple[ProcessManager, list[Child], AsyncMock]]:
    mgr = ProcessManager(root=tmp_path)
    children: list[Child] = []

    async def create(*args: object, **kwargs: object) -> Child:
        child = Child()
        children.append(child)
        return child

    async def stop(proc: Child | None, label: str) -> bool:
        if proc is None:
            return False
        was_running = proc.returncode is None
        proc.finish()
        return was_running

    spawn = AsyncMock(side_effect=create)
    monkeypatch.setattr("armodule.asyncio.create_subprocess_exec", spawn)
    monkeypatch.setattr("armodule.detect_lan_ip", lambda: "10.0.0.8")
    monkeypatch.setattr(mgr, "_configure_system_if_needed", AsyncMock())
    monkeypatch.setattr(mgr, "_ensure_webxr_deps", AsyncMock())
    monkeypatch.setattr(mgr, "_build_webxr", AsyncMock())
    monkeypatch.setattr(mgr, "planner_status", AsyncMock(return_value={"ready": True}))
    monkeypatch.setattr(mgr, "can_status", AsyncMock(return_value={"ready": True}))
    monkeypatch.setattr(mgr, "_kill_port_listeners", AsyncMock(return_value=False))
    monkeypatch.setattr(mgr, "_stop_one", stop)
    try:
        yield mgr, children, spawn
    finally:
        await mgr.stop_armodule()


async def parsed(mgr: ProcessManager, child: Child, line: str) -> None:
    """Wait until the real stream reader has parsed this line."""
    handled = asyncio.Event()
    original = mgr._parse_armodule_line

    def parse(value: str) -> None:
        original(value)
        if value == line:
            handled.set()

    mgr._parse_armodule_line = parse  # type: ignore[method-assign]
    try:
        child.output(line)
        await asyncio.wait_for(handled.wait(), timeout=1)
    finally:
        mgr._parse_armodule_line = original  # type: ignore[method-assign]


async def error_status(mgr: ProcessManager) -> None:
    async with aclosing(mgr.subscribe()) as events:
        async for event in events:
            if event.get("type") == "status" and event.get("phase") == "error":
                return


@pytest.mark.asyncio
@pytest.mark.parametrize("line", [READY, "ARModule ready — ws://0.0.0.0:8787"])
async def test_webxr_waits_for_readiness_and_starts_once(runtime, line: str) -> None:
    mgr, children, spawn = runtime
    await asyncio.wait_for(
        mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr"), timeout=1
    )
    task = mgr._webxr_start_task
    assert task is not None
    assert spawn.await_count == 1
    assert mgr.status.webxr_url is None
    assert mgr.status.webxr_local_url is None

    await parsed(mgr, children[0], BANNER)
    await parsed(mgr, children[0], "Unrelated module websocket=ws://0.0.0.0:7779")
    assert not task.done()
    assert mgr.status.phase == Phase.STARTING
    assert spawn.await_count == 1

    await parsed(mgr, children[0], line)
    await asyncio.wait_for(task, timeout=1)
    assert spawn.await_count == 2
    assert spawn.await_args.args[:3] == ("npm", "run", "preview")
    assert mgr.status.webxr_local_url == "https://localhost:5173"
    assert mgr.status.webxr_url == "https://10.0.0.8:5173"
    await parsed(mgr, children[0], line)
    assert spawn.await_count == 2


@pytest.mark.asyncio
async def test_stop_before_readiness_cancels_webxr(runtime) -> None:
    mgr, _children, spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    task = mgr._webxr_start_task
    ready = mgr._armodule_ready
    await asyncio.wait_for(mgr.stop_armodule(), timeout=1)
    ready.set()
    assert task.cancelled()
    assert mgr._webxr_start_task is None
    assert mgr._proc is None
    assert spawn.await_count == 1
    assert mgr.status.webxr_url is None


@pytest.mark.asyncio
async def test_webxr_output_publishes_network_url_when_probe_is_unknown(
    runtime,
) -> None:
    mgr, children, _spawn = runtime
    await mgr.start_armodule(blueprint="openyam_ar_planner", client="webxr")
    mgr.status.host_ip = "unknown"
    await parsed(mgr, children[0], "Manipulation runtime ready")
    await parsed(mgr, children[0], READY)
    await asyncio.wait_for(mgr._webxr_start_task, timeout=1)
    children[1].output("  ➜  Network: https://192.168.1.181:5173/")

    async def address_published() -> None:
        async with aclosing(mgr.subscribe()) as events:
            async for event in events:
                if event.get("webxr_url") == "https://192.168.1.181:5173/":
                    return

    await asyncio.wait_for(address_published(), timeout=1)


@pytest.mark.asyncio
@pytest.mark.parametrize("ready_first", [False, True])
async def test_exit_during_startup_never_launches_webxr(
    runtime, ready_first: bool
) -> None:
    mgr, children, spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    async with mgr._lock:
        if ready_first:
            await parsed(mgr, children[0], READY)
        children[0].finish(1)
    await asyncio.wait_for(error_status(mgr), timeout=1)
    assert spawn.await_count == 1
    assert mgr.status.phase == Phase.ERROR
    assert mgr._webxr_start_task is None
    assert mgr.status.webxr_url is None


@pytest.mark.asyncio
async def test_restart_ignores_old_readiness_and_exit(runtime) -> None:
    mgr, children, spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    old_proc = mgr._proc
    old_ready = mgr._armodule_ready
    old_task = mgr._webxr_start_task
    # Stop while readiness has arrived but the WebXR task cannot acquire the lock.
    async with mgr._lock:
        await parsed(mgr, children[0], READY)
        await mgr._stop_children_unlocked()
    assert old_task.cancelled()

    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    new_task = mgr._webxr_start_task
    old_ready.set()
    # A retired reader must neither release the new gate nor change its status.
    stale = Child()
    stale.output(READY)
    stale.finish(1)
    await mgr._read_stream(
        cast(asyncio.subprocess.Process, stale),
        parse_armodule=True,
        ready=mgr._armodule_ready,
    )
    await mgr._finalize_exit("old process failed", expected_proc=old_proc)
    assert mgr.status.phase == Phase.STARTING
    assert not mgr._armodule_ready.is_set()
    assert spawn.await_count == 2
    await parsed(mgr, children[1], READY)
    await asyncio.wait_for(new_task, timeout=1)
    assert spawn.await_count == 3


@pytest.mark.asyncio
async def test_webxr_spawn_failure_stops_armodule(runtime) -> None:
    mgr, children, spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    task = mgr._webxr_start_task
    spawn.side_effect = OSError("npm could not start")
    await parsed(mgr, children[0], READY)
    await asyncio.wait_for(task, timeout=1)
    assert children[0].returncode == 0
    assert mgr._proc is None
    assert mgr._webxr_start_task is None
    assert mgr.status.phase == Phase.ERROR
    assert mgr.status.error == "Failed to start WebXR: npm could not start"
    assert mgr.status.webxr_url is None


@pytest.mark.asyncio
async def test_webxr_exit_stops_current_armodule(runtime) -> None:
    mgr, children, _spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    task = mgr._webxr_start_task
    await parsed(mgr, children[0], READY)
    await asyncio.wait_for(task, timeout=1)
    children[1].finish(1)
    await asyncio.wait_for(error_status(mgr), timeout=1)
    assert children[0].returncode == 0
    assert mgr.status.phase == Phase.ERROR
    assert mgr.status.webxr_url is None
    assert mgr._proc is None


@pytest.mark.asyncio
async def test_specs_start_does_not_wait_for_readiness(runtime) -> None:
    mgr, children, spawn = runtime
    await asyncio.wait_for(
        mgr.start_armodule(blueprint="unitree_go2_ar", client="specs"), timeout=1
    )
    assert mgr._webxr_start_task is None
    await parsed(mgr, children[0], READY)
    assert mgr.status.phase == Phase.RUNNING
    assert spawn.await_count == 1
    assert mgr.status.webxr_url is None


@pytest.mark.asyncio
async def test_production_build_failure_never_publishes_webxr(
    runtime, monkeypatch
) -> None:
    mgr, children, spawn = runtime
    monkeypatch.setattr(
        mgr, "_build_webxr", AsyncMock(side_effect=RuntimeError("build failed"))
    )
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    task = mgr._webxr_start_task
    await parsed(mgr, children[0], READY)
    await asyncio.wait_for(task, timeout=1)
    assert spawn.await_count == 1
    assert mgr.status.phase == Phase.ERROR
    assert mgr.status.webxr_url is None
    assert mgr.status.error == "Failed to build WebXR: build failed"


@pytest.mark.asyncio
async def test_openyam_waits_for_manipulation_not_just_websocket(runtime):
    mgr, children, spawn = runtime
    await mgr.start_armodule(blueprint="openyam_ar_planner", client="webxr")
    await parsed(mgr, children[0], READY)
    assert mgr.status.phase == Phase.STARTING
    assert not mgr._armodule_ready.is_set()
    assert spawn.await_count == 1
    await parsed(mgr, children[0], "Manipulation runtime ready")
    await asyncio.wait_for(mgr._webxr_start_task, timeout=1)
    assert spawn.await_count == 2
    assert mgr.status.phase == Phase.RUNNING


@pytest.mark.asyncio
async def test_stop_during_build_is_not_blocked_by_process_lock(runtime, monkeypatch):
    mgr, children, spawn = runtime
    entered, hold = asyncio.Event(), asyncio.Event()

    async def build(_env):
        entered.set()
        await hold.wait()

    monkeypatch.setattr(mgr, "_build_webxr", build)
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    await parsed(mgr, children[0], READY)
    task = mgr._webxr_start_task
    await asyncio.wait_for(entered.wait(), timeout=1)
    await asyncio.wait_for(mgr.stop_armodule(), timeout=1)
    assert task.cancelled()
    assert spawn.await_count == 1
    assert mgr.status.webxr_url is None


@pytest.mark.asyncio
async def test_failure_during_build_cancels_it_and_preserves_primary_error(
    runtime, monkeypatch
):
    mgr, children, spawn = runtime
    entered, hold = asyncio.Event(), asyncio.Event()

    async def build(_env):
        entered.set()
        await hold.wait()

    monkeypatch.setattr(mgr, "_build_webxr", build)
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    await parsed(mgr, children[0], READY)
    task = mgr._webxr_start_task
    await asyncio.wait_for(entered.wait(), timeout=1)
    await parsed(
        mgr,
        children[0],
        "Exception in RPC handler for ManipulationModule/start: Scene constructor incompatible",
    )
    children[0].finish(1)
    await asyncio.wait_for(error_status(mgr), timeout=1)
    assert task.cancelled()
    assert spawn.await_count == 1
    assert mgr.status.error == "Scene constructor incompatible"
    assert mgr.status.webxr_url is None
