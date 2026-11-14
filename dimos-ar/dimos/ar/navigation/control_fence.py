"""Thread-safe control-plane admission independent of the native planner lock."""
from __future__ import annotations

from collections import deque
from collections.abc import Callable
import math
import threading
import time


class NavigationControlFence:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._epoch: str | None = None
        self._retired: deque[str] = deque(maxlen=64)
        self._revision = -1
        self._deadline = float('-inf')
        self._generation = 0
        self._ready = True
        self._goal_stamp: float | None = None
        self._expired = False
        self._needs_stop = False
        self._agent_manual = False
        self._agent_mode_generation = -1
        self._agent_stop_ack_required = False

    def heartbeat(self, epoch: str, revision: int, deadline: float) -> bool:
        if (not isinstance(epoch, str) or not epoch
                or isinstance(revision, bool) or not isinstance(revision, int) or revision < 0
                or isinstance(deadline, bool) or not isinstance(deadline, (float, int))
                or not math.isfinite(deadline) or deadline <= self._clock()):
            return False
        with self._lock:
            if epoch in self._retired:
                return False
            if self._epoch is not None and self._clock() >= self._deadline and not self._expired:
                self._expired = True
                self._ready = False
                self._generation += 1
                self._needs_stop = True
            if epoch != self._epoch:
                if self._epoch is not None:
                    self._retired.append(self._epoch)
                    self._generation += 1
                    self._ready = False
                    self._needs_stop = True
                self._epoch, self._revision = epoch, -1
            self._deadline = max(self._deadline, deadline)
            # Heartbeats never restart an expired or superseded goal.
            return True

    def admit(self, epoch: str, revision: int, deadline: float, stamp: float) -> int | None:
        if not math.isfinite(stamp) or not self.heartbeat(epoch, revision, deadline):
            return None
        with self._lock:
            if self._epoch != epoch or revision < self._revision:
                return None
            self._revision = revision
            self._generation += 1
            self._goal_stamp = stamp
            self._ready = False
            self._expired = False
            self._needs_stop = False
            return self._generation

    def current(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation and (self._epoch is None or self._clock() < self._deadline)

    def activate(self, generation: int) -> bool:
        with self._lock:
            if generation != self._generation or (self._epoch is not None and self._clock() >= self._deadline):
                return False
            self._ready = True
            return True

    def allowed(self) -> bool:
        with self._lock:
            return self._ready and (self._epoch is None or self._clock() < self._deadline)

    def publish(self, callback: Callable[[bool], None]) -> None:
        with self._lock:
            callback(self._ready and (self._epoch is None or self._clock() < self._deadline))

    def expire(self) -> tuple[int, float | None] | None:
        with self._lock:
            if self._needs_stop:
                self._needs_stop = False
                return self._generation, self._goal_stamp
            if self._epoch is None or self._clock() < self._deadline or self._expired:
                return None
            self._expired = True
            self._ready = False
            self._generation += 1
            return self._generation, self._goal_stamp

    def same_generation(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation

    def retire_generation(self, generation: int) -> None:
        with self._lock:
            if generation == self._generation:
                self._generation += 1
                self._ready = False

    def halt(self) -> None:
        with self._lock:
            self._generation += 1
            self._ready = False

    def set_agent_manual(self, manual: bool, generation: int | None = None) -> bool:
        with self._lock:
            if generation is not None:
                if type(generation) is not int or generation < self._agent_mode_generation:
                    return False
                if not manual and self._agent_stop_ack_required:
                    return False
                self._agent_mode_generation = generation
            elif not manual:
                return False
            self._agent_manual = manual
            if manual:
                self._agent_stop_ack_required = generation is None
                self._generation += 1
                self._ready = False
                self._needs_stop = True
            return True

    def admit_native_agent(self) -> int | None:
        with self._lock:
            if self._agent_manual or (self._epoch is not None and self._clock() >= self._deadline):
                return None
            self._generation += 1
            self._goal_stamp = None
            self._expired = False
            self._needs_stop = False
            self._ready = False
            return self._generation
