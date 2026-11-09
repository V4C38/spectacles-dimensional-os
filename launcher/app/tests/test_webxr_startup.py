"""Exercise startup ordering with in-memory child processes; never contact a robot."""

from __future__ import annotations

import asyncio
from contextlib import aclosing
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest

from armodule import Phase, ProcessManager
from tests.processes import Child, error_status, parsed

READY = "ARModule started websocket=ws://0.0.0.0:8787"
BANNER = "WebSocket: ws://0.0.0.0:8787 (not listening yet — booting DimOS stack…)"










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
async def test_webxr_spawn_failure_preserves_armodule(runtime) -> None:
    mgr, children, spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    task = mgr._webxr_start_task
    spawn.side_effect = OSError("npm could not start")
    await parsed(mgr, children[0], READY)
    await asyncio.wait_for(task, timeout=1)
    assert children[0].returncode is None
    assert mgr._proc is not None
    assert mgr._webxr_start_task is None
    assert mgr.status.phase == Phase.RUNNING
    assert mgr.status.webxr_phase == "error"
    assert mgr.status.webxr_error == "npm could not start"
    assert mgr.status.webxr_url is None


@pytest.mark.asyncio
async def test_webxr_exit_preserves_current_armodule(runtime) -> None:
    mgr, children, _spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    task = mgr._webxr_start_task
    await parsed(mgr, children[0], READY)
    await asyncio.wait_for(task, timeout=1)
    children[1].finish(1)
    await asyncio.wait_for(mgr._webxr_reader_task, timeout=1)
    assert children[0].returncode is None
    assert mgr.status.phase == Phase.RUNNING
    assert mgr.status.webxr_phase == "error"
    assert mgr.status.webxr_url is None
    assert mgr._proc is not None


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
    assert mgr.status.phase == Phase.RUNNING
    assert mgr.status.webxr_phase == "error"
    assert mgr.status.webxr_url is None
    assert mgr.status.webxr_error == "build failed"


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
async def test_backend_failure_during_build_retains_gateway_and_primary_error(
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
    assert not task.done()
    hold.set()
    await asyncio.wait_for(task, timeout=1)
    assert spawn.await_count == 2
    assert mgr.status.error == "Scene constructor incompatible"
    assert mgr.status.webxr_url is not None


@pytest.mark.asyncio
async def test_gateway_only_and_backend_have_independent_lifetimes(runtime):
    mgr, children, spawn = runtime
    await mgr.start_webxr()
    gateway = children[0]
    assert mgr._proc is None
    assert mgr.status.webxr_phase == "running"
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")
    await parsed(mgr, children[1], READY)
    await parsed(mgr, children[1], "PIN: 012345")
    assert mgr.snapshot()["pin"] == "012345"
    assert gateway.returncode is None
    await mgr.stop_backend()
    assert gateway.returncode is None
    assert mgr.status.webxr_url is not None
    assert mgr.status.pin is None
    await mgr.stop_webxr()
    assert gateway.returncode == 0
    assert mgr.status.webxr_phase == "stopped"
    assert spawn.await_count == 2


@pytest.mark.asyncio
async def test_stop_gateway_during_build_leaves_specs_connected(runtime, monkeypatch):
    mgr, children, spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")
    await parsed(mgr, children[0], READY)
    entered = asyncio.Event()

    async def build(_env):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(mgr, "_build_webxr", build)
    task = asyncio.create_task(mgr.start_webxr())
    await asyncio.wait_for(entered.wait(), timeout=1)
    await asyncio.wait_for(mgr.stop_webxr(), timeout=1)
    assert task.cancelled()
    assert children[0].returncode is None
    assert mgr.status.phase == Phase.RUNNING
    assert mgr.status.webxr_phase == "stopped"
    assert spawn.await_count == 1


@pytest.mark.asyncio
async def test_webxr_stop_restart_preserves_backend_and_shared_pin(runtime):
    mgr, children, spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")
    await parsed(mgr, children[0], READY)
    await parsed(mgr, children[0], "PIN: 012345")
    await mgr.start_webxr()
    await mgr.stop_webxr()
    assert mgr.status.pin == "012345"
    assert children[0].returncode is None
    await mgr.start_webxr()
    assert mgr.status.webxr_phase == "running"
    assert spawn.await_count == 3
    assert mgr.snapshot()["pin"] == "012345"


@pytest.mark.asyncio
async def test_service_api_delegates_without_stopping_other_service(monkeypatch):
    import app as launcher_app

    manager = launcher_app.manager
    start, stop, backend = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(manager, "start_webxr", start)
    monkeypatch.setattr(manager, "stop_webxr", stop)
    monkeypatch.setattr(manager, "stop_backend", backend)
    await launcher_app.api_webxr_start()
    start.assert_awaited_once_with()
    stop.assert_not_awaited()
    backend.assert_not_awaited()
    await launcher_app.api_webxr_stop()
    stop.assert_awaited_once_with()
    backend.assert_not_awaited()
    await launcher_app.api_backend_stop()
    backend.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_gateway_dependency_install_is_cancelled_without_orphan(runtime, monkeypatch):
    mgr, children, spawn = runtime
    # Restore the real installer while retaining the deterministic child-process harness.
    monkeypatch.setattr(mgr, "_ensure_webxr_deps", ProcessManager._ensure_webxr_deps.__get__(mgr))
    mgr._webxr_dir().mkdir(parents=True)
    monkeypatch.setattr("armodule.shutil.which", lambda _name: "/fake/npm")
    task = asyncio.create_task(mgr.start_webxr())
    while not children:
        await asyncio.sleep(0)
    await asyncio.wait_for(mgr.stop_webxr(), timeout=1)
    assert task.cancelled()
    assert children[0].returncode == 0
    assert mgr._webxr_proc is None
    assert mgr.status.webxr_phase == "stopped"
    assert spawn.await_count == 1


@pytest.mark.asyncio
async def test_running_backend_failure_retains_gateway_and_reports_error(runtime):
    mgr, children, _spawn = runtime
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="webxr")
    starting = mgr._webxr_start_task
    assert starting is not None
    await parsed(mgr, children[0], READY)
    await starting
    gateway = children[1]
    children[0].finish(1)
    await asyncio.wait_for(error_status(mgr), 1)
    assert gateway.returncode is None
    assert mgr._webxr_proc is gateway
    assert mgr._proc is None
    assert mgr.status.phase is Phase.ERROR


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_start_checks_owned_ports_before_spawning(runtime, monkeypatch):
    mgr, _children, spawn = runtime
    clear = AsyncMock()
    effects = Mock()
    effects.attach_mock(clear, "clear")
    effects.attach_mock(spawn, "spawn")
    monkeypatch.setattr(mgr, "_clear_before_start", clear)
    await mgr.start_armodule(blueprint="unitree_go2_ar", client="specs")
    clear.assert_awaited_once_with(client="specs")
    assert spawn.await_count == 1
    assert [call[0] for call in effects.mock_calls][:2] == ["clear", "spawn"]


@pytest.mark.real_clear
@pytest.mark.asyncio
async def test_start_does_not_inspect_or_signal_unrelated_dimos(runtime, monkeypatch):
    mgr, _children, _spawn = runtime
    inspect = AsyncMock(return_value=[111])
    kill = Mock()
    monkeypatch.setattr(mgr, "_running_dimos_pids", inspect)
    monkeypatch.setattr(mgr, "_pids_listening", AsyncMock(return_value=[]))
    monkeypatch.setattr(mgr, "port_in_use", lambda _port: False)
    monkeypatch.setattr("armodule.os.kill", kill)
    await mgr._clear_before_start(client="webxr")
    inspect.assert_not_awaited()
    kill.assert_not_called()


@pytest.mark.asyncio
async def test_cancelled_setup_reaps_its_child_without_stopping_gateway(runtime):
    mgr, children, _ = runtime
    await mgr.start_webxr()
    gateway = mgr._webxr_proc
    task = asyncio.create_task(mgr._run_tracked(["setup"], env={}))
    while len(children) < 2:
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert children[1].returncode == 0
    assert mgr._proc is None
    assert mgr._webxr_proc is gateway and gateway.returncode is None
