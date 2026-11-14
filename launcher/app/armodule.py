"""Child-process manager for setup.sh / start.sh with SSE log fan-out."""

from __future__ import annotations

import asyncio
import codecs
import ipaddress
import json
import math
import os
import re
import shlex
import shutil
import signal
import socket
import sys
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path
from typing import Any, Protocol, TypedDict, Unpack
from urllib.parse import urlsplit

from can_setup import check_can, setup_command
from config import (
    env_path,
    merge_env,
    normalize_log_level,
    read_env,
    repo_root,
    scripts_dir,
)
from dimos_config import write_runtime_config
from discovery import run_json_probe
from launcher_events import LauncherEvents
from owned_operation import OwnedOperation
from robot_sources import BLUEPRINT_CLI, blueprint_definition
from tag_config import ui_from_armodule_config

ARMODULE_PORT = 8787
WEBXR_PORT = 5173
RERUN_WS_PORT = 3030
RERUN_GRPC_PORT = 9877
STACK_PORTS = (ARMODULE_PORT, RERUN_WS_PORT, RERUN_GRPC_PORT)
STOP_GRACE_SECONDS = 8.0
DIMOS_STOP_GRACE_SECONDS = 60.0
BLUEPRINTS = tuple(BLUEPRINT_CLI)
CLIENTS = ("specs", "webxr")

_RE_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_RE_ARMODULE_READY = re.compile(r"ARModule ready\s+[—\-]\s+(ws://\S+)", re.IGNORECASE)
_RE_WEBSOCKET_BANNER = re.compile(r"WebSocket:\s+(ws://\S+)", re.IGNORECASE)
_RE_WEBSOCKET_STARTED = re.compile(
    r"ARModule started\s+websocket=(ws://\S+)", re.IGNORECASE
)
_RE_HOST_IP = re.compile(r"Host IP:\s+(\S+)", re.IGNORECASE)
_RE_PIN = re.compile(r"PIN:\s+(\d{6})", re.IGNORECASE)
_RE_ROBOT_IP = re.compile(r"Robot IP:\s+(\S+)", re.IGNORECASE)
_RE_CHECK_OK = re.compile(r"^CHECK_OK=([01])\s*$")
_RE_DIMOS_PYTHON = re.compile(r"^DIMOS_PYTHON=(.+)$")
_RE_DIMOS_VERSION = re.compile(r"^DIMOS_VERSION=(.+)$")
_RE_DIMOS_REF = re.compile(r"^DIMOS_REF=(.+)$")
_RE_WEBXR_URL = re.compile(r"\b(Local|Network):\s+(https?://\S+)")


def _strip_ansi(text: str) -> str:
    return _RE_ANSI.sub("", text)


def abs_dimos_python(path: str) -> str:
    """Absolutize a venv interpreter without following the python symlink.

    Path.resolve() follows .venv/bin/python3 to the base CPython (uv, pyenv,
    Homebrew). That interpreter has no site-packages, so import dimos fails.
    Match resolve_abs_path in dimos_lib.sh: resolve the parent, keep the name.
    """
    raw = Path(path).expanduser()
    try:
        return str(raw.parent.resolve() / raw.name)
    except OSError:
        return str(raw)


def detect_lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    finally:
        sock.close()
    return "unknown"


class Phase(str, Enum):
    IDLE = "idle"
    CHECKING = "checking"
    NEEDS_SETUP = "needs_setup"
    READY = "ready"
    INSTALLING = "installing"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    ERROR = "error"


@dataclass(frozen=True)
class LauncherStatus:
    phase: Phase = Phase.IDLE
    check_ok: bool | None = None
    dimos_python: str | None = None
    dimos_version: str | None = None
    dimos_ref: str | None = None
    websocket_url: str | None = None
    host_ip: str | None = None
    pin: str | None = None
    robot_ip: str | None = None
    warning: str | None = None
    blueprint: str | None = None
    client: str | None = None
    webxr_phase: str = "stopped"
    webxr_error: str | None = None
    webxr_url: str | None = None
    webxr_local_url: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class RuntimeFacts:
    phase: Phase | None = None
    websocket_url: str | None = None
    pin: str | None = None
    robot_ip: str | None = None
    warning: str | None = None
    blueprint: str | None = None
    client: str | None = None
    webxr_phase: str = "stopped"
    webxr_error: str | None = None
    webxr_url: str | None = None
    webxr_local_url: str | None = None
    error: str | None = None


class RuntimeUpdate(TypedDict, total=False):
    phase: Phase | None
    websocket_url: str | None
    host_ip: str | None
    pin: str | None
    robot_ip: str | None
    warning: str | None
    blueprint: str | None
    client: str | None
    webxr_phase: str
    webxr_error: str | None
    webxr_url: str | None
    webxr_local_url: str | None
    error: str | None


@dataclass(frozen=True)
class DependencyFacts:
    phase: Phase = Phase.IDLE
    check_ok: bool | None = None
    dimos_python: str | None = None
    dimos_version: str | None = None
    dimos_ref: str | None = None
    error: str | None = None
    warning: str | None = None


class DependencyUpdate(TypedDict, total=False):
    phase: Phase
    check_ok: bool | None
    dimos_python: str | None
    dimos_version: str | None
    dimos_ref: str | None
    error: str | None
    warning: str | None
    host_ip: str | None


class RuntimePorts(Protocol):
    root: Path
    _lock: asyncio.Lock
    dimos_stop_grace_seconds: float

    def _append_log(self, line: str) -> None: ...

    async def _build_webxr(self, env: dict[str, str]) -> None: ...

    async def _clear_before_start(
        self, *, takeover_pids: list[int] | None = None
    ) -> None: ...

    async def _configure_system_if_needed(self) -> None: ...

    async def _drain_output(
        self,
        proc: asyncio.subprocess.Process,
        on_line: Callable[[str], Awaitable[None]] | None = None,
    ) -> int: ...

    async def _ensure_webxr_deps(self) -> None: ...

    def _require_vps_credentials(
        self, armodule_config: dict[str, Any] | None = None
    ) -> None: ...

    def _webxr_dir(self) -> Path: ...

    def build_start_argv(
        self,
        *,
        blueprint: str,
        robot_ip: str | None = None,
        config_path: Path | None = None,
    ) -> list[str]: ...

    @property
    def can_setup_running(self) -> bool: ...

    async def can_status(self, interface: str = "can0") -> dict[str, Any]: ...

    async def cancel_dependencies(self) -> None: ...

    @property
    def dependency_process(self) -> asyncio.subprocess.Process | None: ...

    @property
    def dependency_running(self) -> bool: ...

    def observe_host_ip(self, address: str | None) -> None: ...

    async def planner_status(self, *, force: bool = False) -> dict[str, Any]: ...

    def publish_status(self) -> None: ...

    @property
    def status(self) -> LauncherStatus: ...


class DependencyPorts(Protocol):
    root: Path
    scripts: Path
    _lock: asyncio.Lock

    def _append_log(self, line: str) -> None: ...

    async def _drain_output(
        self,
        proc: asyncio.subprocess.Process,
        on_line: Callable[[str], Awaitable[None]] | None = None,
    ) -> int: ...

    def _logged_command(
        self,
        argv: list[str],
        *,
        cwd: Path,
        label: str,
        env: dict[str, str] | None = None,
    ) -> AbstractAsyncContextManager[asyncio.subprocess.Process]: ...

    async def _running_dimos_pids(self) -> list[int]: ...

    def _selected_python(self) -> str | None: ...

    def build_setup_argv(
        self,
        *,
        dimos_python: str | None = None,
        clone_dir: str | None = None,
        dimos_ref: str | None = None,
        manipulation: bool = False,
    ) -> list[str]: ...

    def clear_runtime_status(self) -> None: ...

    def invalidate_planner(self) -> None: ...

    def observe_host_ip(self, address: str | None) -> None: ...

    def publish_status(self) -> None: ...

    @property
    def runtime_running(self) -> bool: ...

    def snapshot(self) -> dict[str, Any]: ...


class PlannerPorts(Protocol):
    def _selected_python(self) -> str | None: ...

    def publish_status(self) -> None: ...


class ProcessManager:
    def __init__(self, root: Path | None = None) -> None:
        self.dimos_stop_grace_seconds = float(
            os.environ.get("DIMOS_STOP_GRACE_SECONDS", str(DIMOS_STOP_GRACE_SECONDS))
        )
        if (
            not math.isfinite(self.dimos_stop_grace_seconds)
            or self.dimos_stop_grace_seconds <= 0
        ):
            raise ValueError(
                "DIMOS_STOP_GRACE_SECONDS must be a finite positive number"
            )
        self.root = root or repo_root()
        self.scripts = scripts_dir(self.root)
        self._host_ip = detect_lan_ip()
        self.events = LauncherEvents(self.snapshot)
        self.runtime = RuntimeProcesses(self)
        self.dependencies = DependencyOperations(self)
        self._lock = asyncio.Lock()
        self.planner = PlannerReadiness(self)

    @property
    def status(self) -> LauncherStatus:
        runtime, dependency = self.runtime.facts, self.dependencies.facts
        return LauncherStatus(
            phase=runtime.phase or dependency.phase,
            check_ok=dependency.check_ok,
            dimos_python=dependency.dimos_python,
            dimos_version=dependency.dimos_version,
            dimos_ref=dependency.dimos_ref,
            host_ip=self._host_ip,
            websocket_url=runtime.websocket_url,
            pin=runtime.pin,
            robot_ip=runtime.robot_ip,
            blueprint=runtime.blueprint,
            client=runtime.client,
            webxr_phase=runtime.webxr_phase,
            webxr_error=runtime.webxr_error,
            webxr_url=runtime.webxr_url,
            webxr_local_url=runtime.webxr_local_url,
            warning=runtime.warning if runtime.phase else dependency.warning,
            error=runtime.error if runtime.phase else dependency.error,
        )

    def observe_host_ip(self, address: str | None) -> None:
        self._host_ip = address

    def publish_status(self) -> None:
        self._emit({"type": "status", **self.snapshot()})

    @property
    def runtime_running(self) -> bool:
        return (
            self.runtime.backend.process is not None
            or self.runtime.webxr.process is not None
        )

    @property
    def dependency_running(self) -> bool:
        return self.dependencies.operation.running

    @property
    def dependency_process(self) -> asyncio.subprocess.Process | None:
        return self.dependencies.operation.process

    @property
    def can_setup_running(self) -> bool:
        return self.dependencies.can_setup_running

    async def cancel_dependencies(self) -> None:
        await self.dependencies.cancel()

    def clear_runtime_status(self) -> None:
        self.runtime.clear_terminal_status()

    def invalidate_planner(self) -> None:
        self.planner.invalidate()

    @property
    def can_edit_configuration(self) -> bool:
        return self.status.phase not in {Phase.STARTING, Phase.RUNNING, Phase.STOPPING}

    @property
    def selected_python(self) -> str | None:
        return self.status.dimos_python

    def snapshot(self) -> dict[str, Any]:
        stored = read_env(env_path(self.root))
        dimos_install_dir = self.status.dimos_python
        if dimos_install_dir:
            interpreter = Path(dimos_install_dir).absolute()
            environment = interpreter.parent.parent
            if interpreter.parent.name == "bin" and environment.name in (
                ".venv",
                "venv",
            ):
                dimos_install_dir = str(environment.parent)
        return {
            "phase": self.status.phase.value,
            "check_ok": self.status.check_ok,
            "dimos_python": self.status.dimos_python,
            "dimos_install_dir": dimos_install_dir,
            "dimos_version": self.status.dimos_version,
            "dimos_ref": self.status.dimos_ref,
            "websocket_url": self.status.websocket_url,
            "host_ip": self.status.host_ip,
            "pin": self.status.pin,
            "webxr_phase": self.status.webxr_phase,
            "webxr_error": self.status.webxr_error,
            "robot_ip": self.status.robot_ip,
            "warning": self.status.warning,
            "blueprint": self.status.blueprint,
            "client": self.status.client,
            "webxr_url": self.status.webxr_url,
            "webxr_local_url": self.status.webxr_local_url,
            "error": self.status.error,
            "can_setup_running": self.dependencies.can_setup_running,
            "planner": self.planner.snapshot(),
            "openai_api_key": stored.get("OPENAI_API_KEY", ""),
            "multiset_client_id": stored.get("MULTISET_CLIENT_ID", ""),
            "multiset_client_secret": stored.get("MULTISET_CLIENT_SECRET", ""),
            "default_clone_dir": str((self.root.parent / "dimos").resolve()),
        }

    def subscribe(self) -> AsyncIterator[dict[str, Any]]:
        return self.events.subscribe()

    def _emit(self, event: dict[str, Any]) -> None:
        self.events.emit(event)

    def _append_log(self, line: str) -> None:
        self.events.append_log(line)

    def _selected_python(self) -> str | None:
        return self.status.dimos_python or read_env(env_path(self.root)).get(
            "DIMOS_PYTHON"
        )

    def port_in_use(self, port: int = ARMODULE_PORT) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.3)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    async def _pids_listening(self, port: int = ARMODULE_PORT) -> list[int]:
        """Return PIDs with a TCP LISTEN socket on ``port`` (via lsof)."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "lsof",
                "-nP",
                f"-iTCP:{port}",
                "-sTCP:LISTEN",
                "-t",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except FileNotFoundError:
            return []
        out, _ = await proc.communicate()
        if proc.returncode not in (0, 1):
            return []
        pids: list[int] = []
        for token in out.decode("utf-8", errors="replace").split():
            try:
                pid = int(token)
            except ValueError:
                continue
            if pid > 0 and pid not in pids:
                pids.append(pid)
        return pids

    async def _running_dimos_pids(self) -> list[int]:
        """PIDs of `dimos` CLIs. Workers share that process group."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "ps",
                "-axo",
                "pid=,command=",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except FileNotFoundError:
            return []
        out, _ = await proc.communicate()
        me = os.getpid()
        pids: list[int] = []
        for line in out.decode("utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            pid_text, _, command = stripped.partition(" ")
            try:
                pid = int(pid_text)
            except ValueError:
                continue
            if pid <= 0 or pid == me or "/bin/dimos" not in command:
                continue
            if pid not in pids:
                pids.append(pid)
        return pids

    async def _clear_before_start(
        self, *, takeover_pids: list[int] | None = None
    ) -> None:
        occupied = {port: await self._pids_listening(port) for port in STACK_PORTS}
        occupied = {
            port: pids
            for port, pids in occupied.items()
            if pids or self.port_in_use(port)
        }
        if not occupied:
            return
        listeners = {pid for pids in occupied.values() for pid in pids}
        requested = set(takeover_pids or [])
        if any(
            isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0
            for pid in requested
        ):
            raise ValueError("takeover_pids must contain positive process IDs")
        if requested - listeners:
            raise ValueError(
                "Takeover process is no longer listening on a required port; refresh status"
            )
        if (
            not requested
            or listeners - requested
            or any(not pids for pids in occupied.values())
        ):
            detail = "; ".join(
                f"{port} (PIDs {', '.join(map(str, pids)) or 'unknown'})"
                for port, pids in occupied.items()
            )
            raise RuntimeError(
                f"Required ports are in use: {detail}. Stop those processes or explicitly select their PIDs for takeover."
            )
        self._append_log(
            "Taking over explicitly selected listeners: "
            + ", ".join(map(str, sorted(requested)))
        )
        for pid in requested:
            try:
                os.kill(pid, signal.SIGINT)
            except ProcessLookupError:
                pass
        deadline = asyncio.get_running_loop().time() + STOP_GRACE_SECONDS
        while asyncio.get_running_loop().time() < deadline:
            remaining = {
                pid for port in occupied for pid in await self._pids_listening(port)
            }
            if not remaining & requested:
                break
            await asyncio.sleep(0.25)
        else:
            remaining = {
                pid for port in occupied for pid in await self._pids_listening(port)
            }
            for pid in remaining & requested:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            await asyncio.sleep(0.2)
        stuck = [port for port in occupied if self.port_in_use(port)]
        if stuck:
            raise RuntimeError(
                "Required ports remain in use after takeover: "
                + ", ".join(map(str, stuck))
            )

    def build_start_argv(
        self,
        *,
        blueprint: str,
        robot_ip: str | None = None,
        config_path: Path | None = None,
    ) -> list[str]:
        if blueprint not in BLUEPRINTS:
            raise ValueError(f"blueprint must be one of {', '.join(BLUEPRINTS)}")
        argv = [str(self.scripts / "start.sh"), "--blueprint", blueprint]
        if robot_ip:
            argv.extend(["--robot-ip", robot_ip])
        if config_path is not None:
            argv.extend(["--config", str(config_path)])
        return argv

    def build_setup_argv(
        self,
        *,
        dimos_python: str | None = None,
        clone_dir: str | None = None,
        dimos_ref: str | None = None,
        manipulation: bool = False,
    ) -> list[str]:
        argv = [str(self.scripts / "setup.sh"), "--yes"]
        if manipulation:
            argv.append("--manipulation")
        if dimos_python and clone_dir:
            raise ValueError("provide either dimos_python or clone_dir, not both")
        if dimos_python:
            argv.extend(["--dimos-python", dimos_python])
        elif clone_dir:
            argv.extend(["--clone-dir", clone_dir])
        if dimos_ref and dimos_ref.strip():
            argv.extend(["--dimos-ref", dimos_ref.strip()])
        return argv

    async def _configure_system_if_needed(self) -> None:
        """Apply DimOS's required macOS settings via one native admin prompt.

        The privileged commands live in configure-system.sh; here we only detect
        whether they are needed and, if so, run that script as root through the
        standard macOS authorization dialog (Touch ID / password). After this,
        DimOS finds the settings in place and never prompts itself.
        """
        if sys.platform != "darwin":
            return
        helper = self.scripts / "configure-system.sh"
        if not helper.exists():
            return
        state_dir = str(Path.home() / ".local" / "state" / "dimos")

        check = await asyncio.create_subprocess_exec(
            str(helper),
            "--check",
            "--state-dir",
            state_dir,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=str(self.root),
        )
        if await check.wait() == 0:
            return

        self._append_log(
            "Requesting administrator access to configure macOS networking "
            "(one-time per boot)…"
        )
        inner = f"{shlex.quote(str(helper))} --apply --state-dir {shlex.quote(state_dir)} 2>&1"
        applescript_cmd = inner.replace("\\", "\\\\").replace('"', '\\"')
        script = f'do shell script "{applescript_cmd}" with administrator privileges'

        proc = await asyncio.create_subprocess_exec(
            "osascript",
            "-e",
            script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self.root),
        )
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            self._append_log(raw.decode("utf-8", errors="replace").rstrip("\n"))
        if await proc.wait() != 0:
            raise RuntimeError(
                "System configuration was cancelled or failed. "
                "Approve the administrator prompt to start ARModule."
            )

    def _require_vps_credentials(
        self, armodule_config: dict[str, Any] | None = None
    ) -> None:
        ui = ui_from_armodule_config(armodule_config)
        if not ui["vps"]:
            return
        stored = read_env(env_path(self.root))
        missing: list[str] = []
        if not str(ui.get("map_code") or "").strip():
            missing.append("map code")
        if not stored.get("MULTISET_CLIENT_ID"):
            missing.append("MULTISET_CLIENT_ID")
        if not stored.get("MULTISET_CLIENT_SECRET"):
            missing.append("MULTISET_CLIENT_SECRET")
        if missing:
            raise ValueError("VPS is enabled but missing " + ", ".join(missing))

    def _webxr_dir(self) -> Path:
        return self.root / "clients" / "webxr"

    async def _ensure_webxr_deps(self) -> None:
        webxr_dir = self._webxr_dir()
        if not webxr_dir.is_dir():
            raise RuntimeError(f"WebXR client not found at {webxr_dir}")
        if shutil.which("npm") is None:
            raise RuntimeError("npm is required to start the WebXR client")
        if (webxr_dir / "node_modules").is_dir():
            return
        self._append_log("Installing WebXR dependencies (npm ci)…")
        await self._run_webxr_command(
            ["npm", "ci"],
            "WebXR dependency installation",
            "npm ci failed in clients/webxr",
        )

    async def _build_webxr(self, env: dict[str, str]) -> None:
        self._append_log("Building optimized WebXR client…")
        await self._run_webxr_command(
            ["npm", "run", "build"],
            "WebXR build",
            "WebXR production build failed; see launcher logs",
            env=env,
        )

    async def _run_webxr_command(
        self,
        argv: list[str],
        label: str,
        failure: str,
        *,
        env: dict[str, str] | None = None,
    ) -> None:
        async with self._logged_command(
            argv, cwd=self._webxr_dir(), env=env, label=label
        ) as proc:
            if await self._drain_output(proc) != 0:
                raise RuntimeError(failure)

    @asynccontextmanager
    async def _logged_command(
        self,
        argv: list[str],
        *,
        cwd: Path,
        label: str,
        env: dict[str, str] | None = None,
    ) -> AsyncIterator[asyncio.subprocess.Process]:
        self._append_log(f"$ {' '.join(argv)}")
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(cwd),
            env=env,
            start_new_session=True,
        )
        try:
            yield proc
        finally:
            await self.runtime._stop_one(proc, label)

    async def _drain_output(
        self,
        proc: asyncio.subprocess.Process,
        on_line: Callable[[str], Awaitable[None]] | None = None,
    ) -> int:
        assert proc.stdout is not None
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        pending = ""
        started = last_output = time.monotonic()

        async def publish(line: str) -> None:
            if not line:
                return
            self._append_log(line)
            if on_line is not None:
                await on_line(line)

        while True:
            try:
                raw = await asyncio.wait_for(proc.stdout.read(4096), timeout=0.1)
            except TimeoutError:
                # A surviving child may retain the pipe after its leader exits.
                if proc.returncode is not None:
                    break
                now = time.monotonic()
                if self.status.phase == Phase.STARTING and now - last_output >= 15:
                    self._append_log(
                        f"Still starting ({int(now - started)}s elapsed); "
                        "waiting for DimOS initialization. No new process output in 15s."
                    )
                    last_output = now
                continue
            if not raw:
                break
            last_output = time.monotonic()
            # Download tools update progress with CR rather than ending a line.
            parts = re.split(r"[\r\n]", pending + decoder.decode(raw))
            pending = parts.pop()
            for line in parts:
                await publish(line)
        await publish(pending + decoder.decode(b"", final=True))
        return await proc.wait()

    async def planner_status(self, *, force: bool = False) -> dict[str, Any]:
        return await self.planner.query(force=force)

    async def ensure_check(self) -> None:
        await self.dependencies.ensure_check()

    async def run_check(self) -> dict[str, Any]:
        return await self.dependencies.run_check()

    async def run_setup(
        self,
        *,
        dimos_python: str | None = None,
        clone_dir: str | None = None,
        dimos_ref: str | None = None,
        manipulation: bool = False,
    ) -> None:
        await self.dependencies.run_setup(
            dimos_python=dimos_python,
            clone_dir=clone_dir,
            dimos_ref=dimos_ref,
            manipulation=manipulation,
        )

    async def can_status(self, interface: str = "can0") -> dict[str, Any]:
        return await self.dependencies.can_status(interface)

    async def setup_can(self, interface: str = "can0") -> dict[str, Any]:
        return await self.dependencies.setup_can(interface)

    async def start_armodule(
        self,
        *,
        blueprint: str,
        client: str,
        robot_ip: str | None = None,
        armodule_config: dict[str, Any] | None = None,
        simulation: bool = False,
        can_port: str | None = None,
        replay: str | None = None,
        replay_streams: dict[str, str] | None = None,
        takeover_pids: list[int] | None = None,
    ) -> None:
        await self.runtime.start_armodule(
            blueprint=blueprint,
            client=client,
            robot_ip=robot_ip,
            armodule_config=armodule_config,
            simulation=simulation,
            can_port=can_port,
            replay=replay,
            replay_streams=replay_streams,
            takeover_pids=takeover_pids,
        )

    async def start_webxr(
        self, *, env: dict[str, str] | None = None, scheduled: bool = False
    ) -> None:
        await self.runtime.start_webxr(env=env, scheduled=scheduled)

    async def stop_webxr(self) -> None:
        await self.runtime.stop_webxr()

    async def stop_backend(self) -> None:
        await self.runtime.stop_backend()

    async def stop_armodule(self, *, force: bool = False) -> None:
        await self.runtime.stop_armodule(force=force)


@dataclass
class ProcessSession:
    process: asyncio.subprocess.Process | None = None
    reader: asyncio.Task[None] | None = None
    config_path: Path | None = None
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    listener_ready: bool = False
    manipulation_ready: bool = False
    startup_error: str | None = None


class RuntimeProcesses:
    """Sole owner of runtime sessions, reader tasks, readiness and process cleanup.

    The facade supplies admission/configuration and status/event ports. All commands
    share its command lock; reader completion is fenced by the owned process identity.
    """

    def __init__(self, host: RuntimePorts) -> None:
        self.host = host
        self.backend = ProcessSession()
        self.webxr = ProcessSession()
        self.pending_webxr_start: asyncio.Task[None] | None = None
        self.stopping_pids: set[int] = set()
        self.facts = RuntimeFacts()

    def update_status(self, **changes: Unpack[RuntimeUpdate]) -> None:
        if "host_ip" in changes:
            self.host.observe_host_ip(changes.pop("host_ip"))
        if changes.get("phase") in {Phase.READY, Phase.IDLE}:
            changes["phase"] = None
        self.facts = replace(self.facts, **changes)
        self.host.publish_status()

    def clear_terminal_status(self) -> None:
        if self.backend.process is not None or self.webxr.process is not None:
            raise RuntimeError("cannot replace status while a runtime process is owned")
        self.facts = replace(self.facts, phase=None, error=None, warning=None)

    @property
    def manipulation_required(self) -> bool:
        blueprint = self.host.status.blueprint
        return bool(blueprint and blueprint_definition(blueprint).manipulation)

    def _parse_armodule_line(self, line: str) -> None:
        plain = _strip_ansi(line)
        if (
            "Exception in RPC handler for " in plain
            and "/start:" in plain
            and not self.backend.startup_error
        ):
            self.backend.startup_error = plain.split("/start:", 1)[1].strip()
            self.update_status(error=self.backend.startup_error)
        if "Manipulation runtime ready" in plain:
            self.backend.manipulation_ready = True
            self._update_runtime_readiness()
        if m := _RE_PIN.search(plain):
            self.update_status(pin=m.group(1))
            return
        if m := _RE_ARMODULE_READY.search(plain):
            self.backend.listener_ready = True
            self.update_status(websocket_url=m.group(1))
            self._update_runtime_readiness()
            return
        if m := _RE_WEBSOCKET_BANNER.search(plain):
            self.update_status(websocket_url=m.group(1))
            return
        if m := _RE_WEBSOCKET_STARTED.search(plain):
            self.backend.listener_ready = True
            self.update_status(websocket_url=m.group(1))
            self._update_runtime_readiness()
            return
        if m := _RE_HOST_IP.search(plain):
            # A platform-specific shell probe must not erase a known LAN IP.
            if m.group(1).lower() != "unknown":
                self.update_status(host_ip=m.group(1))
            return
        if m := _RE_ROBOT_IP.search(plain):
            self.update_status(robot_ip=m.group(1))
            return

    def _update_runtime_readiness(self) -> None:
        if (
            self.backend.listener_ready
            and not self.backend.startup_error
            and (not self.manipulation_required or self.backend.manipulation_ready)
        ):
            self.update_status(phase=Phase.RUNNING, error=None)

    def _parse_webxr_line(self, line: str) -> None:
        match = _RE_WEBXR_URL.search(_strip_ansi(line))
        if match is None:
            return
        kind, url = match.groups()
        if kind == "Local":
            self.update_status(webxr_local_url=url)
            return
        try:
            host = urlsplit(url).hostname
            address = ipaddress.ip_address(host or "")
        except ValueError:
            return
        if address.is_loopback or address.is_unspecified:
            return
        # Prefer the default-route interface when Vite lists several adapters.
        # With no detected IP, retain the first usable address Vite reports.
        if self.host.status.webxr_url and host != self.host.status.host_ip:
            return
        self.update_status(webxr_url=url, host_ip=host)

    async def _spawn_webxr(self, env: dict[str, str]) -> None:
        argv = [
            "npm",
            "run",
            "preview",
            "--",
            "--host",
            "--port",
            str(WEBXR_PORT),
            "--strictPort",
        ]
        self.host._append_log(f"$ {' '.join(argv)}")
        self.webxr.process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self.host._webxr_dir()),
            env=env,
            start_new_session=True,
        )
        self.webxr.reader = asyncio.create_task(
            self._read_webxr_stream(self.webxr.process)
        )

    async def start_armodule(
        self,
        *,
        blueprint: str,
        client: str,
        robot_ip: str | None = None,
        armodule_config: dict[str, Any] | None = None,
        simulation: bool = False,
        can_port: str | None = None,
        replay: str | None = None,
        replay_streams: dict[str, str] | None = None,
        takeover_pids: list[int] | None = None,
    ) -> None:
        if blueprint not in BLUEPRINTS:
            raise ValueError(f"blueprint must be one of {', '.join(BLUEPRINTS)}")
        if client not in CLIENTS:
            raise ValueError(f"client must be one of {', '.join(CLIENTS)}")
        async with self.host._lock:
            if self.backend.process is not None or self.host.dependency_running:
                raise RuntimeError(
                    "ARModule or dependency operation is already running"
                )
            if self.host.can_setup_running:
                raise RuntimeError("Wait for CAN setup to finish")
            if self.host.status.check_ok is False:
                raise RuntimeError(
                    "Dependencies are not installed — use Install dependencies first"
                )

            if blueprint_definition(blueprint).manipulation:
                planner = await self.host.planner_status(force=True)
                if not planner["ready"]:
                    raise ValueError(planner["message"])
                if not simulation:
                    can = (
                        await check_can(can_port)
                        if can_port
                        else await self.host.can_status()
                    )
                    if not can["ready"]:
                        raise ValueError(can["message"])
            self.host._require_vps_credentials(armodule_config)
            await self.host._clear_before_start(
                **(
                    {"takeover_pids": takeover_pids}
                    if takeover_pids is not None
                    else {}
                )
            )
            await self.host._configure_system_if_needed()

            pinned_ip = robot_ip.strip() if robot_ip else None

            env = os.environ.copy()
            env["DIMOS_AR_SKIP_SYSCONFIG"] = "1"
            env.pop("ROBOT_IP", None)
            env.pop("DIMOS_PYTHON", None)
            env["DIMOS_AR_FORCE_COLOR"] = "1"
            if self.host.status.dimos_python:
                env["DIMOS_PYTHON"] = self.host.status.dimos_python
            stored = read_env(env_path(self.host.root))
            for key in (
                "OPENAI_API_KEY",
                "MULTISET_CLIENT_ID",
                "MULTISET_CLIENT_SECRET",
            ):
                if stored.get(key):
                    env[key] = stored[key]
            env["DIMOS_LOG_LEVEL"] = normalize_log_level(stored.get("DIMOS_LOG_LEVEL"))

            host_ip = detect_lan_ip()
            for key in tuple(env):
                if key.startswith("ARMODULE__"):
                    env.pop(key)
            for key in (
                "CAN_PORT",
                "REPLAY_DB",
                "SIMULATION",
                "REPLAY",
                "DIMOS_AR_SIMULATION",
                "ROBOT_IPS",
                "DIMOS_AR_REPLAY_STREAMS",
            ):
                env.pop(key, None)
            if can_port:
                env["CAN_PORT"] = can_port
            if replay:
                env["REPLAY_DB"] = replay
                env["DIMOS_AR_REPLAY_STREAMS"] = json.dumps(replay_streams or {})
            if simulation:
                env["DIMOS_AR_SIMULATION"] = "1"
            self.backend = ProcessSession()
            self.backend.config_path = write_runtime_config(armodule_config or {})
            argv = self.host.build_start_argv(
                blueprint=blueprint,
                robot_ip=pinned_ip,
                config_path=self.backend.config_path,
            )
            self.update_status(
                phase=Phase.STARTING,
                blueprint=blueprint,
                client=client,
                websocket_url=None,
                host_ip=host_ip,
                pin=None,
                robot_ip=pinned_ip,
                warning=None,
                error=None,
            )
            self.host._append_log(f"$ {' '.join(argv)}")
            try:
                await self._spawn(argv, env=env)
            except BaseException as exc:
                self._clear_run_config()
                self.update_status(
                    phase=Phase.ERROR, error=str(exc) or "Startup cancelled"
                )
                raise
            if (
                client == "webxr"
                and self.webxr.process is None
                and self.pending_webxr_start is None
            ):
                assert self.backend.process is not None
                self.host._append_log("Waiting for ARModule before starting WebXR…")
                self.pending_webxr_start = asyncio.create_task(
                    self._start_webxr_when_ready(
                        self.backend.process, self.backend.ready, env
                    )
                )

    async def _start_webxr_when_ready(
        self,
        proc: asyncio.subprocess.Process,
        ready: asyncio.Event,
        env: dict[str, str],
    ) -> None:
        await ready.wait()
        async with self.host._lock:
            if (
                self.backend.process is not proc
                or proc.returncode is not None
                or self.host.status.phase != Phase.RUNNING
            ):
                return
        try:
            await self.start_webxr(env=env, scheduled=True)
        finally:
            if self.pending_webxr_start is asyncio.current_task():
                self.pending_webxr_start = None

    async def start_webxr(
        self, *, env: dict[str, str] | None = None, scheduled: bool = False
    ) -> None:
        async with self.host._lock:
            if self.webxr.process is not None or (
                self.pending_webxr_start is not None
                and self.pending_webxr_start is not asyncio.current_task()
            ):
                raise RuntimeError("WebXR is already running or starting")
            self.pending_webxr_start = asyncio.current_task()
            self.update_status(webxr_phase="starting", webxr_error=None)
        try:
            await self.host._ensure_webxr_deps()
            await self.host._build_webxr(env or os.environ.copy())
            async with self.host._lock:
                await self._spawn_webxr(env or os.environ.copy())
                host_ip = self.host.status.host_ip
                self.update_status(
                    webxr_phase="running",
                    webxr_local_url=f"https://localhost:{WEBXR_PORT}",
                    webxr_url=(
                        f"https://{host_ip}:{WEBXR_PORT}"
                        if host_ip and host_ip != "unknown"
                        else None
                    ),
                )
        except asyncio.CancelledError:
            raise
        except (OSError, RuntimeError) as exc:
            self.host._append_log(f"Failed to start WebXR: {exc}")
            self.update_status(
                webxr_phase="error",
                webxr_error=str(exc),
                webxr_url=None,
                webxr_local_url=None,
            )
            if not scheduled:
                raise
        finally:
            if self.pending_webxr_start is asyncio.current_task():
                self.pending_webxr_start = None

    async def _stop_webxr_unlocked(self) -> bool:
        proc, self.webxr.process = self.webxr.process, None
        task, self.pending_webxr_start = self.pending_webxr_start, None
        await self._cancel_task(task)
        stopped = await self._stop_one(proc, "WebXR")
        await self._cancel_task(self.webxr.reader)
        self.webxr.reader = None
        self.update_status(
            webxr_phase="stopped",
            webxr_error=None,
            webxr_url=None,
            webxr_local_url=None,
        )
        return stopped

    async def stop_webxr(self) -> None:
        async with self.host._lock:
            await self._stop_webxr_unlocked()

    async def stop_backend(self) -> None:
        async with self.host._lock:
            await self._stop_backend_unlocked()
            self.update_status(
                phase=Phase.READY if self.host.status.check_ok else Phase.IDLE,
                websocket_url=None,
                pin=None,
                error=None,
            )

    def _clear_run_config(self) -> None:
        if self.backend.config_path is not None:
            self.backend.config_path.unlink(missing_ok=True)
            self.backend.config_path = None

    async def _stop_backend_unlocked(self) -> bool:
        proc, self.backend.process = self.backend.process, None
        # Cancel a pending client start waiting for this backend.
        if (
            self.pending_webxr_start is not None
            and self.host.status.webxr_phase != "starting"
        ):
            task, self.pending_webxr_start = self.pending_webxr_start, None
            await self._cancel_task(task)
        stopped = await self._stop_one(proc, "ARModule")
        self._clear_run_config()
        await self._cancel_task(self.backend.reader)
        self.backend.reader = None
        return stopped

    async def _stop_one(
        self,
        proc: asyncio.subprocess.Process | None,
        label: str,
    ) -> bool:
        if proc is None:
            return False
        if proc.returncode is not None:
            try:
                os.killpg(proc.pid, 0)
            except ProcessLookupError:
                return False
        self.stopping_pids.add(proc.pid)
        self.host._append_log(f"Stopping {label} (SIGINT)…")
        try:
            os.killpg(proc.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        try:
            grace = (
                self.host.dimos_stop_grace_seconds
                if label == "ARModule"
                else STOP_GRACE_SECONDS
            )
            if label == "ARModule" and self.manipulation_required:
                grace += 65  # Allow the supervisor to park before stopping DimOS.

            async def wait_for_group() -> None:
                while True:
                    try:
                        os.killpg(proc.pid, 0)
                    except ProcessLookupError:
                        return
                    if Path("/proc").is_dir():
                        live = False
                        for entry in Path("/proc").iterdir():
                            if not entry.name.isdigit():
                                continue
                            try:
                                fields = (
                                    (entry / "stat")
                                    .read_text()
                                    .rsplit(")", 1)[1]
                                    .split()
                                )
                                live |= int(fields[2]) == proc.pid and fields[0] != "Z"
                            except (OSError, ValueError, IndexError):
                                continue
                        if not live:
                            return
                    await asyncio.sleep(0.02)

            await asyncio.wait_for(
                wait_for_group() if proc.returncode is not None else proc.wait(),
                timeout=grace,
            )
        except TimeoutError:
            self.host._append_log(f"{label} did not stop in time — sending SIGKILL")
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await proc.wait()
        self.stopping_pids.discard(proc.pid)
        return True

    async def _cancel_task(self, task: asyncio.Task[None] | None) -> None:
        if task is None or task.done() or task is asyncio.current_task():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _stop_children_unlocked(self) -> bool:
        stopped_webxr = await self._stop_webxr_unlocked()
        stopped_ar = await self._stop_backend_unlocked()
        return stopped_webxr or stopped_ar

    async def stop_armodule(self, *, force: bool = False) -> None:
        if force:
            roots = self.stopping_pids | {
                p.pid
                for p in (
                    self.backend.process,
                    self.webxr.process,
                    self.host.dependency_process,
                )
                if p is not None and p.returncode is None
            }
            children: dict[int, list[int]] = {}
            for entry in Path("/proc").iterdir() if Path("/proc").is_dir() else []:
                if not entry.name.isdigit():
                    continue
                try:
                    fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
                    children.setdefault(int(fields[1]), []).append(int(entry.name))
                except (OSError, ValueError, IndexError):
                    continue
            if not Path("/proc").is_dir():
                process = await asyncio.create_subprocess_exec(
                    "ps", "-axo", "pid=,ppid=", stdout=asyncio.subprocess.PIPE
                )
                output, _ = await process.communicate()
                for line in output.decode().splitlines():
                    fields = line.split()
                    if len(fields) == 2:
                        children.setdefault(int(fields[1]), []).append(int(fields[0]))
            owned: list[int] = []

            def collect(pid: int) -> None:
                if pid in owned:
                    return
                owned.append(pid)
                for child in children.get(pid, []):
                    collect(child)

            for pid in roots:
                collect(pid)
            self.host._append_log("Force stopping owned runtime processes…")
            for pid in reversed(owned):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            deadline = time.monotonic() + 2

            def alive(pid: int) -> bool:
                try:
                    return (
                        Path(f"/proc/{pid}/stat")
                        .read_text()
                        .rsplit(")", 1)[1]
                        .split()[0]
                        != "Z"
                    )
                except (OSError, IndexError):
                    if Path("/proc").is_dir():
                        return False
                    try:
                        os.kill(pid, 0)
                        return True
                    except ProcessLookupError:
                        return False

            while any(alive(pid) for pid in owned) and time.monotonic() < deadline:
                await asyncio.sleep(0.02)
            remaining = [pid for pid in owned if alive(pid)]
            if remaining:
                self.update_status(
                    phase=Phase.STOPPING, error=f"Force stop incomplete: {remaining}"
                )
                return
            if not self.host._lock.locked():
                await self.stop_armodule()
            return
        if self.host.status.phase == Phase.STOPPING:
            return
        async with self.host._lock:
            self.update_status(phase=Phase.STOPPING)
            await self.host.cancel_dependencies()
            stopped_managed = await self._stop_children_unlocked()
            if stopped_managed:
                self.host._append_log("ARModule stopped.")
            else:
                self.host._append_log("No launcher-owned runtime process to stop.")

            self.stopping_pids.clear()
            self.update_status(
                phase=Phase.READY if self.host.status.check_ok else Phase.IDLE,
                websocket_url=None,
                pin=None,
                webxr_url=None,
                webxr_local_url=None,
            )

    async def _spawn(
        self,
        argv: list[str],
        *,
        env: dict[str, str],
    ) -> None:
        self.backend.process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self.host.root),
            env=env,
            start_new_session=True,
        )
        self.backend.reader = asyncio.create_task(
            self._read_stream(self.backend.process, ready=self.backend.ready)
        )

    async def _read_stream(
        self,
        proc: asyncio.subprocess.Process,
        *,
        ready: asyncio.Event | None = None,
    ) -> None:
        async def on_line(line: str) -> None:
            if (
                self.backend.process is proc
                and self.host.status.phase != Phase.STOPPING
            ):
                self._parse_armodule_line(line)
                if ready is not None and self.host.status.phase == Phase.RUNNING:
                    ready.set()

        try:
            code = await self.host._drain_output(proc, on_line)
        finally:
            if proc.returncode is None:
                await proc.wait()

        if self.backend.process is not proc or self.host.status.phase == Phase.STOPPING:
            return
        error = self.backend.startup_error or (
            None if code == 0 else f"start.sh exited with code {code}"
        )
        asyncio.create_task(self._finalize_exit(error, expected_proc=proc))

    async def _read_webxr_stream(self, proc: asyncio.subprocess.Process) -> None:
        async def on_line(line: str) -> None:
            if self.webxr.process is proc and self.host.status.phase != Phase.STOPPING:
                self._parse_webxr_line(line)

        try:
            await self.host._drain_output(proc, on_line)
        finally:
            if proc.returncode is None:
                await proc.wait()

        if self.webxr.process is not proc or self.host.status.phase == Phase.STOPPING:
            return
        async with self.host._lock:
            if self.webxr.process is proc:
                await self._stop_one(proc, "WebXR")
                self.webxr.process = None
                self.webxr.reader = None
                self.host._append_log("WebXR exited; ARModule remains available")
                self.update_status(
                    webxr_phase="error",
                    webxr_error="WebXR exited",
                    webxr_url=None,
                    webxr_local_url=None,
                )

    async def _finalize_exit(
        self,
        error: str | None,
        *,
        expected_proc: asyncio.subprocess.Process | None = None,
    ) -> None:
        async with self.host._lock:
            if self.host.status.phase == Phase.STOPPING or (
                expected_proc is not None and self.backend.process is not expected_proc
            ):
                return
            await self._stop_backend_unlocked()
            error = self.backend.startup_error or error
            self.update_status(
                phase=Phase.ERROR
                if error
                else (Phase.READY if self.host.status.check_ok else Phase.IDLE),
                error=error,
                websocket_url=None,
                pin=None,
            )


class DependencyOperations:
    """One cancellable dependency operation and CAN configuration admission owner."""

    def __init__(self, host: DependencyPorts) -> None:
        self.host = host
        self.operation = OwnedOperation()
        self.check_started = False
        self.can_setup_running = False
        self.facts = DependencyFacts()

    def update_status(self, **changes: Unpack[DependencyUpdate]) -> None:
        if "host_ip" in changes:
            self.host.observe_host_ip(changes.pop("host_ip"))
        if changes.get("phase") in {Phase.CHECKING, Phase.INSTALLING}:
            self.host.clear_runtime_status()
        old_python = self.facts.dimos_python
        self.facts = replace(self.facts, **changes)
        if self.facts.dimos_python != old_python:
            self.host.invalidate_planner()
        self.host.publish_status()

    async def cancel(self) -> None:
        await self.operation.cancel()
        self.update_status(phase=Phase.READY if self.facts.check_ok else Phase.IDLE)

    async def can_status(self, interface: str = "can0") -> dict[str, Any]:
        result = (
            await check_can(interface) if interface != "can0" else await check_can()
        )
        return {**result, "setting_up": self.can_setup_running}

    async def setup_can(self, interface: str = "can0") -> dict[str, Any]:
        if self.can_setup_running:
            raise RuntimeError("CAN setup is already running")
        async with self.host._lock:
            if (
                self.host.runtime_running
                or self.operation.running
                or await self.host._running_dimos_pids()
            ):
                raise RuntimeError(
                    "CAN setup is unavailable while DimOS is running. Stop it yourself before configuring CAN."
                )
            self.can_setup_running = True
            self.host.publish_status()
            proc = None
            try:
                status = (
                    await self.can_status(interface)
                    if interface != "can0"
                    else await self.can_status()
                )
                if status["ready"]:
                    return {**status, "setting_up": False}
                python = self.host._selected_python()
                if not python:
                    raise ValueError("Select an installed DimOS environment first")
                argv = (
                    setup_command(python, interface)
                    if interface != "can0"
                    else setup_command(python)
                )
                self.host._append_log(
                    f"Setting up {interface}. Approve the native administrator prompt if shown…"
                )
                proc = await asyncio.create_subprocess_exec(
                    *argv,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    stdin=asyncio.subprocess.DEVNULL,
                )
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
                for line in out.decode(errors="replace").splitlines():
                    self.host._append_log(line)
                if proc.returncode:
                    raise RuntimeError(
                        "CAN setup was cancelled or failed. See the launcher log."
                    )
                verified = (
                    await check_can(interface)
                    if interface != "can0"
                    else await check_can()
                )
                if not verified["ready"]:
                    raise RuntimeError(verified["message"])
                return {**verified, "setting_up": False}
            except TimeoutError as exc:
                raise RuntimeError(
                    "CAN setup timed out. Dismiss the administrator prompt and retry."
                ) from exc
            finally:
                if proc is not None and proc.returncode is None:
                    try:
                        proc.kill()
                        await asyncio.wait_for(proc.wait(), timeout=2)
                    except (PermissionError, ProcessLookupError, TimeoutError):
                        self.host._append_log(
                            "CAN setup did not exit; dismiss its administrator prompt."
                        )
                self.can_setup_running = False
                self.host.publish_status()

    async def ensure_check(self) -> None:
        if self.check_started:
            return
        self.check_started = True
        await self.run_check()

    async def run_check(self) -> dict[str, Any]:
        async with self.host._lock:
            self._require_dependency_idle()
            task = self.operation.start(self._check_dependencies())
        try:
            return await task
        except OSError as exc:
            if self.operation.task is task:
                self.update_status(phase=Phase.ERROR, error=str(exc))
            raise

    def _require_dependency_idle(self) -> None:
        if self.host.runtime_running or self.operation.running:
            raise RuntimeError("another process is already running")

    async def _check_dependencies(self) -> dict[str, Any]:
        self.update_status(
            phase=Phase.CHECKING,
            check_ok=None,
            error=None,
            warning=None,
            host_ip=detect_lan_ip(),
        )
        argv = [str(self.host.scripts / "setup.sh"), "--check"]
        check_ok = False
        dimos_python: str | None = None
        dimos_version: str | None = None
        dimos_ref: str | None = None

        async def on_line(line: str) -> None:
            nonlocal check_ok, dimos_python, dimos_version, dimos_ref
            plain = _strip_ansi(line)
            if m := _RE_CHECK_OK.match(plain):
                check_ok = m.group(1) == "1"
            elif m := _RE_DIMOS_PYTHON.match(plain):
                dimos_python = abs_dimos_python(m.group(1).strip())
            elif m := _RE_DIMOS_VERSION.match(plain):
                dimos_version = m.group(1).strip()
            elif m := _RE_DIMOS_REF.match(plain):
                dimos_ref = m.group(1).strip()

        env = os.environ.copy()
        env["DIMOS_AR_FORCE_COLOR"] = "1"
        env.pop("DIMOS_PYTHON", None)
        selected_python = read_env(env_path(self.host.root)).get("DIMOS_PYTHON")
        if selected_python:
            env["DIMOS_PYTHON"] = selected_python
        await self._run_tracked(argv, env=env, on_line=on_line)
        self.update_status(
            phase=Phase.READY if check_ok else Phase.NEEDS_SETUP,
            check_ok=check_ok,
            dimos_python=dimos_python,
            dimos_version=dimos_version,
            dimos_ref=dimos_ref,
            error=None,
        )
        self.host.invalidate_planner()
        return self.host.snapshot()

    async def run_setup(
        self,
        *,
        dimos_python: str | None = None,
        clone_dir: str | None = None,
        dimos_ref: str | None = None,
        manipulation: bool = False,
    ) -> None:
        async with self.host._lock:
            self._require_dependency_idle()
            if self.can_setup_running or await self.host._running_dimos_pids():
                raise RuntimeError(
                    "Stop DimOS yourself before installing dependencies, and wait for CAN setup to finish"
                )
            task = self.operation.start(
                self._install_dependencies(
                    dimos_python=dimos_python,
                    clone_dir=clone_dir,
                    dimos_ref=dimos_ref,
                    manipulation=manipulation,
                )
            )
        try:
            await task
        except OSError as exc:
            if self.operation.task is task:
                self.update_status(phase=Phase.ERROR, error=str(exc))
            raise

    async def _install_dependencies(
        self,
        *,
        dimos_python: str | None,
        clone_dir: str | None,
        dimos_ref: str | None,
        manipulation: bool,
    ) -> None:
        argv = self.host.build_setup_argv(
            dimos_python=dimos_python,
            clone_dir=clone_dir,
            dimos_ref=dimos_ref,
            manipulation=manipulation,
        )
        self.host._append_log("Installing dependencies…")
        self.update_status(phase=Phase.INSTALLING, check_ok=None, error=None)
        env = os.environ.copy()
        env["DIMOS_AR_FORCE_COLOR"] = "1"
        env.pop("DIMOS_PYTHON", None)
        code = await self._run_tracked(argv, env=env)
        if code != 0:
            self.update_status(
                phase=Phase.NEEDS_SETUP,
                check_ok=False,
                error=None,
            )
            raise RuntimeError(f"setup.sh exited with code {code}")
        selected_python = dimos_python
        if clone_dir:
            selected_python = str(
                Path(clone_dir).expanduser() / ".venv" / "bin" / "python3"
            )
        if selected_python:
            merge_env({"DIMOS_PYTHON": selected_python}, env_path(self.host.root))
        await self._check_dependencies()

    async def _run_tracked(
        self,
        argv: list[str],
        *,
        env: dict[str, str],
        on_line: Callable[[str], Awaitable[None]] | None = None,
    ) -> int:
        async with self.host._logged_command(
            argv, cwd=self.host.root, env=env, label="Setup"
        ) as proc:
            self.operation.process = proc
            try:
                return await self.host._drain_output(proc, on_line)
            finally:
                if self.operation.process is proc:
                    self.operation.process = None


class PlannerReadiness:
    """Caches readiness for exactly one interpreter, with serialized probes."""

    def __init__(self, host: PlannerPorts) -> None:
        self.host = host
        self.lock = asyncio.Lock()
        self.result: dict[str, Any] = {
            "ready": False,
            "state": "checking",
            "message": "Checking manipulation dependencies…",
        }
        self.python: str | None = None
        self.checked_at = 0.0

    def snapshot(self) -> dict[str, Any]:
        return dict(self.result)

    def invalidate(self) -> None:
        self.checked_at = 0.0
        self.python = None
        self.result = {
            "ready": False,
            "state": "checking",
            "message": "Checking manipulation dependencies…",
        }

    async def query(self, *, force: bool = False) -> dict[str, Any]:
        async with self.lock:
            python = self.host._selected_python()
            now = asyncio.get_running_loop().time()
            if not force and python == self.python and now - self.checked_at < 30:
                return self.snapshot()
            result: dict[str, Any] = {
                "ready": False,
                "state": "incomplete",
                "message": "Select an installed DimOS environment first.",
            }
            if python:
                try:
                    decoded = await run_json_probe(
                        python,
                        str(Path(__file__).with_name("planner_check.py")),
                        timeout=30,
                    )
                    if not isinstance(decoded.get("ready"), bool):
                        raise TypeError("Invalid planner check response")
                    result = decoded
                except (
                    OSError,
                    ValueError,
                    TypeError,
                    AttributeError,
                    TimeoutError,
                ) as exc:
                    result = {
                        "ready": False,
                        "state": "incomplete",
                        "message": f"Planner check failed: {exc}",
                    }
            if python != self.host._selected_python():
                # Selection changed while the subprocess was running. Do not cache
                # or advertise its result as readiness of the new interpreter.
                self.invalidate()
                return self.snapshot()
            self.result = result
            self.python = python
            self.checked_at = now
            self.host.publish_status()
            return self.snapshot()
