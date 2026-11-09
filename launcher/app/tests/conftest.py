"""Pytest path setup for launcher app modules."""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from armodule import ProcessManager
from tests.processes import Child


@pytest.fixture(autouse=True)
def isolate_dimos_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg-config"))


@pytest.fixture(autouse=True)
def skip_real_dimos_cleanup(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    if request.node.get_closest_marker("real_clear"):
        return

    async def _noop(self: object, *, client: str) -> None:
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
    monkeypatch.setattr(mgr, "_stop_one", stop)
    try:
        yield mgr, children, spawn
    finally:
        await mgr.stop_armodule()
