#!/usr/bin/env python3
"""Temporary macOS idle-display/sleep guard; never changes security preferences.

This prevents automatic idle locking while work runs. It cannot unlock an existing,
manual, or MDM-enforced lock. Each context/lease owns its own bounded assertion.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import uuid

DEFAULT_TIMEOUT = 4 * 60 * 60
LEASE_ROOT = Path(__file__).resolve().parents[3] / "Review Data" / "ls-awake"


def _timeout(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 86400:
        raise ValueError("timeout must be between 1 and 86400 seconds")
    return value


class KeepAwake:
    """Own renewable caffeinate assertions for the entire context lifetime.

    caffeinate watches this Python PID, so a crashed runner releases its assertions.
    The explicit -t also bounds the user-active assertion (otherwise only 5 seconds).
    """

    def __init__(self, timeout: int = DEFAULT_TIMEOUT) -> None:
        self.timeout = _timeout(timeout)
        self.process: subprocess.Popen | None = None
        self._stop = threading.Event()
        self._renewal: threading.Thread | None = None
        self._renewal_error: Exception | None = None

    def __enter__(self) -> KeepAwake:
        if self.process is not None:
            raise RuntimeError("KeepAwake instance is already active")
        if sys.platform == "darwin":
            self._stop.clear()
            self._renewal_error = None
            try:
                self.process = self._launch()
                self._renewal = threading.Thread(target=self._renew, daemon=True)
                self._renewal.start()
            except BaseException:
                process, self.process = self.process, None
                self._renewal = None
                self._release(process)
                raise
        return self

    def _launch(self) -> subprocess.Popen:
        process = subprocess.Popen([
            "/usr/bin/caffeinate", "-d", "-i", "-u", "-t", str(self.timeout),
            "-w", str(os.getpid()),
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(0.05)
            if process.poll() is not None:
                process.wait()
                raise RuntimeError("caffeinate failed to start")
            return process
        except BaseException:
            self._release(process)
            raise

    @staticmethod
    def _release(process: subprocess.Popen | None) -> None:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def _renew(self) -> None:
        # Start replacement before releasing the old assertion, including UserIsActive.
        while not self._stop.wait(self.timeout * 0.75):
            previous = self.process
            try:
                self.process = self._launch()
            except Exception as error:
                self._renewal_error = error
                return
            self._release(previous)

    def __exit__(self, error_type: object, *_: object) -> None:
        self._stop.set()
        if self._renewal is not None:
            self._renewal.join()
            self._renewal = None
        process, self.process = self.process, None
        self._release(process)
        if self._renewal_error is not None and error_type is None:
            raise RuntimeError("idle-lock guard renewal failed") from self._renewal_error


def _identity(pid: int) -> str | None:
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 1:
        raise ValueError("owner PID must be an integer greater than 1")
    result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart=", "-o", "command="],
                            capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def _path(lease: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", lease):
        raise ValueError("lease must contain 1–80 letters, digits, underscores or hyphens")
    return LEASE_ROOT / f"{lease}.json"


def _read(path: Path) -> dict:
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or set(data) != {"pid", "identity", "token", "owner_pid", "owner_identity", "timeout"}:
        raise ValueError("malformed lease")
    for field in ("pid", "owner_pid"):
        if type(data[field]) is not int or data[field] <= 1:
            raise ValueError("malformed lease PID")
    if not all(isinstance(data[k], str) and data[k] for k in ("identity", "owner_identity")):
        raise ValueError("malformed lease identity")
    if not isinstance(data["token"], str) or not re.fullmatch(r"[0-9a-f]{32}", data["token"]):
        raise ValueError("malformed lease token")
    _timeout(data["timeout"])
    return data


def _running(data: dict) -> bool:
    identity = _identity(data["pid"])
    return (identity == data["identity"] and identity is not None
            and str(Path(__file__).resolve()) in identity
            and "_worker" in identity and data["token"] in identity)


def start(lease: str, owner_pid: int, timeout: int = DEFAULT_TIMEOUT) -> dict:
    if sys.platform != "darwin":
        raise RuntimeError("detached idle-lock guards require macOS")
    timeout = _timeout(timeout)
    path = _path(lease)
    owner_identity = _identity(owner_pid)
    if not owner_identity:
        raise ValueError("owner process is not running")
    path.parent.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    # Exclusive creation prevents concurrent starts from replacing another task's guard.
    with path.open("x") as output:
        json.dump({"starting": token}, output)
    worker = None
    try:
        worker = subprocess.Popen([
            sys.executable, str(Path(__file__).resolve()), "_worker", lease,
            "--owner-pid", str(owner_pid), "--timeout", str(timeout), "--token", token,
            "--owner-identity", owner_identity,
        ], start_new_session=True, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if worker.poll() is not None:
                raise RuntimeError("idle-lock guard failed to start")
            try:
                data = _read(path)
                if data["token"] == token and _running(data):
                    return data
            except (ValueError, FileNotFoundError):
                pass
            time.sleep(0.05)
        raise RuntimeError("idle-lock guard startup timed out")
    except BaseException:
        if worker is not None and worker.poll() is None:
            worker.terminate()
            worker.wait(timeout=5)
        path.unlink(missing_ok=True)
        raise


def stop(lease: str) -> bool:
    path = _path(lease)
    if not path.exists():
        return False
    data = _read(path)
    if _running(data):
        os.kill(data["pid"], signal.SIGTERM)
        for _ in range(100):
            if not path.exists() or not _running(data):
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("idle-lock guard did not stop")
    # Never signal a PID whose recorded identity has changed.
    path.unlink(missing_ok=True)
    return True


def _worker(args: argparse.Namespace) -> None:
    path = _path(args.lease)
    if _identity(args.owner_pid) != args.owner_identity:
        raise ValueError("owner process identity changed")
    stopped = False

    def shutdown(_signum: int, _frame: object) -> None:
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        with KeepAwake(args.timeout) as guard:
            # Verify caffeinate survived startup before reporting the lease ready.
            time.sleep(0.05)
            if guard.process is None or guard.process.poll() is not None:
                raise RuntimeError("caffeinate failed to start")
            identity = _identity(os.getpid())
            assert identity is not None
            data = dict(pid=os.getpid(), identity=identity, token=args.token,
                        owner_pid=args.owner_pid, owner_identity=args.owner_identity,
                        timeout=args.timeout)
            temporary = path.with_suffix(f".{args.token}.tmp")
            temporary.write_text(json.dumps(data))
            temporary.replace(path)
            deadline = time.monotonic() + args.timeout
            while (not stopped and time.monotonic() < deadline
                   and _identity(args.owner_pid) == args.owner_identity
                   and guard.process.poll() is None):
                time.sleep(0.25)
    finally:
        with contextlib.suppress(ValueError, FileNotFoundError):
            if _read(path)["token"] == args.token:
                path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "status", "_worker"])
    parser.add_argument("lease", nargs="?")
    parser.add_argument("--owner-pid", type=int)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--token", help=argparse.SUPPRESS)
    parser.add_argument("--owner-identity", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.action == "status":
            paths = [_path(args.lease)] if args.lease else sorted(LEASE_ROOT.glob("*.json"))
            print(json.dumps({p.stem: _running(_read(p)) for p in paths if p.exists()}))
        elif not args.lease:
            parser.error("lease is required")
        elif args.action == "stop":
            print(json.dumps({"stopped": stop(args.lease)}))
        elif args.owner_pid is None:
            parser.error("--owner-pid is required")
        elif args.action == "start":
            print(json.dumps(start(args.lease, args.owner_pid, args.timeout)))
        else:
            if not args.token or not args.owner_identity:
                parser.error("worker identity is required")
            _worker(args)
    except (ValueError, RuntimeError, OSError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
