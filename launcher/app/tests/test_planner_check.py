"""Dependency probes do not start hardware or depend on the launcher's Python environment."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import planner_check
import planner_install
from armodule import ProcessManager


def test_version_mismatch_returns_actionable_error_before_model_import(monkeypatch):
    monkeypatch.setattr(
        planner_check, "version", lambda name: "0.0.14" if name == "dimos" else "0.7.0"
    )
    monkeypatch.setattr(
        planner_check,
        "requires",
        lambda _: ["roboplan>=0.6.0,<0.7.0; extra == 'planning'"],
    )
    result = planner_check.check_planner()
    assert not result["ready"]
    assert "requires roboplan<0.7.0,>=0.6.0" in result["message"]
    assert "installed RoboPlan is 0.7.0" in result["message"]


def test_editable_checkout_and_conflicting_family_are_preserved_and_detected(
    tmp_path, monkeypatch
):
    checkout = tmp_path / "DimOS checkout"
    checkout.mkdir()
    (checkout / "pyproject.toml").write_text('[project]\nname="dimos"\n')
    dist = SimpleNamespace(
        read_text=lambda _: json.dumps(
            {"url": checkout.as_uri(), "dir_info": {"editable": True}}
        )
    )
    monkeypatch.setattr(planner_install.metadata, "distribution", lambda _: dist)
    assert planner_install.source_checkout() == checkout
    monkeypatch.setattr(planner_install.metadata, "version", lambda _: "0.7.0")
    monkeypatch.setattr(
        planner_install.metadata,
        "requires",
        lambda _: ["roboplan>=0.6,<0.7; extra == 'planning'"],
    )
    monkeypatch.setattr(
        planner_install.metadata,
        "distributions",
        lambda: [
            SimpleNamespace(metadata={"Name": name})
            for name in ["roboplan", "roboplan-core", "roboplan-common", "dimos"]
        ],
    )
    assert planner_install.conflicting_roboplan_packages() == [
        "roboplan",
        "roboplan-common",
        "roboplan-core",
    ]
    monkeypatch.setattr(planner_install.metadata, "version", lambda _: "0.6.0")
    assert planner_install.conflicting_roboplan_packages() == []


@pytest.mark.asyncio
async def test_planner_probe_uses_selected_python_caches_and_never_owns_runtime(
    tmp_path, monkeypatch
):
    manager = ProcessManager(root=tmp_path)
    manager.status.dimos_python = "/selected/venv/bin/python3"
    proc = AsyncMock(returncode=0)
    proc.communicate.return_value = (
        b'{"ready":true,"state":"ready","message":"Planner ready"}\n',
        b"",
    )
    spawn = AsyncMock(return_value=proc)
    monkeypatch.setattr("armodule.asyncio.create_subprocess_exec", spawn)
    assert (await manager.planner_status())["ready"]
    assert (await manager.planner_status())["ready"]
    spawn.assert_awaited_once()
    assert spawn.call_args.args[0] == "/selected/venv/bin/python3"
    assert manager._proc is None
    manager.status.dimos_python = "/other/python3"
    await manager.planner_status()
    assert spawn.await_count == 2


@pytest.mark.asyncio
async def test_planner_start_failure_has_no_process_side_effects(tmp_path, monkeypatch):
    manager = ProcessManager(root=tmp_path)
    monkeypatch.setattr(
        manager,
        "planner_status",
        AsyncMock(
            return_value={"ready": False, "message": "RoboPlan does not match DimOS"}
        ),
    )
    cleanup = AsyncMock()
    monkeypatch.setattr(manager, "_clear_before_start", cleanup)
    with pytest.raises(ValueError, match="does not match"):
        await manager.start_armodule(blueprint="openyam_ar_planner", client="webxr")
    cleanup.assert_not_awaited()
    assert manager._proc is None


@pytest.mark.asyncio
async def test_dependency_install_does_not_stop_external_runtime(tmp_path, monkeypatch):
    manager = ProcessManager(root=tmp_path)
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[123]))
    installer = AsyncMock()
    monkeypatch.setattr(manager, "_run_tracked", installer)
    with pytest.raises(RuntimeError, match="Stop DimOS yourself"):
        await manager.run_setup(dimos_python="/selected/python", manipulation=True)
    installer.assert_not_awaited()
