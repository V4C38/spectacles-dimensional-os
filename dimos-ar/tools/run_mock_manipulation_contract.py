"""Run the official OpenYAM contract against an isolated in-memory robot."""

from __future__ import annotations

import argparse
import asyncio
from contextlib import closing
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import signal
import socket
import sys
import tempfile
import time
from typing import Any

import websockets

PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with closing(socket.socket()) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def isolated_environment(directory: Path, inherited: dict[str, str]) -> dict[str, str]:
    excluded = {
        "ROBOT_IP", "ROBOT_IPS", "CAN_PORT", "SIMULATION", "DIMOS_AR_SIMULATION",
        "REPLAY", "REPLAY_DB", "DIMOS_AR_REPLAY_STREAMS", "PYTHONPATH",
        "PYTEST_VERSION", "PYTEST_CURRENT_TEST", "DIMOS_AR_TEST_MANIPULATION_URL",
        "OPENAI_API_KEY", "MULTISET_CLIENT_ID", "MULTISET_CLIENT_SECRET",
    }
    result = {key: value for key, value in inherited.items()
              if key not in excluded and "__" not in key}
    result.update(XDG_CONFIG_HOME=str(directory / "config"), LISTEN_HOST="127.0.0.1",
                  PYTHONUNBUFFERED="1", SIMULATION="mock")
    return result


def runtime_command(python: Path, config: Path) -> list[str]:
    cli = python.parent / "dimos"
    if not cli.is_file():
        raise ValueError(f"No DimOS CLI beside {python}; install dimos-ar[manipulation] in that environment")
    return [str(python), str(cli), "--simulation=mock", "--viewer=none", "run",
            "dimos-ar.openyam-ar-planner", "--config", str(config)]


def write_configuration(directory: Path, port: int) -> Path:
    path = directory / "config" / "dimos" / "config"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({
        "g": {"simulation": "mock", "listen_host": "127.0.0.1", "viewer": "none"},
        "armodule": {"port": port, "ip_relay_url": None, "localization": {"providers": []}},
    }), encoding="utf-8")
    return path


async def confirm_mock(url: str) -> None:
    async with websockets.connect(url, open_timeout=2) as connection:
        await connection.send(json.dumps({"type": "hello_request", "protocol_version": 2,
                                          "ts_client": time.time()}))
        hello = json.loads(await connection.recv())
        if hello.get("type") != "hello" or hello.get("protocol_version") != 2:
            raise RuntimeError("Unexpected mock runtime handshake")
        if not hello.get("capabilities", {}).get("manipulation", {}).get("available"):
            raise RuntimeError("Mock runtime does not advertise manipulation")
        async for text in connection:
            for line in text.splitlines():
                frame = json.loads(line)
                if frame.get("type") == "manipulation_state" and frame.get("available"):
                    if frame.get("simulated") is not True:
                        raise RuntimeError("Refusing contract tests against a physical runtime")
                    return
        raise ConnectionError("Mock runtime closed before publishing feedback")


async def wait_ready(process: asyncio.subprocess.Process, url: str, timeout: float) -> None:
    async with asyncio.timeout(timeout):
        while True:
            if process.returncode is not None:
                raise RuntimeError(f"Mock runtime exited before readiness ({process.returncode})")
            try:
                await asyncio.wait_for(confirm_mock(url), timeout=5)
                return
            except (OSError, TimeoutError, websockets.exceptions.ConnectionClosed):
                await asyncio.sleep(0.25)


async def stop_owned(process: asyncio.subprocess.Process, timeout: float) -> None:
    try:
        os.killpg(process.pid, signal.SIGINT)
    except ProcessLookupError:
        await process.wait()
        return
    try:
        await asyncio.wait_for(process.wait(), timeout)
    except TimeoutError:
        pass
    # Workers may outlive the CLI parent; its dedicated group still belongs to this run.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    await asyncio.wait_for(process.wait(), 5)


async def run_contract(args: argparse.Namespace) -> int:
    args.output.mkdir(parents=True, exist_ok=True)
    log_path = args.output / "runtime.log"
    result: dict[str, Any] = {"passed": False, "log": str(log_path), "simulation": "mock"}
    runtime = test = None
    temporary = tempfile.TemporaryDirectory(prefix="dimos-mock-contract-config-")
    try:
        directory = Path(temporary.name)
        port = free_port()
        config = write_configuration(directory, port)
        environment = isolated_environment(directory, dict(os.environ))
        command = runtime_command(args.python, config)
        result.update(command=command, port=port)
        with log_path.open("w", encoding="utf-8") as log:
            # This probe loads only planning APIs and an inert one-joint model.
            preflight = await asyncio.create_subprocess_exec(
                str(args.python), str(PACKAGE_ROOT.parent / "launcher/app/planner_check.py"),
                cwd=directory, env=environment, stdout=log, stderr=asyncio.subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                if await asyncio.wait_for(preflight.wait(), 60):
                    raise RuntimeError("Install compatible dimos-ar[manipulation] planning dependencies; see runtime.log")
            finally:
                await stop_owned(preflight, args.shutdown_timeout)
            runtime = await asyncio.create_subprocess_exec(
                *command, cwd=directory, env=environment, stdout=log,
                stderr=asyncio.subprocess.STDOUT, start_new_session=True,
            )
            url = f"ws://127.0.0.1:{port}"
            await wait_ready(runtime, url, args.startup_timeout)
            result["ready"] = True
            test = await asyncio.create_subprocess_exec(
                str(args.test_python), "-m", "pytest", "-q", "-rs",
                "--junitxml", str(args.output / "junit.xml"),
                str(PACKAGE_ROOT / "tools/test_manipulation_runtime.py"),
                cwd=PACKAGE_ROOT, env={**environment, "DIMOS_AR_TEST_MANIPULATION_URL": url,
                                       "DIMOS_AR_PLANNING_PYTHON": str(args.python)},
                start_new_session=True,
            )
            result["test_exit_code"] = await asyncio.wait_for(test.wait(), args.test_timeout)
            result["passed"] = result["test_exit_code"] == 0
            return int(result["test_exit_code"])
    except (OSError, ValueError, RuntimeError, TimeoutError) as exc:
        result["error"] = str(exc)
        print(f"Mock contract failed: {exc}", file=sys.stderr)
        if log_path.exists():
            print("\n".join(log_path.read_text(errors="replace").splitlines()[-60:]), file=sys.stderr)
        return 1
    finally:
        if test is not None:
            await stop_owned(test, args.shutdown_timeout)
        if runtime is not None:
            await stop_owned(runtime, args.shutdown_timeout)
        temporary.cleanup()
        (args.output / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"Mock contract diagnostics: {args.output}")


def positive_timeout(value: str) -> float:
    number = float(value)
    if not 0 < number < float("inf"):
        raise argparse.ArgumentTypeError("timeout must be finite and positive")
    return number


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, default=Path(sys.executable),
                        help="Python with compatible dimos-ar[manipulation] installed")
    parser.add_argument("--test-python", type=Path, default=Path(sys.executable),
                        help="Python with pytest, pytest-asyncio and websockets installed")
    parser.add_argument("--output", type=Path, help="Keep runtime.log, junit.xml and result.json here (default: Review Data/mock-manipulation/<run-id>)")
    parser.add_argument("--startup-timeout", type=positive_timeout, default=180)
    parser.add_argument("--test-timeout", type=positive_timeout, default=180)
    parser.add_argument("--shutdown-timeout", type=positive_timeout, default=20)
    args = parser.parse_args(argv)
    args.python = args.python.expanduser().absolute()
    args.test_python = args.test_python.expanduser().absolute()
    run_id = f"{datetime.now(UTC):%Y-%m-%dT%H-%M-%S.%fZ}-{os.getpid()}"
    default_output = PACKAGE_ROOT.parent / "Review Data" / "mock-manipulation" / run_id
    args.output = (args.output or default_output).expanduser().absolute()
    return args


async def main(args: argparse.Namespace) -> int:
    task = asyncio.current_task()
    assert task is not None
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
    try:
        return await run_contract(args)
    except asyncio.CancelledError:
        return 130


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(parse_args())))
