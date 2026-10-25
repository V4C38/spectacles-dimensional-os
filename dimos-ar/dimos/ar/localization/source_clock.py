from __future__ import annotations

import math


class RobotSourceClock:
    """Explicit clock contract for installed live and one-times-speed replay sources.

    Live Go2 WebRTC already publishes host-clock receipt times; never estimate a
    new offset from each arrival. Known replay sources retain recorded timestamps,
    so bind one common epoch from the first odometry arrival and preserve all
    inter-stream timing. This is replay scheduling, not exposure-time recovery.
    """

    def __init__(self, *, recording: bool = False) -> None:
        self._recording = recording
        self._offset: float | None = None if recording else 0.0

    def odometry_time(self, timestamp: float, *, received_at: float) -> float | None:
        if not math.isfinite(timestamp) or not math.isfinite(received_at):
            return None
        if self._offset is None:
            self._offset = received_at - timestamp
        return self.to_server(timestamp)

    def to_server(self, timestamp: float) -> float | None:
        if self._offset is None or not math.isfinite(timestamp):
            return None
        result = timestamp + self._offset
        return result if math.isfinite(result) else None
