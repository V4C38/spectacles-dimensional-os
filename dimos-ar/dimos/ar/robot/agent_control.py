"""Optional native-agent admission contract and a testable turn gate."""

from __future__ import annotations

from collections.abc import Callable
import threading
from typing import Any, Protocol, TypeVar

from dimos.navigation.base import NavigationState
from dimos.spec.utils import Spec

_T = TypeVar("_T")

class ARAgentControlSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_agent_set_manual(self, manual: bool) -> bool: ...
    def ar_agent_takeover(self) -> bool: ...


class ARAgentNavigationSpec(Spec, Protocol):  # type: ignore[misc]
    def get_state(self) -> NavigationState: ...
    def ar_navigation_agent_manual(self, manual: bool, generation: int) -> bool: ...


class ARFollowingQuiescenceSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_following_quiescent(self) -> bool: ...
    def ar_following_set_manual(self, manual: bool, generation: int) -> bool: ...


class AgentTurnGate:
    """Serialize mode admission with the native lock held throughout a turn.

    Pausing only succeeds between turns. Queued continuations stay queued until
    agent mode resumes; an idle notification alone never proves motion stopped.
    """

    def __init__(self, turn_lock: Any) -> None:
        self._turn_lock = turn_lock
        self._enabled = threading.Event()
        self._state_lock = threading.Lock()
        self._generation = 0
        self._effects = 0

    @property
    def generation(self) -> int:
        with self._state_lock:
            return self._generation

    def accepts(self, generation: int) -> bool:
        with self._state_lock:
            return self._enabled.is_set() and generation == self._generation

    def same_generation(self, generation: int) -> bool:
        with self._state_lock:
            return generation == self._generation

    @property
    def effects_quiescent(self) -> bool:
        with self._state_lock:
            return self._effects == 0

    def retire(self) -> int:
        # This latch does not wait behind an LLM's turn lock.
        with self._state_lock:
            self._enabled.clear()
            self._generation += 1
            return self._generation

    def publish(self, generation: int, callback: Callable[[], None]) -> bool:
        """Publish one small queue fact atomically with generation retirement."""
        with self._state_lock:
            if not self._enabled.is_set() or generation != self._generation:
                return False
            callback()
            return True

    def run_effect(self, generation: int, callback: Callable[[], _T]) -> _T:
        with self._state_lock:
            if not self._enabled.is_set() or generation != self._generation:
                raise RuntimeError("Agent action was retired by manual control")
            self._effects += 1
        try:
            result = callback()
            if not self.accepts(generation):
                raise RuntimeError("Agent action was retired by manual control")
            return result
        finally:
            with self._state_lock:
                self._effects -= 1

    @property
    def manual(self) -> bool:
        return not self._enabled.is_set()

    def wait_enabled(self, timeout: float) -> bool:
        return self._enabled.wait(timeout)

    def run_turn(self, callback: Callable[[], None], generation: int | None = None) -> bool:
        with self._turn_lock:
            if self.manual or (generation is not None and not self.accepts(generation)):
                return False
            callback()
            return True

    def set_manual(self, manual: bool, quiescent: Callable[[], bool]) -> bool:
        if not self._turn_lock.acquire(blocking=False):
            return False
        try:
            if not manual:
                with self._state_lock:
                    if self._effects:
                        return False
                    generation = self._generation
                if not quiescent():
                    return False
                with self._state_lock:
                    if generation != self._generation:
                        return False
                    self._enabled.set()
                    return True
            with self._state_lock:
                generation = self._generation
                was_enabled = self._enabled.is_set()
                self._enabled.clear()
            accepted = False
            try:
                accepted = quiescent()
                return accepted
            finally:
                with self._state_lock:
                    if not accepted and was_enabled and generation == self._generation:
                        self._enabled.set()
        finally:
            self._turn_lock.release()
