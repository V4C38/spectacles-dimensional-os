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
    monkeypatch.setattr(manager.dependencies, "_run_tracked", AsyncMock(return_value=0))
    check = AsyncMock()
    monkeypatch.setattr(manager.dependencies, "_check_dependencies", check)
    interpreter = str(tmp_path / "chosen" / ".venv" / "bin" / "python3")
    await manager.run_setup(dimos_python=interpreter)
    assert read_env(env_path(tmp_path))["DIMOS_PYTHON"] == interpreter
    check.assert_awaited_once()


@pytest.mark.parametrize("existing", [False, True])
def test_source_setup_installs_dimos_and_ar_in_one_transaction(tmp_path, existing):
    import os
    import shutil
    import subprocess
    import sys
    from pathlib import Path

    scripts = tmp_path / "launcher" / "scripts"
    scripts.mkdir(parents=True)
    (tmp_path / "dimos-ar").mkdir()
    source = tmp_path / "chosen DimOS"
    (source / ".git").mkdir(parents=True)
    (source / "pyproject.toml").write_text('[project]\nname="dimos"\n')
    interpreter = source / ".venv" / "bin" / "python3"
    interpreter.parent.mkdir(parents=True)
    interpreter.write_text('#!/bin/bash\nif [[ "${2:-}" == "--source" ]]; then printf "%s\n" "${DIMOS_TEST_SOURCE}"; fi\n')
    interpreter.chmod(0o755)
    original = Path(__file__).resolve().parents[2] / "scripts"
    command = scripts / "setup.sh"
    shutil.copyfile(original / "setup.sh", command)
    # No clone, environment mutation or package install is allowed in this shell test.
    (scripts / "dimos_lib.sh").write_text(
        'print_color() { :; }\n'
        'python_has_dimos() { return 0; }\n'
        'python_has_dimos_ar() { return 0; }\n'
        'python_pip_install() { printf "%s\\0" "$@" >> "${INSTALL_LOG}"; }\n'
    )
    tools = tmp_path / "bin"
    tools.mkdir()
    git = tools / "git"
    git.write_text("#!/bin/sh\nexit 0\n")
    git.chmod(0o755)
    bootstrap = tools / "python3.12"
    bootstrap.symlink_to(sys.executable)
    log = tmp_path / "install.args"
    arguments = ["--dimos-python", str(interpreter)] if existing else ["--clone-dir", str(source)]
    subprocess.run(["/bin/bash", str(command), "--yes", "--manipulation", *arguments],
                   env={**os.environ, "PATH": str(tools) + os.pathsep + os.defpath,
                        "DIMOS_TEST_SOURCE": str(source), "INSTALL_LOG": str(log)},
                   capture_output=True, text=True, check=True, timeout=10)
    assert log.read_bytes().decode().split("\0") == [str(interpreter), "-e", ".[dev,manipulation]", "-e", str(source) + "[planning]", ""]


@pytest.mark.asyncio
@pytest.mark.parametrize("platform,directory", [("darwin", True), ("linux", False)])
async def test_native_chooser_preserves_selection_and_cancellation(tmp_path, monkeypatch, platform, directory):
    from unittest.mock import AsyncMock

    monkeypatch.setattr(launcher_app.sys, "platform", platform)
    monkeypatch.setattr(launcher_app, "_has_display", lambda: True)
    monkeypatch.setattr(launcher_app.shutil, "which", lambda _: "/bin/zenity")
    proc = AsyncMock(returncode=0)
    proc.communicate.return_value = (b"/chosen path\n", b"")
    spawn = AsyncMock(return_value=proc)
    monkeypatch.setattr(launcher_app.asyncio, "create_subprocess_exec", spawn)
    assert await launcher_app._choose_path("Choose", directory=tmp_path if directory else None,
                                          file_filter=None if directory else "Replay | *.db") == "/chosen path"
    args = spawn.call_args.args
    assert "choose folder" in args[-1] if platform == "darwin" else "--file-filter=Replay | *.db" in args
    proc.returncode = 1
    assert await launcher_app._choose_path("Choose") is None
