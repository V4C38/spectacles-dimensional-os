"""Selecting a visible checkout folder must retain its virtual environment."""

from unittest.mock import AsyncMock

import pytest

import app as launcher_app


def test_checkout_with_spaces_preserves_venv_symlink(tmp_path, monkeypatch):
    checkout = tmp_path / "my DimOS install"
    bin_dir = checkout / ".venv" / "bin"
    bin_dir.mkdir(parents=True)
    shared_python = tmp_path / "shared-python"
    shared_python.write_text("#!/bin/sh\nexit 0\n")
    shared_python.chmod(0o755)
    interpreter = bin_dir / "python3"
    interpreter.symlink_to(shared_python)
    calls = []
    monkeypatch.setattr(launcher_app.subprocess, "run", lambda args, **kwargs: calls.append(args))

    assert launcher_app._resolve_dimos_python(str(checkout)) == str(interpreter)
    assert calls[0][0] == str(interpreter)
    assert launcher_app._resolve_dimos_python(str(checkout / ".venv")) == str(interpreter)


def test_checkout_without_environment_explains_folder_requirement(tmp_path):
    with pytest.raises(ValueError, match="DimOS install folder"):
        launcher_app._resolve_dimos_python(str(tmp_path))


@pytest.mark.asyncio
async def test_setup_resolves_folder_before_installing(monkeypatch):
    interpreter = "/selected/dimos/.venv/bin/python3"
    monkeypatch.setattr(launcher_app, "_resolve_dimos_python", lambda path: interpreter)
    setup = AsyncMock()
    monkeypatch.setattr(launcher_app.manager, "run_setup", setup)
    await launcher_app.api_setup(
        launcher_app.SetupBody(mode="existing", dimos_python="/selected/dimos", manipulation=True)
    )
    setup.assert_awaited_once_with(dimos_python=interpreter, manipulation=True)


@pytest.mark.asyncio
async def test_successful_setup_remembers_selected_environment(tmp_path, monkeypatch):
    from armodule import ProcessManager
    from config import env_path, read_env

    manager = ProcessManager(root=tmp_path)
    monkeypatch.setattr(manager, "_running_dimos_pids", AsyncMock(return_value=[]))
    monkeypatch.setattr(manager, "_run_tracked", AsyncMock(return_value=0))
    check = AsyncMock()
    monkeypatch.setattr(manager, "run_check", check)
    interpreter = str(tmp_path / "chosen" / ".venv" / "bin" / "python3")
    await manager.run_setup(dimos_python=interpreter)
    assert read_env(env_path(tmp_path))["DIMOS_PYTHON"] == interpreter
    check.assert_awaited_once()
