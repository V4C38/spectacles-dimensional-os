"""Single worker lane for all adapter motion RPC from ARBridge collaborators."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import queue
import threading
import time
from typing import TYPE_CHECKING, Literal

from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.adapters.base import ARRobotAdapterSpec
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

logger = setup_logger()

CompleteCallback = Callable[[bool, BaseException | None], None]
PriorityCommand = Literal["cancel", "estop"]
_SENTINEL: object = object()


@dataclass
class _BaselineJob:
    vy: float
    on_complete: CompleteCallback | None = None


@dataclass
class _NavJob:
    goal: PoseStamped
    on_complete: CompleteCallback


@dataclass
class _PriorityJob:
    command: PriorityCommand
    on_complete: CompleteCallback | None = None


class AdapterCommandQueue:
    """Serialize adapter motion RPC with managed queue policies."""

    def __init__(self, adapter: ARRobotAdapterSpec) -> None:
        self._adapter = adapter
        self._baseline_queue: queue.Queue[_BaselineJob | object] = queue.Queue()
        self._priority_queue: queue.Queue[_PriorityJob | object] = queue.Queue()
        self._state_lock = threading.Lock()
        self._pending_nav: _NavJob | None = None
        self._shutdown = False
        self._wake = threading.Event()
        self._thread = threading.Thread(
            target=self._worker,
            name="adapter-command-queue",
            daemon=True,
        )
        self._thread.start()

    def submit_baseline_velocity(
        self,
        vy: float,
        *,
        on_complete: CompleteCallback | None = None,
    ) -> None:
        self._baseline_queue.put(_BaselineJob(vy=vy, on_complete=on_complete))
        self._wake.set()

    def submit_nav_goal(
        self,
        goal: PoseStamped,
        *,
        on_complete: CompleteCallback,
    ) -> None:
        with self._state_lock:
            self._pending_nav = _NavJob(goal=goal, on_complete=on_complete)
        self._wake.set()

    def submit_cancel_goal(
        self,
        *,
        on_complete: CompleteCallback | None = None,
    ) -> None:
        self._priority_queue.put(_PriorityJob(command="cancel", on_complete=on_complete))
        self._wake.set()

    def submit_emergency_stop(
        self,
        *,
        on_complete: CompleteCallback | None = None,
    ) -> None:
        self._priority_queue.put(_PriorityJob(command="estop", on_complete=on_complete))
        self._wake.set()

    def clear_pending_baseline(self) -> None:
        while True:
            try:
                self._baseline_queue.get_nowait()
            except queue.Empty:
                break

    def shutdown(self) -> None:
        self._shutdown = True
        try:
            self._baseline_queue.put_nowait(_BaselineJob(vy=0.0))
        except queue.Full:
            pass
        try:
            self._baseline_queue.put_nowait(_SENTINEL)
        except queue.Full:
            pass
        self._wake.set()
        self._thread.join(timeout=2.0)

    def _clear_pending_motion(self) -> None:
        with self._state_lock:
            self._pending_nav = None
        self.clear_pending_baseline()

    def _worker(self) -> None:
        while True:
            if self._process_priority_jobs():
                continue
            if self._process_pending_nav():
                continue
            if self._process_baseline_job():
                continue
            if self._shutdown and self._queues_idle():
                break
            self._wake.wait(timeout=0.1)
            self._wake.clear()

    def _queues_idle(self) -> bool:
        with self._state_lock:
            pending_nav = self._pending_nav is None
        return (
            pending_nav
            and self._baseline_queue.empty()
            and self._priority_queue.empty()
        )

    def _process_priority_jobs(self) -> bool:
        try:
            item = self._priority_queue.get_nowait()
        except queue.Empty:
            return False
        if item is _SENTINEL:
            return False
        job = item
        assert isinstance(job, _PriorityJob)
        self._clear_pending_motion()
        self._dispatch_priority(job)
        return True

    def _process_pending_nav(self) -> bool:
        with self._state_lock:
            if self._pending_nav is None or not self._baseline_queue.empty():
                return False
            job = self._pending_nav
            self._pending_nav = None
        assert job is not None
        self._dispatch_nav(job)
        return True

    def _process_baseline_job(self) -> bool:
        try:
            item = self._baseline_queue.get_nowait()
        except queue.Empty:
            return False
        if item is _SENTINEL:
            return False
        job = item
        assert isinstance(job, _BaselineJob)
        self._dispatch_baseline(job)
        return True

    def _dispatch_baseline(self, job: _BaselineJob) -> None:
        start = time.monotonic()
        ok = True
        err: BaseException | None = None
        try:
            self._adapter.baseline_set_lateral_velocity(job.vy)
        except BaseException as exc:
            ok = False
            err = exc
            logger.exception("baseline_set_lateral_velocity failed", velocity=job.vy)
        self._log_dispatch(
            command="baseline_set_lateral_velocity",
            start=start,
            ok=ok,
            velocity=job.vy,
        )
        self._invoke_complete(job.on_complete, ok, err)

    def _dispatch_nav(self, job: _NavJob) -> None:
        start = time.monotonic()
        ok = True
        err: BaseException | None = None
        try:
            published = self._adapter.send_nav_goal(job.goal)
            if not published:
                ok = False
                err = RuntimeError("adapter rejected goal")
        except BaseException as exc:
            ok = False
            err = exc
            logger.exception("send_nav_goal failed")
        self._log_dispatch(command="send_nav_goal", start=start, ok=ok)
        self._invoke_complete(job.on_complete, ok, err)

    def _dispatch_priority(self, job: _PriorityJob) -> None:
        start = time.monotonic()
        ok = True
        err: BaseException | None = None
        command = job.command
        try:
            if command == "estop":
                self._adapter.emergency_stop()
            else:
                result = self._adapter.cancel_goal()
                if result is False:
                    ok = False
                    err = RuntimeError("adapter rejected cancel_goal")
        except BaseException as exc:
            ok = False
            err = exc
            logger.exception("adapter priority command failed", command=command)
        rpc_name = "emergency_stop" if command == "estop" else "cancel_goal"
        self._log_dispatch(command=rpc_name, start=start, ok=ok)
        self._invoke_complete(job.on_complete, ok, err)

    def _log_dispatch(self, *, command: str, start: float, ok: bool, **extra: object) -> None:
        logger.info(
            "adapter command queue dispatch",
            command=command,
            latency_ms=round((time.monotonic() - start) * 1000.0, 1),
            ok=ok,
            **extra,
        )

    @staticmethod
    def _invoke_complete(
        callback: CompleteCallback | None,
        ok: bool,
        err: BaseException | None,
    ) -> None:
        if callback is None:
            return
        try:
            callback(ok, err)
        except Exception:
            logger.exception("adapter command queue callback failed")
