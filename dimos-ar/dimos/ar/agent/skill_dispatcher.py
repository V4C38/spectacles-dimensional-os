"""ArSkillDispatcher — correlate ar_skill requests with ar_skill_result replies."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import threading
import time
from typing import TYPE_CHECKING, Any
import uuid

from dimos.ar.agent.wire import (
    ArSkillResultMessage,
    encode_ar_skill,
)
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.sender import BridgeSender

logger = setup_logger()


class ArSkillError(Exception):
    """Raised when an AR skill request cannot complete successfully."""


@dataclass
class _PendingRequest:
    event: threading.Event
    result: ArSkillResultMessage | None = None
    error: ArSkillError | None = None
    started_mono: float = 0.0


class ArSkillDispatcher:
    """Owns ar_skill request/response correlation (one owner for this concern).

    ``request()`` is safe to call from DimOS ``@rpc`` / ``@skill`` pool threads.
    It must never run on the WebSocket read loop.
    """

    def __init__(
        self,
        *,
        sender: BridgeSender,
        default_timeout_s: float = 10.0,
    ) -> None:
        self._sender = sender
        self._default_timeout_s = float(default_timeout_s)
        self._connection_count: Callable[[], int] | None = None
        self._lock = threading.Lock()
        self._pending: dict[str, _PendingRequest] = {}

    def bind_connection_count(self, supplier: Callable[[], int]) -> None:
        self._connection_count = supplier

    def request(
        self,
        skill: str,
        args: dict[str, Any] | None = None,
        *,
        timeout_s: float | None = None,
    ) -> ArSkillResultMessage:
        if not skill:
            raise ArSkillError("skill must be non-empty")
        if self._connection_count is None or self._connection_count() <= 0:
            raise ArSkillError("No AR client connected")

        wait_s = self._default_timeout_s if timeout_s is None else float(timeout_s)
        request_id = uuid.uuid4().hex
        pending = _PendingRequest(event=threading.Event(), started_mono=time.monotonic())
        with self._lock:
            self._pending[request_id] = pending

        try:
            self._sender.send(
                encode_ar_skill(request_id=request_id, skill=skill, args=args)
            )
            if not pending.event.wait(timeout=wait_s):
                elapsed_s = time.monotonic() - pending.started_mono
                raise ArSkillError(
                    f"AR skill timed out after {elapsed_s:.1f}s "
                    f"(limit={wait_s:.1f}s): {skill}"
                )
            if pending.error is not None:
                raise pending.error
            result = pending.result
            if result is None:
                raise ArSkillError(f"AR skill returned no result: {skill}")
            elapsed_s = time.monotonic() - pending.started_mono
            logger.info(
                "ar_skill round-trip",
                skill=skill,
                ok=result.ok,
                elapsed_s=round(elapsed_s, 3),
            )
            return result
        finally:
            with self._lock:
                self._pending.pop(request_id, None)

    def cancel_all(self, reason: str) -> int:
        """Fail every pending waiter (estop / disconnect). Returns cancelled count."""
        with self._lock:
            pending_items = list(self._pending.items())
            self._pending.clear()
        for _request_id, pending in pending_items:
            pending.error = ArSkillError(f"AR skill cancelled: {reason}")
            pending.event.set()
        if pending_items:
            logger.info(
                "ar_skill pending cancelled",
                reason=reason,
                count=len(pending_items),
            )
        return len(pending_items)

    def on_ar_skill_result(self, msg: ArSkillResultMessage) -> None:
        with self._lock:
            pending = self._pending.get(msg.request_id)
            if pending is None:
                logger.info(
                    "ar_skill_result dropped (unknown or late request_id)",
                    request_id=msg.request_id,
                    skill=msg.skill,
                    ok=msg.ok,
                )
                return
            pending.result = msg
            pending.event.set()
