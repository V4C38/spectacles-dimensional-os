"""A launcher run owns its AR snapshot without rewriting native configuration."""

import json

import pytest

from dimos_config import dimos_config_path, write_runtime_config


def test_runtime_snapshot_replaces_ar_settings_and_preserves_native_config(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    source = dimos_config_path()
    source.parent.mkdir(parents=True)
    original = {"g": {"robot_ip": "10.0.0.1"}, "other": {"speed": 2},
                "armodule": {"stationary_base": {"position": [9, 9, 9]}}}
    source.write_text(json.dumps(original))
    profile = {"localization": {"providers": []}, "robot_display_name": "Desk"}
    target = write_runtime_config(profile)
    try:
        profile["localization"]["providers"].append({"type": "vps"})
        actual = json.loads(target.read_text())
        assert actual == {**original, "armodule": {"localization": {"providers": []}, "robot_display_name": "Desk"}}
        assert json.loads(source.read_text()) == original
        assert target.stat().st_mode & 0o777 == 0o600
    finally:
        target.unlink()


@pytest.mark.asyncio
async def test_run_config_is_passed_to_child_and_removed_on_stop(runtime):
    manager, _, spawn = runtime
    await manager.start_armodule(blueprint="unitree_go2_ar", client="specs",
                                 armodule_config={"robot_display_name": "Desk"})
    target = manager._run_config_path
    assert target is not None
    argv = list(spawn.call_args.args)
    assert argv[argv.index("--config") + 1] == str(target)
    await manager.stop_backend()
    assert not target.exists()


@pytest.mark.asyncio
async def test_spawn_failure_cleans_owned_config(runtime, monkeypatch):
    from unittest.mock import AsyncMock

    manager, _, _ = runtime
    target = None
    async def fail(*args, **kwargs):
        nonlocal target
        target = manager._run_config_path
        raise OSError("spawn failed")
    monkeypatch.setattr(manager, "_spawn", AsyncMock(side_effect=fail))
    with pytest.raises(OSError, match="spawn failed"):
        await manager.start_armodule(blueprint="unitree_go2_ar", client="specs")
    assert target is not None and not target.exists()
    assert manager._run_config_path is None
