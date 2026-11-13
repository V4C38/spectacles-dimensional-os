from unittest.mock import AsyncMock

import pytest

import discovery


@pytest.mark.asyncio
async def test_discovery_uses_selected_interpreter_and_preserves_identity(monkeypatch):
    proc = AsyncMock(returncode=0)
    proc.communicate.return_value = (b'[{"id":"serial-A","address":"192.168.1.4","transport":"lan"}]\n', b'')
    spawn = AsyncMock(return_value=proc)
    monkeypatch.setattr(discovery.asyncio, "create_subprocess_exec", spawn)
    devices = await discovery.discover_devices("/selected/python", "unitree_go2")
    assert spawn.call_args.args[0] == "/selected/python"
    assert devices[0]["id"] == "serial-A"
    assert spawn.call_args.args[1].endswith("scripts/robot_discovery.py")
    assert spawn.call_args.args[2] == "unitree_go2"


@pytest.mark.asyncio
async def test_discovery_failure_is_not_empty_success(monkeypatch):
    proc = AsyncMock(returncode=1)
    proc.communicate.return_value = (b'', b'Permission denied')
    monkeypatch.setattr(discovery.asyncio, "create_subprocess_exec", AsyncMock(return_value=proc))
    with pytest.raises(ValueError, match="Permission denied"):
        await discovery.discover_devices("/selected/python", "openyam")


@pytest.mark.asyncio
async def test_auto_no_devices_never_starts_and_suggests_explicit_simulation(monkeypatch):
    from fastapi import HTTPException

    import app

    monkeypatch.setattr(app, "api_discovery", AsyncMock(return_value={"devices": []}))
    start = AsyncMock()
    monkeypatch.setattr(app.manager, "start_armodule", start)
    with pytest.raises(HTTPException) as error:
        await app.api_armodule_start(app.StartBody(blueprint="unitree_go2_ar", client="webxr", profile_id="go2", source=app.SourceBody(mode="auto")))
    assert error.value.status_code == 409
    assert error.value.detail["suggest_simulated"]
    start.assert_not_awaited()


@pytest.mark.asyncio
async def test_selected_can_is_injected_without_profile_mutation(monkeypatch):
    import app

    monkeypatch.setattr(app, "api_discovery", AsyncMock(return_value={"devices": [{"id": "can2", "address": "can2"}]}))
    monkeypatch.setattr(app.robot_profiles, "snapshot", lambda *args: {"robot_display_name": "Bench"})
    start = AsyncMock()
    monkeypatch.setattr(app.manager, "start_armodule", start)
    monkeypatch.setattr(app.manager, "snapshot", dict)
    await app.api_armodule_start(app.StartBody(blueprint="openyam_ar_planner", profile_id="bench", client="webxr", source=app.SourceBody(mode="device", device_id="can2")))
    assert start.call_args.kwargs["can_port"] == "can2"
    assert start.call_args.kwargs["armodule_config"] == {"robot_display_name": "Bench"}


@pytest.mark.asyncio
async def test_missing_explicit_device_does_not_switch_to_simulation(monkeypatch):
    from fastapi import HTTPException

    import app

    monkeypatch.setattr(app, "api_discovery", AsyncMock(return_value={"devices": []}))
    start = AsyncMock()
    monkeypatch.setattr(app.manager, "start_armodule", start)
    with pytest.raises(HTTPException) as error:
        await app.api_armodule_start(app.StartBody(blueprint="unitree_go2_ar", client="webxr", profile_id="go2", source=app.SourceBody(mode="device", device_id="missing")))
    assert error.value.detail["suggest_simulated"] is False
    start.assert_not_awaited()


def test_preferences_are_independent_of_profiles_and_replace_atomically(tmp_path, monkeypatch):
    import preferences

    target = tmp_path / "ar-launcher.json"
    monkeypatch.setattr(preferences, "path", lambda: target)
    preferences.save({"go2_source": "simulated", "replay": "/a recording.db"})
    assert preferences.read()["replay"] == "/a recording.db"
    assert list(tmp_path.iterdir()) == [target]
    preferences.save({"go2_source": "auto"})
    assert preferences.read() == {"go2_source": "auto"}


@pytest.mark.asyncio
async def test_manual_ip_pins_connection_without_discovery(monkeypatch):
    import app

    discover = AsyncMock()
    start = AsyncMock()
    monkeypatch.setattr(app.robot_profiles, "snapshot", lambda *args: {})
    monkeypatch.setattr(app, "api_discovery", discover)
    monkeypatch.setattr(app.manager, "start_armodule", start)
    monkeypatch.setattr(app.manager, "snapshot", dict)
    await app.api_armodule_start(app.StartBody(blueprint="unitree_go2_ar", client="webxr", profile_id="go2",
        source=app.SourceBody(mode="manual", address="192.168.1.42")))
    discover.assert_not_awaited()
    assert start.call_args.kwargs["robot_ip"] == "192.168.1.42"


@pytest.mark.asyncio
async def test_arm_recording_requires_file_and_never_falls_back_to_hardware(monkeypatch):
    from fastapi import HTTPException

    import app

    start = AsyncMock()
    monkeypatch.setattr(app.manager, "start_armodule", start)
    with pytest.raises(HTTPException, match="Choose an OpenYAM recording"):
        await app.api_armodule_start(app.StartBody(blueprint="openyam_ar_planner", client="webxr",
            profile_id="arm", source=app.SourceBody(mode="simulated", playback="recording")))
    start.assert_not_awaited()


@pytest.mark.asyncio
async def test_arm_recording_passes_validated_stream_binding_to_process(monkeypatch, tmp_path):
    import app

    path = tmp_path / "recording.db"
    path.touch()
    streams = {"joints": "measured"}
    validate = AsyncMock(return_value={"streams": streams, "needs_selection": False})
    start = AsyncMock()
    monkeypatch.setattr(app, "validate_replay", validate)
    app.manager.dependencies.update_status(dimos_python="/selected/python")
    monkeypatch.setattr(app.manager, "start_armodule", start)
    monkeypatch.setattr(app.manager, "snapshot", dict)
    monkeypatch.setattr(app.robot_profiles, "snapshot", lambda *args: {})
    await app.api_armodule_start(app.StartBody(blueprint="openyam_ar_planner", client="webxr", profile_id="arm",
        source=app.SourceBody(mode="simulated", playback="recording", replay=str(path), streams=streams)))
    validate.assert_awaited_once_with("/selected/python", str(path), "openyam", streams)
    assert start.call_args.kwargs["replay"] == str(path)
    assert start.call_args.kwargs["replay_streams"] == streams
    assert "can_port" not in start.call_args.kwargs


def test_missing_preferences_ignore_old_robot_ip(tmp_path, monkeypatch):
    import preferences

    monkeypatch.setattr(preferences, "path", lambda: tmp_path / "missing.json")
    monkeypatch.setenv("ROBOT_IP", "fake")
    assert preferences.read() == {}


@pytest.mark.asyncio
async def test_probe_timeout_kills_and_reaps_its_own_process(monkeypatch):
    import asyncio
    from unittest.mock import Mock

    proc = AsyncMock(returncode=None)
    proc.kill = Mock()
    # Use an actual blocked communicate so cancellation exercises the shared finally.
    async def blocked():
        await asyncio.Event().wait()
    proc.communicate.side_effect = blocked
    monkeypatch.setattr(discovery.asyncio, "create_subprocess_exec", AsyncMock(return_value=proc))
    with pytest.raises(TimeoutError):
        await discovery.run_json_probe("/selected/python", "probe.py", timeout=0.001)
    proc.kill.assert_called_once_with()
    proc.wait.assert_awaited_once_with()
