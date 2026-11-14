from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any
from uuid import uuid4

from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class EmergencyStopController:
    def __init__(
        self,
        *,
        estop_available: bool,
        effects: Sequence[Callable[[], bool]],
        manipulation: bool = False,
    ) -> None:
        self._estop_available = estop_available
        self._effects = tuple(effects)
        self._manipulation = manipulation
        self._requested = False
        self._native_stopped = False
        self._native_resumable = False
        self._stop_id: str | None = None
        self._resuming = False

    @property
    def stopped(self) -> bool:
        return self._requested or self._native_stopped

    def snapshot(self) -> dict[str, Any]:
        return {
            "stopped": self.stopped,
            "can_resume": self.stopped
            and not self._resuming
            and (not self._manipulation or self._native_resumable),
            **({"stop_id": self._stop_id} if self.stopped else {}),
        }

    def observe_manipulation(self, snapshot: dict[str, Any]) -> None:
        self._manipulation = True
        if snapshot.get("stopped") is True and not self.stopped:
            self._stop_id = uuid4().hex
        if "stopped" in snapshot:
            self._native_stopped = snapshot["stopped"] is True
        protection = snapshot.get("protection") or {}
        self._native_resumable = (
            snapshot.get("available") is True
            and self._native_stopped
            and snapshot.get("stop_confirmed") is True
            and snapshot.get("following") is not True
            and snapshot.get("operation") is None
            and snapshot.get("execution") not in {"accepted", "executing", "uncertain", "fault"}
            and (
                protection.get("state") not in {"paused", "fault"}
                or protection.get("resumable") is True
            )
        )

    def begin_resume(self, stop_id: str) -> bool:
        if stop_id != self._stop_id or self.snapshot()["can_resume"] is not True:
            return False
        self._resuming = True
        return True

    def finish_resume(self, stop_id: str, *, succeeded: bool) -> bool:
        if stop_id != self._stop_id or not self._resuming:
            return False
        self._resuming = False
        if succeeded:
            self._requested = self._native_stopped = self._native_resumable = False
            self._stop_id = None
        return succeeded

    def on_estop_request(self) -> bool:
        if self._estop_available:
            self._requested = True
            self._native_resumable = False
            self._stop_id = uuid4().hex
            self._resuming = False
        return self._run(reason="request")

    def on_last_disconnect(self) -> bool:
        return self._run(reason="last_disconnect")

    def controlled_stop(self) -> bool:
        return self._run(reason="controlled_stop")

    def _run(self, *, reason: str) -> bool:
        if not self._estop_available:
            return False
        logger.info("estop" if reason == "request" else "controlled stop", reason=reason)
        changed = False
        for effect in self._effects:
            if effect():
                changed = True
        return changed
