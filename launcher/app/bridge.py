"""Child-process manager for setup.sh / start.sh with SSE log fan-out."""

from __future__ import annotations

import asyncio
import os
import re
import shlex
import signal
import socket
import sys
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from config import merge_env, read_env, repo_root, scripts_dir
from tag_config import mounts_env_json

BRIDGE_PORT = 8787
LOG_BUFFER_SIZE = 500
STOP_GRACE_SECONDS = 8.0

_RE_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_RE_BRIDGE_READY = re.compile(r"Bridge ready\s+[—\-]\s+(ws://\S+)", re.IGNORECASE)
_RE_WEBSOCKET_BANNER = re.compile(r"WebSocket:\s+(ws://\S+)", re.IGNORECASE)
_RE_WEBSOCKET_STARTED = re.compile(r"websocket=(ws://\S+)", re.IGNORECASE)
_RE_SPECTACLES = re.compile(r"Spectacles:\s+enter\s+(\S+)", re.IGNORECASE)
_RE_ROBOT_IP = re.compile(r"Robot IP:\s+(\S+)", re.IGNORECASE)
_RE_CHECK_OK = re.compile(r"^CHECK_OK=([01])\s*$")
_RE_CHECK_OK_GO2 = re.compile(r"^CHECK_OK_GO2=([01])\s*$")
_RE_CHECK_OK_G1 = re.compile(r"^CHECK_OK_G1=([01])\s*$")
_RE_DIMOS_PYTHON = re.compile(r"^DIMOS_PYTHON=(.+)$")


def _strip_ansi(text: str) -> str:
    return _RE_ANSI.sub("", text)


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
class BridgeStatus:
    phase: Phase = Phase.IDLE
    check_ok: bool | None = None
    ready_go2: bool | None = None
    ready_g1: bool | None = None
    dimos_python: str | None = None
    websocket_url: str | None = None
    spectacles_ip: str | None = None
    robot_ip: str | None = None
    warning: str | None = None
    stack: str | None = None
    error: str | None = None


@dataclass
class _Subscriber:
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=asyncio.Queue)


class ProcessManager:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or repo_root()
        self.scripts = scripts_dir(self.root)
        self.status = BridgeStatus()
        self._log: deque[str] = deque(maxlen=LOG_BUFFER_SIZE)
        self._subs: list[_Subscriber] = []
        self._proc: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._check_started = False

    def snapshot(self) -> dict[str, Any]:
        return {
            "phase": self.status.phase.value,
            "check_ok": self.status.check_ok,
            "ready_go2": self.status.ready_go2,
            "ready_g1": self.status.ready_g1,
            "dimos_python": self.status.dimos_python,
            "websocket_url": self.status.websocket_url,
            "spectacles_ip": self.status.spectacles_ip,
            "robot_ip": self.status.robot_ip,
            "warning": self.status.warning,
            "stack": self.status.stack,
            "error": self.status.error,
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
            sub.queue.put_nowait(event)

    def _append_log(self, line: str) -> None:
        self._log.append(line)
        self._emit({"type": "log", "line": line})

    def _set_status(self, **kwargs: Any) -> None:
        for key, value in kwargs.items():
            setattr(self.status, key, value)
        self._emit({"type": "status", **self.snapshot()})

    def _parse_bridge_line(self, line: str) -> None:
        plain = _strip_ansi(line)
        if m := _RE_BRIDGE_READY.search(plain):
            self._set_status(websocket_url=m.group(1), phase=Phase.RUNNING, error=None)
            return
        if m := _RE_WEBSOCKET_BANNER.search(plain):
            # start.sh prints the bind URL before the server is listening.
            self._set_status(websocket_url=m.group(1))
            return
        if m := _RE_WEBSOCKET_STARTED.search(plain):
            self._set_status(websocket_url=m.group(1), phase=Phase.RUNNING, error=None)
            return
        if m := _RE_SPECTACLES.search(plain):
            self._set_status(spectacles_ip=m.group(1))
            return
        if m := _RE_ROBOT_IP.search(plain):
            self._set_status(robot_ip=m.group(1))
            return
        if "OPENAI_API_KEY is unset" in plain:
            self._set_status(warning="OPENAI_API_KEY is unset — agent mode will not work")

    def port_in_use(self, port: int = BRIDGE_PORT) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.3)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    async def _pids_listening(self, port: int = BRIDGE_PORT) -> list[int]:
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

    async def _kill_port_listeners(self, port: int = BRIDGE_PORT) -> bool:
        """Kill any process listening on ``port``. Returns True if something was targeted."""
        pids = await self._pids_listening(port)
        if not pids:
            return False
        self._append_log(
            f"Stopping other bridge process(es) on port {port}: "
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
        stack: str,
        robot_ip: str | None = None,
    ) -> list[str]:
        if stack not in ("go2", "g1"):
            raise ValueError("stack must be 'go2' or 'g1'")
        argv = [str(self.scripts / "start.sh"), "--stack", stack]
        if robot_ip:
            argv.extend(["--robot-ip", robot_ip])
        return argv

    def build_setup_argv(
        self,
        *,
        stack: str = "go2",
        dimos_python: str | None = None,
        clone_dir: str | None = None,
    ) -> list[str]:
        if stack not in ("go2", "g1"):
            raise ValueError("stack must be 'go2' or 'g1'")
        argv = [str(self.scripts / "setup.sh"), "--yes", "--stack", stack]
        if dimos_python and clone_dir:
            raise ValueError("provide either dimos_python or clone_dir, not both")
        if dimos_python:
            argv.extend(["--dimos-python", dimos_python])
        elif clone_dir:
            argv.extend(["--clone-dir", clone_dir])
        return argv

    async def ensure_check(self) -> None:
        if self._check_started:
            return
        self._check_started = True
        await self.run_check()

    async def run_check(self) -> dict[str, Any]:
        async with self._lock:
            if self._proc is not None:
                raise RuntimeError("another process is already running")
            self._set_status(
                phase=Phase.CHECKING,
                check_ok=None,
                ready_go2=None,
                ready_g1=None,
                error=None,
                warning=None,
            )
            argv = [str(self.scripts / "setup.sh"), "--check"]
            check_ok = False
            ready_go2 = False
            ready_g1 = False
            saw_go2 = False
            saw_g1 = False
            dimos_python: str | None = None

            async def on_line(line: str) -> None:
                nonlocal check_ok, ready_go2, ready_g1, saw_go2, saw_g1, dimos_python
                plain = _strip_ansi(line)
                if m := _RE_CHECK_OK_GO2.match(plain):
                    ready_go2 = m.group(1) == "1"
                    saw_go2 = True
                elif m := _RE_CHECK_OK_G1.match(plain):
                    ready_g1 = m.group(1) == "1"
                    saw_g1 = True
                elif m := _RE_CHECK_OK.match(plain):
                    check_ok = m.group(1) == "1"
                elif m := _RE_DIMOS_PYTHON.match(plain):
                    raw = m.group(1).strip()
                    try:
                        dimos_python = str(Path(raw).resolve())
                    except OSError:
                        dimos_python = raw

            env = os.environ.copy()
            # Force ANSI colors into the SSE log (stdout is a pipe, not a TTY).
            env["DIMOS_AR_FORCE_COLOR"] = "1"
            code = await self._run_tracked(argv, env=env, on_line=on_line)
            # Prefer per-stack flags; fall back to legacy CHECK_OK for Go2.
            if not saw_go2:
                ready_go2 = check_ok
            if not saw_g1:
                ready_g1 = False
            check_ok = ready_go2

            if ready_go2 or ready_g1:
                self._set_status(
                    phase=Phase.READY,
                    check_ok=check_ok,
                    ready_go2=ready_go2,
                    ready_g1=ready_g1,
                    dimos_python=dimos_python,
                    error=None,
                )
            elif code == 0 and check_ok:
                self._set_status(
                    phase=Phase.READY,
                    check_ok=True,
                    ready_go2=True,
                    ready_g1=ready_g1,
                    dimos_python=dimos_python,
                    error=None,
                )
            else:
                # No DimOS / dimos-ar at all — still READY for UI (tabs stay
                # visible); per-stack flags gate Start + install banner.
                self._set_status(
                    phase=Phase.NEEDS_SETUP if not ready_go2 and not ready_g1 else Phase.READY,
                    check_ok=False,
                    ready_go2=False,
                    ready_g1=False,
                    dimos_python=dimos_python,
                    error=None,
                )
            return self.snapshot()

    async def run_setup(
        self,
        *,
        stack: str = "go2",
        dimos_python: str | None = None,
        clone_dir: str | None = None,
    ) -> None:
        async with self._lock:
            if self._proc is not None:
                raise RuntimeError("another process is already running")
            argv = self.build_setup_argv(
                stack=stack,
                dimos_python=dimos_python,
                clone_dir=clone_dir,
            )
            self._append_log(f"Installing {stack} dependencies…")
            self._set_status(phase=Phase.INSTALLING, stack=stack, error=None)
            env = os.environ.copy()
            env["DIMOS_AR_FORCE_COLOR"] = "1"
            code = await self._run_tracked(argv, env=env)
            if code != 0:
                # Keep the real failure reason in the log only — do not put a
                # generic exit-code string into status.error for the status card.
                self._set_status(
                    phase=Phase.NEEDS_SETUP,
                    check_ok=False,
                    error=None,
                )
                raise RuntimeError(f"setup.sh exited with code {code}")

        # Re-check after install (outside lock held by run_check's own lock)
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
            return  # already configured

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
                "Approve the administrator prompt to start the bridge."
            )

    async def start_bridge(
        self,
        *,
        stack: str,
        robot_ip: str | None = None,
        openai_api_key: str | None = None,
    ) -> None:
        async with self._lock:
            if self._proc is not None:
                raise RuntimeError("bridge is already running")
            if self.port_in_use():
                raise RuntimeError(
                    f"port {BRIDGE_PORT} is already in use — stop the other bridge first"
                )
            if stack == "g1" and self.status.ready_g1 is False:
                raise RuntimeError(
                    "G1 dependencies are not installed — use Install G1 dependencies first"
                )
            if stack == "go2" and self.status.ready_go2 is False:
                raise RuntimeError(
                    "Go2 dependencies are not installed — use Install Go2 dependencies first"
                )

            await self._configure_system_if_needed()

            updates: dict[str, str | None] = {}
            if openai_api_key is not None:
                key = openai_api_key.strip()
                updates["OPENAI_API_KEY"] = key if key else None
            # Persist ROBOT_IP only when pinned; clear otherwise so DimOS .env
            # read cannot override discovery. Keep user-facing "simulated";
            # start.sh maps simulated|fake → DimOS offline replay.
            pinned_ip = robot_ip.strip() if robot_ip else None
            if pinned_ip in ("simulated", "fake"):
                pinned_ip = "simulated"
            updates["ROBOT_IP"] = pinned_ip
            if updates:
                merge_env(updates, self.root / ".env")

            env = os.environ.copy()
            # System config already applied above via the native admin prompt;
            # tell start.sh not to attempt its own sudo step.
            env["DIMOS_AR_SKIP_SYSCONFIG"] = "1"
            # Ambient ROBOT_IP must not skip discovery; pin via --robot-ip only.
            env.pop("ROBOT_IP", None)
            # Force ANSI colors into the SSE log (stdout is a pipe, not a TTY).
            env["DIMOS_AR_FORCE_COLOR"] = "1"
            env["DIMOS_AR_TAG_MOUNTS"] = mounts_env_json(stack, self.root)
            stored = read_env(self.root / ".env")
            if stored.get("OPENAI_API_KEY"):
                env["OPENAI_API_KEY"] = stored["OPENAI_API_KEY"]
            if openai_api_key is not None and openai_api_key.strip():
                env["OPENAI_API_KEY"] = openai_api_key.strip()

            argv = self.build_start_argv(
                stack=stack,
                robot_ip=pinned_ip,
            )
            self._set_status(
                phase=Phase.STARTING,
                stack=stack,
                websocket_url=None,
                spectacles_ip=None,
                robot_ip=pinned_ip,
                warning=None,
                error=None,
            )
            self._append_log(f"$ {' '.join(argv)}")
            await self._spawn(argv, env=env, parse_bridge=True)

    async def stop_bridge(self) -> None:
        async with self._lock:
            proc = self._proc
            stopped_managed = False
            if proc is not None and proc.returncode is None:
                self._set_status(phase=Phase.STOPPING)
                self._append_log("Stopping bridge (SIGINT)…")
                try:
                    os.killpg(proc.pid, signal.SIGINT)
                except ProcessLookupError:
                    pass

                try:
                    await asyncio.wait_for(proc.wait(), timeout=STOP_GRACE_SECONDS)
                except asyncio.TimeoutError:
                    self._append_log("Bridge did not stop in time — sending SIGKILL")
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    await proc.wait()
                stopped_managed = True
            self._proc = None

            if self._reader_task and not self._reader_task.done():
                self._reader_task.cancel()
                try:
                    await self._reader_task
                except asyncio.CancelledError:
                    pass
            self._reader_task = None

            # Also free port 8787 when idle Stop is used against an external bridge.
            freed_port = await self._kill_port_listeners(BRIDGE_PORT)
            if stopped_managed:
                self._append_log("Bridge stopped.")
            elif not freed_port:
                self._append_log(f"No bridge process on port {BRIDGE_PORT}.")

            if (
                stopped_managed
                or freed_port
                or self.status.phase in (Phase.RUNNING, Phase.STARTING, Phase.STOPPING)
            ):
                self._set_status(
                    phase=Phase.READY if self.status.check_ok else Phase.IDLE,
                    websocket_url=None,
                )

    async def _spawn(
        self,
        argv: list[str],
        *,
        env: dict[str, str],
        parse_bridge: bool,
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
            self._read_stream(self._proc, parse_bridge=parse_bridge)
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
        parse_bridge: bool,
    ) -> None:
        assert proc.stdout is not None
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\n")
                self._append_log(line)
                if parse_bridge:
                    self._parse_bridge_line(line)
        finally:
            code = await proc.wait()
            if self._proc is proc:
                self._proc = None

        if self.status.phase == Phase.STOPPING:
            return
        if code == 0:
            self._set_status(
                phase=Phase.READY if self.status.check_ok else Phase.IDLE,
                websocket_url=None,
            )
        else:
            self._set_status(
                phase=Phase.ERROR,
                error=f"start.sh exited with code {code}",
                websocket_url=None,
            )
