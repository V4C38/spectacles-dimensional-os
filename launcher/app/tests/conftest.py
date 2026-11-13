"""Pytest path setup for launcher app modules."""

from __future__ import annotations

import atexit
import os
import sys
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

ROOT = Path(__file__).resolve().parents[1]
# App globals are constructed during test collection, before autouse fixtures.
_collection_config = tempfile.TemporaryDirectory(prefix="dimos-launcher-tests-")
_prior_config_home = os.environ.get("XDG_CONFIG_HOME")
os.environ["XDG_CONFIG_HOME"] = _collection_config.name


def _cleanup_collection_config() -> None:
    if _prior_config_home is None:
        os.environ.pop("XDG_CONFIG_HOME", None)
    else:
        os.environ["XDG_CONFIG_HOME"] = _prior_config_home
    _collection_config.cleanup()


atexit.register(_cleanup_collection_config)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from armodule import ProcessManager
from tests.processes import Child


@pytest.fixture(autouse=True)
def isolate_dimos_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg-config"))
    import app
    import config
    from robot_profiles import RobotProfiles

    # Isolate globals already imported by collection, and the repository .env too.
    monkeypatch.setattr(config, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(app, "manager", ProcessManager(root=tmp_path))
    monkeypatch.setattr(app, "robot_profiles", RobotProfiles())


@pytest.fixture(autouse=True)
def skip_real_dimos_cleanup(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    if request.node.get_closest_marker("real_clear"):
        return

    async def _noop(self: object) -> None:
        return None

    monkeypatch.setattr("armodule.ProcessManager._clear_before_start", _noop)






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
    monkeypatch.setattr(mgr.runtime, "_stop_one", stop)
    try:
        yield mgr, children, spawn
    finally:
        await mgr.stop_armodule()
