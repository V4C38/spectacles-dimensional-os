"""Public Stop cancels the whole dependency operation and its owned child."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from armodule import Phase


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["setup", "check"])
async def test_public_stop_cancels_dependency_work(runtime, monkeypatch, operation):
    manager, children, _ = runtime
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[]))
    work = manager.run_setup(dimos_python="/selected/python") if operation == "setup" else manager.run_check()
    task = asyncio.create_task(work)
    while not children:
        await asyncio.sleep(0)
    child = children[0]
    child.output("CHECK_OK=1")
    await asyncio.wait_for(manager.stop_armodule(), 1)
    with pytest.raises(asyncio.CancelledError):
        await task
    assert child.returncode == 0
    assert manager.runtime.backend.process is None
    assert not manager.dependencies.operation.running
    assert manager.status.phase is Phase.IDLE
    # Completion cannot resume the cancelled check.
    await asyncio.sleep(0)
    assert manager.status.phase is Phase.IDLE


@pytest.mark.asyncio
async def test_stop_cancels_post_install_check(runtime, monkeypatch):
    manager, children, _ = runtime
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[]))
    task = asyncio.create_task(manager.run_setup(dimos_python="/selected/python"))
    while not children:
        await asyncio.sleep(0)
    children[0].finish()
    while len(children) < 2:
        await asyncio.sleep(0)
    assert manager.status.phase is Phase.CHECKING
    await asyncio.wait_for(manager.stop_armodule(), 1)
    with pytest.raises(asyncio.CancelledError):
        await task
    assert children[1].returncode == 0
    assert manager.status.phase is Phase.IDLE


@pytest.mark.asyncio
async def test_spawn_error_is_a_structured_api_failure(monkeypatch):
    from fastapi import HTTPException

    import app

    monkeypatch.setattr(app.robot_profiles, "snapshot", lambda *args: {})
    monkeypatch.setattr(app.manager, "start_armodule", AsyncMock(side_effect=OSError("missing script")))
    body = app.StartBody(profile_id="profile", blueprint="unitree_go2_ar",
                         source={"mode": "manual", "address": "10.0.0.1"})
    with pytest.raises(HTTPException) as error:
        await app.api_armodule_start(body)
    assert error.value.status_code == 500
    assert "missing script" in error.value.detail
