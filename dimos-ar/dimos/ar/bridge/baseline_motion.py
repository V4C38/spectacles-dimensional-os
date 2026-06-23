"""Serialized fire-and-forget baseline velocity command executor."""

from __future__ import annotations

import queue
import threading
from typing import TYPE_CHECKING

from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.adapters.base import ARRobotAdapterSpec

logger = setup_logger()

_SENTINEL: object = object()


class BaselineMotionExecutor:
    """Single-thread executor for ordered ``baseline_set_lateral_velocity`` calls."""

    def __init__(self, adapter: ARRobotAdapterSpec) -> None:
        self._adapter = adapter
        self._queue: queue.Queue[float | object] = queue.Queue(maxsize=32)
        self._thread = threading.Thread(
            target=self._worker,
            name="baseline-motion-executor",
            daemon=True,
        )
        self._thread.start()

    def submit_lateral_velocity(self, vy: float) -> None:
        try:
            self._queue.put_nowait(vy)
        except queue.Full:
            logger.warning(
                "baseline motion queue full; dropping velocity command",
                velocity=vy,
            )

    def stop_motion(self) -> None:
        """Enqueue zero velocity so the worker stops the robot in order."""
        try:
            self._queue.put_nowait(0.0)
        except queue.Full:
            logger.warning("baseline motion queue full; stop command dropped")

    def shutdown(self) -> None:
        try:
            self._queue.put_nowait(_SENTINEL)
        except queue.Full:
            pass

    def _worker(self) -> None:
        while True:
            item = self._queue.get()
            try:
                if item is _SENTINEL:
                    break
                vy = float(item)
                self._adapter.baseline_set_lateral_velocity(vy)
            except Exception:
                logger.exception("baseline_set_lateral_velocity failed")
            finally:
                self._queue.task_done()
