"""CAN inspection and setup use fake commands; never reconfigure a live interface."""

import json
from unittest.mock import AsyncMock

import pytest

import can_setup
from armodule import ProcessManager


def link(**changes):
    value = {
        "ifname": "can0",
        "flags": ["UP", "LOWER_UP"],
        "txqlen": 1000,
        "linkinfo": {
            "info_kind": "can",
            "info_data": {"state": "ERROR-ACTIVE", "bittiming": {"bitrate": 1000000}},
        },
    }
    value.update(changes)
    return value


@pytest.mark.parametrize("flags,state", [(["UP"], "ready"), ([], "down")])
def test_operational_error_active_is_not_a_fault(flags, state):
    status = can_setup.inspect_link([link(flags=flags)])
    assert status["state"] == state
    assert status["ready"] == (state == "ready")


def test_missing_wrong_bitrate_queue_and_bus_off():
    assert can_setup.inspect_link([])["state"] == "missing"
    for value in [
        link(txqlen=10),
        link(
            linkinfo={
                "info_kind": "can",
                "info_data": {"bittiming": {"bitrate": 500000}},
            }
        ),
    ]:
        assert can_setup.inspect_link([value])["state"] == "unconfigured"
    value = link()
    value["linkinfo"]["info_data"]["state"] = "BUS-OFF"
    assert can_setup.inspect_link([value])["ready"] is False
    assert (
        can_setup.inspect_link([link(linkinfo={"info_kind": "vcan"})])["state"]
        == "error"
    )


@pytest.mark.asyncio
async def test_check_is_read_only_and_handles_missing_tools(monkeypatch):
    monkeypatch.setattr(can_setup.sys, "platform", "linux")
    monkeypatch.setattr(can_setup.shutil, "which", lambda _: "/sbin/ip")
    proc = AsyncMock(returncode=0)
    proc.communicate.return_value = (json.dumps([link()]).encode(), b"")
    spawn = AsyncMock(return_value=proc)
    monkeypatch.setattr(can_setup.asyncio, "create_subprocess_exec", spawn)
    assert (await can_setup.check_can())["ready"]
    assert spawn.call_args.args == (
        "/sbin/ip",
        "-details",
        "-json",
        "link",
        "show",
        "type",
        "can",
    )
    monkeypatch.setattr(can_setup.shutil, "which", lambda _: None)
    assert (await can_setup.check_can())["state"] == "error"


@pytest.mark.asyncio
async def test_inspection_spawn_failure_is_reported_as_status(monkeypatch):
    monkeypatch.setattr(can_setup.sys, "platform", "linux")
    monkeypatch.setattr(can_setup.shutil, "which", lambda _: "/sbin/ip")
    monkeypatch.setattr(
        can_setup.asyncio,
        "create_subprocess_exec",
        AsyncMock(side_effect=OSError("ip could not be started")),
    )
    status = await can_setup.check_can()
    assert not status["ready"]
    assert "ip could not be started" in status["message"]


def test_setup_uses_native_elevation_and_selected_interpreter(tmp_path, monkeypatch):
    python = tmp_path / "python3"
    python.touch()
    monkeypatch.setattr(can_setup.sys, "platform", "linux")
    monkeypatch.setattr(can_setup.os, "geteuid", lambda: 1000)
    monkeypatch.setattr(can_setup.shutil, "which", lambda _: "/usr/bin/pkexec")
    command = can_setup.setup_command(str(python))
    assert command[:2] == ["/usr/bin/pkexec", str(python)]
    assert command[-4:] == ["hardware", "can", "setup", "can0"]
    assert "uv" not in command


@pytest.mark.asyncio
async def test_non_linux_is_not_required(monkeypatch):
    monkeypatch.setattr(can_setup.sys, "platform", "darwin")
    assert (await can_setup.check_can())["state"] == "not_required"


@pytest.mark.asyncio
async def test_setup_rejects_running_dimos_without_stopping_it(tmp_path, monkeypatch):
    manager = ProcessManager(root=tmp_path)
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[123]))
    stop = AsyncMock()
    monkeypatch.setattr(manager, "stop_armodule", stop)
    with pytest.raises(RuntimeError, match="while DimOS is running"):
        await manager.setup_can()
    stop.assert_not_awaited()


@pytest.mark.asyncio
async def test_already_ready_setup_is_noop_and_does_not_take_process_ownership(
    tmp_path, monkeypatch
):
    manager = ProcessManager(root=tmp_path)
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        manager, "can_status", AsyncMock(return_value={"ready": True, "state": "ready"})
    )
    spawn = AsyncMock()
    monkeypatch.setattr("armodule.asyncio.create_subprocess_exec", spawn)
    assert (await manager.setup_can())["ready"]
    spawn.assert_not_awaited()
    assert manager._proc is None
    assert not manager._can_setup_running


@pytest.mark.asyncio
async def test_setup_logs_failure_and_releases_single_flight_guard(
    tmp_path, monkeypatch
):
    manager = ProcessManager(root=tmp_path)
    manager.status.dimos_python = "/selected/python"
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[]))
    monkeypatch.setattr(manager, "can_status", AsyncMock(return_value={"ready": False}))
    monkeypatch.setattr("armodule.setup_command", lambda _: ["fake-can-setup"])
    proc = AsyncMock(returncode=126)
    proc.communicate.return_value = (b"Authentication cancelled\n", None)
    monkeypatch.setattr(
        "armodule.asyncio.create_subprocess_exec", AsyncMock(return_value=proc)
    )
    with pytest.raises(RuntimeError, match="cancelled or failed"):
        await manager.setup_can()
    assert "Authentication cancelled" in manager._log
    assert manager._proc is None
    assert not manager._can_setup_running


@pytest.mark.asyncio
async def test_real_start_requires_can_before_any_cleanup_and_mock_bypasses_it(
    tmp_path, monkeypatch
):
    manager = ProcessManager(root=tmp_path)
    monkeypatch.setattr(
        manager, "planner_status", AsyncMock(return_value={"ready": True})
    )
    can = AsyncMock(return_value={"ready": False, "message": "can0 is down"})
    monkeypatch.setattr(manager, "can_status", can)
    clear = AsyncMock()
    monkeypatch.setattr(manager, "_clear_before_start", clear)
    with pytest.raises(ValueError, match="can0 is down"):
        await manager.start_armodule(blueprint="openyam_ar_planner", client="webxr")
    clear.assert_not_awaited()
    can.reset_mock()
    monkeypatch.setattr(manager, "_configure_system_if_needed", AsyncMock())
    monkeypatch.setattr(manager, "_spawn", AsyncMock())
    await manager.start_armodule(
        blueprint="openyam_ar_planner", client="specs", simulation=True
    )
    can.assert_not_awaited()
    clear.assert_awaited_once()


@pytest.mark.asyncio
async def test_can_setup_cannot_overlap_itself(tmp_path, monkeypatch):
    manager = ProcessManager(root=tmp_path)
    manager._can_setup_running = True
    spawn = AsyncMock()
    monkeypatch.setattr("armodule.asyncio.create_subprocess_exec", spawn)
    with pytest.raises(RuntimeError, match="already running"):
        await manager.setup_can()
    spawn.assert_not_awaited()


@pytest.mark.asyncio
async def test_setup_verifies_interface_after_official_command(tmp_path, monkeypatch):
    manager = ProcessManager(root=tmp_path)
    manager.status.dimos_python = "/selected/python"
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[]))
    monkeypatch.setattr(manager, "can_status", AsyncMock(return_value={"ready": False}))
    verified = AsyncMock(return_value={"ready": True, "state": "ready"})
    monkeypatch.setattr("armodule.check_can", verified)
    monkeypatch.setattr("armodule.setup_command", lambda _: ["official-can-command"])
    proc = AsyncMock(returncode=0)
    proc.communicate.return_value = (b"Configured can0\n", None)
    monkeypatch.setattr(
        "armodule.asyncio.create_subprocess_exec", AsyncMock(return_value=proc)
    )
    assert (await manager.setup_can())["ready"]
    verified.assert_awaited_once()
    assert manager._proc is None


@pytest.mark.asyncio
async def test_can_api_exposes_status_and_running_conflict(monkeypatch):
    from fastapi import HTTPException

    import app

    monkeypatch.setattr(
        app.manager, "can_status", AsyncMock(return_value={"ready": True})
    )
    assert (await app.api_can_status())["ready"]
    monkeypatch.setattr(
        app.manager,
        "setup_can",
        AsyncMock(side_effect=RuntimeError("DimOS is running")),
    )
    with pytest.raises(HTTPException) as exc:
        await app.api_can_setup()
    assert exc.value.status_code == 409
