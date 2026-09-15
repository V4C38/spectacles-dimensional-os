"""Child-process manager for setup.sh / start.sh with SSE log fan-out."""

from __future__ import annotations

import asyncio
import os
import re
import shlex
import shutil
import signal
import socket
import sys
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from config import (
    env_path,
    merge_env,
    migrate_legacy_env,
    normalize_log_level,
    read_env,
    repo_root,
    scripts_dir,
)
from dimos_config import read_armodule_config
from tag_config import ui_from_armodule_config

ARMODULE_PORT = 8787
WEBXR_PORT = 5173
LOG_BUFFER_SIZE = 500
SUBSCRIBER_QUEUE_SIZE = 2000
STOP_GRACE_SECONDS = 8.0
BLUEPRINTS = ("unitree_go2_ar", "unitree_go2_ar_agentic")
CLIENTS = ("specs", "webxr")
BLUEPRINT_CLI = {
    "unitree_go2_ar": "dimos-ar.unitree-go2-ar",
    "unitree_go2_ar_agentic": "dimos-ar.unitree-go2-ar-agentic",
}

_RE_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_RE_ARMODULE_READY = re.compile(r"ARModule ready\s+[—\-]\s+(ws://\S+)", re.IGNORECASE)
_RE_WEBSOCKET_BANNER = re.compile(r"WebSocket:\s+(ws://\S+)", re.IGNORECASE)
_RE_WEBSOCKET_STARTED = re.compile(r"websocket=(ws://\S+)", re.IGNORECASE)
_RE_HOST_IP = re.compile(r"Host IP:\s+(\S+)", re.IGNORECASE)
_RE_ROBOT_IP = re.compile(r"Robot IP:\s+(\S+)", re.IGNORECASE)
_RE_CHECK_OK = re.compile(r"^CHECK_OK=([01])\s*$")
_RE_DIMOS_PYTHON = re.compile(r"^DIMOS_PYTHON=(.+)$")
_RE_DIMOS_VERSION = re.compile(r"^DIMOS_VERSION=(.+)$")
_RE_DIMOS_REF = re.compile(r"^DIMOS_REF=(.+)$")


def _strip_ansi(text: str) -> str:
    return _RE_ANSI.sub("", text)


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


@dataclass
class LauncherStatus:
    phase: Phase = Phase.IDLE
    check_ok: bool | None = None
    dimos_python: str | None = None
    dimos_version: str | None = None
    dimos_ref: str | None = None
    websocket_url: str | None = None
    host_ip: str | None = None
    robot_ip: str | None = None
    warning: str | None = None
    blueprint: str | None = None
    client: str | None = None
    webxr_url: str | None = None
    webxr_local_url: str | None = None
    error: str | None = None


@dataclass
class _Subscriber:
    queue: asyncio.Queue[dict[str, Any]] = field(
        default_factory=lambda: asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
    )


class ProcessManager:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or repo_root()
        migrate_legacy_env(self.root)
        self.scripts = scripts_dir(self.root)
        self.status = LauncherStatus(host_ip=detect_lan_ip())
        self._log: deque[str] = deque(maxlen=LOG_BUFFER_SIZE)
        self._subs: list[_Subscriber] = []
        self._proc: asyncio.subprocess.Process | None = None
        self._webxr_proc: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._webxr_reader_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._check_started = False

    def snapshot(self) -> dict[str, Any]:
        stored = read_env(env_path(self.root))
        return {
            "phase": self.status.phase.value,
            "check_ok": self.status.check_ok,
            "dimos_python": self.status.dimos_python,
            "dimos_version": self.status.dimos_version,
            "dimos_ref": self.status.dimos_ref,
            "websocket_url": self.status.websocket_url,
            "host_ip": self.status.host_ip,
            "robot_ip": self.status.robot_ip,
            "warning": self.status.warning,
            "blueprint": self.status.blueprint,
            "client": self.status.client,
            "webxr_url": self.status.webxr_url,
            "webxr_local_url": self.status.webxr_local_url,
            "error": self.status.error,
            "openai_api_key": stored.get("OPENAI_API_KEY", ""),
            "multiset_client_id": stored.get("MULTISET_CLIENT_ID", ""),
            "multiset_client_secret": stored.get("MULTISET_CLIENT_SECRET", ""),
            "default_clone_dir": str((self.root.parent / "dimos").resolve()),
        }

    async def subscribe(self) -> AsyncIterator[dict[str, Any]]:
        sub = _Subscriber()
        self._subs.append(sub)
        try:
            for line in list(self._log):
                yield {"type": "log", "line": line}
            yield {"type": "status", **self.snapshot()}
            while True:
                event = await sub.queue.get()
                yield event
        finally:
            if sub in self._subs:
                self._subs.remove(sub)

    def _emit(self, event: dict[str, Any]) -> None:
        for sub in list(self._subs):
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                dropped = 0
                while sub.queue.qsize() > max(0, SUBSCRIBER_QUEUE_SIZE - 3):
                    try:
                        old = sub.queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    if old.get("type") == "log":
                        dropped += 1
                try:
                    sub.queue.put_nowait(event)
                    if dropped:
                        sub.queue.put_nowait(
                            {
                                "type": "log",
                                "line": f"… {dropped} log lines dropped",
                            }
                        )
                    sub.queue.put_nowait({"type": "status", **self.snapshot()})
                except asyncio.QueueFull:
                    pass

    def _append_log(self, line: str) -> None:
        self._log.append(line)
        self._emit({"type": "log", "line": line})

    def _set_status(self, **kwargs: Any) -> None:
        for key, value in kwargs.items():
            setattr(self.status, key, value)
        self._emit({"type": "status", **self.snapshot()})

    def _parse_armodule_line(self, line: str) -> None:
        if (
            self.status.phase == Phase.RUNNING
            and self.status.websocket_url
            and self.status.host_ip
            and self.status.robot_ip is not None
        ):
            return
        plain = _strip_ansi(line)
        if m := _RE_ARMODULE_READY.search(plain):
            self._set_status(websocket_url=m.group(1), phase=Phase.RUNNING, error=None)
            return
        if m := _RE_WEBSOCKET_BANNER.search(plain):
            self._set_status(websocket_url=m.group(1))
            return
        if m := _RE_WEBSOCKET_STARTED.search(plain):
            self._set_status(websocket_url=m.group(1), phase=Phase.RUNNING, error=None)
            return
        if m := _RE_HOST_IP.search(plain):
            self._set_status(host_ip=m.group(1))
            return
        if m := _RE_ROBOT_IP.search(plain):
            self._set_status(robot_ip=m.group(1))
            return

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

    def _signal_pid(self, pid: int, sig: signal.Signals) -> None:
        try:
            os.killpg(os.getpgid(pid), sig)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                os.kill(pid, sig)
            except (ProcessLookupError, PermissionError, OSError):
                pass

    async def _kill_port_listeners(self, port: int = ARMODULE_PORT) -> bool:
        """Kill any process listening on ``port``. Returns True if something was targeted."""
        pids = await self._pids_listening(port)
        if not pids:
            return False
        self._append_log(
            f"Stopping other ARModule process(es) on port {port}: "
            + ", ".join(str(p) for p in pids)
        )
        for pid in pids:
            self._signal_pid(pid, signal.SIGINT)
        deadline = asyncio.get_running_loop().time() + STOP_GRACE_SECONDS
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.25)
            if not await self._pids_listening(port):
                self._append_log(f"Port {port} is free.")
                return True
        remaining = await self._pids_listening(port)
        if remaining:
            self._append_log(
                f"Port {port} still held — sending SIGKILL to "
                + ", ".join(str(p) for p in remaining)
            )
            for pid in remaining:
                self._signal_pid(pid, signal.SIGKILL)
            await asyncio.sleep(0.2)
        if await self._pids_listening(port):
            self._append_log(f"Warning: port {port} is still in use.")
        else:
            self._append_log(f"Port {port} is free.")
        return True

    def build_start_argv(
        self,
        *,
        blueprint: str,
        robot_ip: str | None = None,
    ) -> list[str]:
        if blueprint not in BLUEPRINTS:
            raise ValueError(f"blueprint must be one of {', '.join(BLUEPRINTS)}")
        argv = [str(self.scripts / "start.sh"), "--blueprint", blueprint]
        if robot_ip:
            argv.extend(["--robot-ip", robot_ip])
        return argv

    def build_setup_argv(
        self,
        *,
        dimos_python: str | None = None,
        clone_dir: str | None = None,
        dimos_ref: str | None = None,
    ) -> list[str]:
        argv = [str(self.scripts / "setup.sh"), "--yes"]
        if dimos_python and clone_dir:
            raise ValueError("provide either dimos_python or clone_dir, not both")
        if dimos_python:
            argv.extend(["--dimos-python", dimos_python])
        elif clone_dir:
            argv.extend(["--clone-dir", clone_dir])
        if dimos_ref and dimos_ref.strip():
            argv.extend(["--dimos-ref", dimos_ref.strip()])
        return argv

    async def ensure_check(self) -> None:
        if self._check_started:
            return
        self._check_started = True
        await self.run_check()

    async def run_check(self) -> dict[str, Any]:
        async with self._lock:
            if self._proc is not None or self._webxr_proc is not None:
                raise RuntimeError("another process is already running")
            self._set_status(
                phase=Phase.CHECKING,
                check_ok=None,
                error=None,
                warning=None,
                host_ip=detect_lan_ip(),
            )
            argv = [str(self.scripts / "setup.sh"), "--check"]
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
                    raw = m.group(1).strip()
                    try:
                        dimos_python = str(Path(raw).resolve())
                    except OSError:
                        dimos_python = raw
                elif m := _RE_DIMOS_VERSION.match(plain):
                    dimos_version = m.group(1).strip()
                elif m := _RE_DIMOS_REF.match(plain):
                    dimos_ref = m.group(1).strip()

            env = os.environ.copy()
            env["DIMOS_AR_FORCE_COLOR"] = "1"
            await self._run_tracked(argv, env=env, on_line=on_line)
            self._set_status(
                phase=Phase.READY if check_ok else Phase.NEEDS_SETUP,
                check_ok=check_ok,
                dimos_python=dimos_python,
                dimos_version=dimos_version,
                dimos_ref=dimos_ref,
                error=None,
            )
            return self.snapshot()

    async def run_setup(
        self,
        *,
        dimos_python: str | None = None,
        clone_dir: str | None = None,
        dimos_ref: str | None = None,
    ) -> None:
        async with self._lock:
            if self._proc is not None or self._webxr_proc is not None:
                raise RuntimeError("another process is already running")
            argv = self.build_setup_argv(
                dimos_python=dimos_python,
                clone_dir=clone_dir,
                dimos_ref=dimos_ref,
            )
            self._append_log("Installing dependencies…")
            self._set_status(phase=Phase.INSTALLING, error=None)
            env = os.environ.copy()
            env["DIMOS_AR_FORCE_COLOR"] = "1"
            code = await self._run_tracked(argv, env=env)
            if code != 0:
                self._set_status(
                    phase=Phase.NEEDS_SETUP,
                    check_ok=False,
                    error=None,
                )
                raise RuntimeError(f"setup.sh exited with code {code}")

        await self.run_check()

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
        inner = (
            f"{shlex.quote(str(helper))} --apply --state-dir {shlex.quote(state_dir)} 2>&1"
        )
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

    def _require_vps_credentials(self) -> None:
        ui = ui_from_armodule_config(read_armodule_config())
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
        proc = await asyncio.create_subprocess_exec(
            "npm",
            "ci",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(webxr_dir),
        )
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            self._append_log(raw.decode("utf-8", errors="replace").rstrip("\n"))
        if await proc.wait() != 0:
            raise RuntimeError("npm ci failed in clients/webxr")

    async def _spawn_webxr(self, env: dict[str, str]) -> None:
        argv = [
            "npm",
            "run",
            "dev",
            "--",
            "--host",
            "--port",
            str(WEBXR_PORT),
            "--strictPort",
        ]
        self._append_log(f"$ {' '.join(argv)}")
        self._webxr_proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self._webxr_dir()),
            env=env,
            start_new_session=True,
        )
        self._webxr_reader_task = asyncio.create_task(
            self._read_webxr_stream(self._webxr_proc)
        )

    async def start_armodule(
        self,
        *,
        blueprint: str,
        client: str,
        robot_ip: str | None = None,
    ) -> None:
        if blueprint not in BLUEPRINTS:
            raise ValueError(f"blueprint must be one of {', '.join(BLUEPRINTS)}")
        if client not in CLIENTS:
            raise ValueError(f"client must be one of {', '.join(CLIENTS)}")
        async with self._lock:
            if self._proc is not None or self._webxr_proc is not None:
                raise RuntimeError("ARModule is already running")
            if self.port_in_use(ARMODULE_PORT):
                raise RuntimeError(
                    f"port {ARMODULE_PORT} is already in use — stop the other ARModule first"
                )
            if client == "webxr" and self.port_in_use(WEBXR_PORT):
                raise RuntimeError(
                    f"port {WEBXR_PORT} is already in use — stop the other WebXR server first"
                )
            if self.status.check_ok is False:
                raise RuntimeError(
                    "Dependencies are not installed — use Install dependencies first"
                )

            self._require_vps_credentials()
            await self._configure_system_if_needed()
            if client == "webxr":
                await self._ensure_webxr_deps()

            pinned_ip = robot_ip.strip() if robot_ip else None
            if pinned_ip in ("simulated", "fake"):
                pinned_ip = "simulated"
            merge_env({"ROBOT_IP": pinned_ip}, env_path(self.root))

            env = os.environ.copy()
            env["DIMOS_AR_SKIP_SYSCONFIG"] = "1"
            env.pop("ROBOT_IP", None)
            env["DIMOS_AR_FORCE_COLOR"] = "1"
            stored = read_env(env_path(self.root))
            for key in ("OPENAI_API_KEY", "MULTISET_CLIENT_ID", "MULTISET_CLIENT_SECRET"):
                if stored.get(key):
                    env[key] = stored[key]
            env["DIMOS_LOG_LEVEL"] = normalize_log_level(stored.get("DIMOS_LOG_LEVEL"))

            host_ip = detect_lan_ip()
            webxr_local_url = f"https://localhost:{WEBXR_PORT}" if client == "webxr" else None
            webxr_url = (
                f"https://{host_ip}:{WEBXR_PORT}"
                if client == "webxr" and host_ip != "unknown"
                else None
            )
            argv = self.build_start_argv(blueprint=blueprint, robot_ip=pinned_ip)
            self._set_status(
                phase=Phase.STARTING,
                blueprint=blueprint,
                client=client,
                websocket_url=None,
                host_ip=host_ip,
                robot_ip=pinned_ip,
                webxr_url=webxr_url,
                webxr_local_url=webxr_local_url,
                warning=None,
                error=None,
            )
            self._append_log(f"$ {' '.join(argv)}")
            await self._spawn(argv, env=env, parse_armodule=True)
            if client == "webxr":
                try:
                    await self._spawn_webxr(env)
                except Exception:
                    await self._stop_children_unlocked()
                    self._set_status(
                        phase=Phase.READY if self.status.check_ok else Phase.IDLE,
                        websocket_url=None,
                        webxr_url=None,
                        webxr_local_url=None,
                    )
                    raise

    async def _stop_one(
        self,
        proc: asyncio.subprocess.Process | None,
        label: str,
    ) -> bool:
        if proc is None or proc.returncode is not None:
            return False
        self._append_log(f"Stopping {label} (SIGINT)…")
        try:
            os.killpg(proc.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=STOP_GRACE_SECONDS)
        except asyncio.TimeoutError:
            self._append_log(f"{label} did not stop in time — sending SIGKILL")
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await proc.wait()
        return True

    async def _cancel_task(self, task: asyncio.Task[None] | None) -> None:
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _stop_children_unlocked(self) -> bool:
        stopped_webxr = await self._stop_one(self._webxr_proc, "WebXR")
        self._webxr_proc = None
        await self._cancel_task(self._webxr_reader_task)
        self._webxr_reader_task = None
        stopped_ar = await self._stop_one(self._proc, "ARModule")
        self._proc = None
        await self._cancel_task(self._reader_task)
        self._reader_task = None
        return stopped_webxr or stopped_ar

    async def stop_armodule(self) -> None:
        async with self._lock:
            self._set_status(phase=Phase.STOPPING)
            stopped_managed = await self._stop_children_unlocked()
            freed_port = await self._kill_port_listeners(ARMODULE_PORT)
            if stopped_managed:
                self._append_log("ARModule stopped.")
            elif not freed_port:
                self._append_log(f"No ARModule process on port {ARMODULE_PORT}.")

            if (
                stopped_managed
                or freed_port
                or self.status.phase in (Phase.RUNNING, Phase.STARTING, Phase.STOPPING)
            ):
                self._set_status(
                    phase=Phase.READY if self.status.check_ok else Phase.IDLE,
                    websocket_url=None,
                    webxr_url=None,
                    webxr_local_url=None,
                )

    async def _spawn(
        self,
        argv: list[str],
        *,
        env: dict[str, str],
        parse_armodule: bool,
    ) -> None:
        self._proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self.root),
            env=env,
            start_new_session=True,
        )
        self._reader_task = asyncio.create_task(
            self._read_stream(self._proc, parse_armodule=parse_armodule)
        )

    async def _run_tracked(
        self,
        argv: list[str],
        *,
        env: dict[str, str],
        on_line: Any = None,
    ) -> int:
        self._append_log(f"$ {' '.join(argv)}")
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(self.root),
            env=env,
            start_new_session=True,
        )
        self._proc = proc
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            self._append_log(line)
            if on_line is not None:
                await on_line(line)
        code = await proc.wait()
        self._proc = None
        return code

    async def _read_stream(
        self,
        proc: asyncio.subprocess.Process,
        *,
        parse_armodule: bool,
    ) -> None:
        assert proc.stdout is not None
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\n")
                self._append_log(line)
                if parse_armodule:
                    self._parse_armodule_line(line)
        finally:
            code = await proc.wait()
            if self._proc is proc:
                self._proc = None

        if self.status.phase == Phase.STOPPING:
            return
        error = None if code == 0 else f"start.sh exited with code {code}"
        asyncio.create_task(self._finalize_exit(error))

    async def _read_webxr_stream(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stdout is not None
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\n")
                self._append_log(line)
        finally:
            await proc.wait()
            if self._webxr_proc is proc:
                self._webxr_proc = None

        if self.status.phase == Phase.STOPPING:
            return
        self._append_log("WebXR Vite exited — stopping ARModule")
        asyncio.create_task(self._finalize_exit("WebXR Vite exited"))

    async def _finalize_exit(self, error: str | None) -> None:
        async with self._lock:
            if self.status.phase == Phase.STOPPING:
                return
            await self._stop_children_unlocked()
            self._set_status(
                phase=Phase.ERROR if error else (Phase.READY if self.status.check_ok else Phase.IDLE),
                error=error,
                websocket_url=None,
                webxr_url=None,
                webxr_local_url=None,
            )
