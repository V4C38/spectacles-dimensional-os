"""Optional native-agent admission contract and a testable turn gate."""

from __future__ import annotations

from collections.abc import Callable
import threading
from typing import Any, Protocol

from dimos.spec.utils import Spec


class ARAgentControlSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_agent_set_manual(self, manual: bool) -> bool: ...


class ARFollowingQuiescenceSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_following_quiescent(self) -> bool: ...


class AgentTurnGate:
    """Serialize mode admission with the native lock held throughout a turn.

    Pausing only succeeds between turns. Queued continuations stay queued until
    agent mode resumes; an idle notification alone never proves motion stopped.
    """

    def __init__(self, turn_lock: Any) -> None:
        self._turn_lock = turn_lock
        self._enabled = threading.Event()

    @property
    def manual(self) -> bool:
        return not self._enabled.is_set()

    def wait_enabled(self, timeout: float) -> bool:
        return self._enabled.wait(timeout)

    def run_turn(self, callback: Callable[[], None]) -> bool:
        with self._turn_lock:
            if self.manual:
                return False
            callback()
            return True

    def set_manual(self, manual: bool, quiescent: Callable[[], bool]) -> bool:
        if not self._turn_lock.acquire(blocking=False):
            return False
        try:
            if not manual:
                if not quiescent():
                    return False
                self._enabled.set()
                return True
            was_enabled = self._enabled.is_set()
            self._enabled.clear()
            accepted = False
            try:
                accepted = quiescent()
                return accepted
            finally:
                if not accepted and was_enabled:
                    self._enabled.set()
        finally:
            self._turn_lock.release()
