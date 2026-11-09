"""Contract-runner checks use fake children and sockets, never robot hardware."""

import importlib.util
import json
from pathlib import Path
import signal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

spec = importlib.util.spec_from_file_location(
    "mock_contract_runner", Path(__file__).with_name("run_mock_manipulation_contract.py")
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def test_environment_cannot_inherit_hardware_or_module_overrides(tmp_path):
    environment = runner.isolated_environment(tmp_path, {
        "PATH": "/bin", "SIMULATION": "physical", "CAN_PORT": "can0", "ROBOT_IP": "10.0.0.1",
        "ARMODULE__PORT": "8787", "G__SIMULATION": "physical",
        "CONTROLCOORDINATOR__HARDWARE": "physical-adapter", "PYTHONPATH": "/foreign/source",
        "OPENAI_API_KEY": "not-for-this-test", "DIMOS_AR_TEST_MANIPULATION_URL": "ws://foreign",
    })
    assert environment == {
        "PATH": "/bin", "SIMULATION": "mock", "LISTEN_HOST": "127.0.0.1",
        "XDG_CONFIG_HOME": str(tmp_path / "config"), "PYTHONUNBUFFERED": "1",
    }


def test_runtime_command_forces_mock_before_blueprint_import(tmp_path):
    python = tmp_path / "python"
    cli = tmp_path / "dimos"
    cli.touch()
    command = runner.runtime_command(python, tmp_path / "config")
    assert command == [str(python), str(cli), "--simulation=mock", "--viewer=none", "run",
                       "dimos-ar.openyam-ar-planner", "--config", str(tmp_path / "config")]
    cli.unlink()
    with pytest.raises(ValueError, match=r"dimos-ar\[manipulation\]"):
        runner.runtime_command(python, tmp_path / "config")


def test_configuration_is_isolated_local_and_disables_relay_and_localization(tmp_path):
    config = json.loads(runner.write_configuration(tmp_path, 12345).read_text())
    assert config["g"] == {"simulation": "mock", "listen_host": "127.0.0.1", "viewer": "none"}
    assert config["armodule"] == {
        "port": 12345, "ip_relay_url": None, "localization": {"providers": []},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("simulated", [True, False, None])
async def test_readiness_refuses_any_runtime_not_explicitly_simulated(monkeypatch, simulated):
    class Connection:
        sent = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def send(self, text):
            self.sent.append(json.loads(text))

        async def recv(self):
            return json.dumps({"type": "hello", "protocol_version": 2,
                               "capabilities": {"manipulation": {"available": True}}})

        def __aiter__(self):
            async def messages():
                yield json.dumps({"type": "manipulation_state", "available": True,
                                  "simulated": simulated})
            return messages()

    connection = Connection()
    monkeypatch.setattr(runner.websockets, "connect", lambda *_args, **_kwargs: connection)
    if simulated is True:
        await runner.confirm_mock("ws://127.0.0.1:12345")
    else:
        with pytest.raises(RuntimeError, match="physical runtime"):
            await runner.confirm_mock("ws://127.0.0.1:12345")
    assert [message["type"] for message in connection.sent] == ["hello_request"]


@pytest.mark.asyncio
async def test_early_runtime_exit_fails_without_connecting(monkeypatch):
    confirm = AsyncMock()
    monkeypatch.setattr(runner, "confirm_mock", confirm)
    with pytest.raises(RuntimeError, match="exited before readiness"):
        await runner.wait_ready(SimpleNamespace(returncode=1), "ws://127.0.0.1:12345", 1)
    confirm.assert_not_awaited()


@pytest.mark.asyncio
async def test_cleanup_signals_only_the_owned_process_group(monkeypatch):
    calls = []
    monkeypatch.setattr(runner.os, "killpg", lambda pid, sig: calls.append((pid, sig)))
    process = SimpleNamespace(pid=12345, returncode=None, wait=AsyncMock(return_value=0))
    await runner.stop_owned(process, 1)
    assert calls == [(12345, signal.SIGINT), (12345, signal.SIGKILL)]
    assert process.wait.await_count == 2



def test_default_diagnostics_are_rooted_in_review_data_from_any_working_directory(tmp_path, monkeypatch):
    repository = tmp_path / "Repository With Spaces"
    package = repository / "dimos-ar"
    elsewhere = tmp_path / "different directory"
    elsewhere.mkdir()
    monkeypatch.setattr(runner, "PACKAGE_ROOT", package)
    monkeypatch.chdir(elsewhere)
    args = runner.parse_args([])
    assert args.output.parent == repository / "Review Data" / "mock-manipulation"
    assert args.output.name.endswith(f"-{runner.os.getpid()}")
    assert not args.output.exists()


def test_explicit_diagnostics_output_with_spaces_is_preserved(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    args = runner.parse_args(["--output", "selected results/one run"])
    assert args.output == tmp_path / "selected results" / "one run"
