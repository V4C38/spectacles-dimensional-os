"""OdomBuffer — thread-safe odometry ring buffer with monotonic-clock lookup.

Uses ``time.monotonic()`` rather than wall clock so frame-reception latency
compensation stays accurate across sleep/wake cycles. Cannot be replaced by
DimOS TBuffer which uses wall-clock ``Transform.ts``.
"""

from __future__ import annotations

from collections import deque
import math
import threading
import time
from typing import TYPE_CHECKING

from dimos_xr.tracking.transforms import Calibration, OdomSample

if TYPE_CHECKING:
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

ODOM_BUFFER_MAXLEN = 600
ODOM_LOOKUP_MAX_GAP_S = 0.25


class OdomBuffer:
    """Thread-safe odometry ring buffer with monotonic-clock nearest-neighbour lookup."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest: OdomSample | None = None
        self._buffer: deque[tuple[float, OdomSample]] = deque(maxlen=ODOM_BUFFER_MAXLEN)

    def sample(self, msg: PoseStamped) -> OdomSample:
        """Build an OdomSample from a PoseStamped (normalises quaternion)."""
        q = msg.orientation
        norm = math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
        if norm < 1e-12:
            orientation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)
        else:
            orientation = (q.x / norm, q.y / norm, q.z / norm, q.w / norm)
        return OdomSample(
            position=(msg.x, msg.y, msg.z),
            orientation=orientation,
        )

    def update(self, msg: PoseStamped) -> OdomSample:
        """Sample from msg, store as latest, and append to the ring buffer."""
        s = self.sample(msg)
        mono = time.monotonic()
        with self._lock:
            self._latest = s
            self._buffer.append((mono, s))
        return s

    def latest(self) -> OdomSample | None:
        with self._lock:
            return self._latest

    def latest_mono(self) -> float | None:
        """Return the monotonic timestamp of the most recent odom sample, or None."""
        with self._lock:
            if self._buffer:
                return self._buffer[-1][0]
            return None

    def at(self, mono_ts: float) -> OdomSample | None:
        """Return the sample closest to ``mono_ts`` within ``ODOM_LOOKUP_MAX_GAP_S``."""
        with self._lock:
            if not self._buffer:
                return self._latest
            best: tuple[float, OdomSample] | None = None
            best_gap = float("inf")
            for ts, sample in self._buffer:
                gap = abs(ts - mono_ts)
                if gap < best_gap:
                    best_gap = gap
                    best = (ts, sample)
            if best is None or best_gap > ODOM_LOOKUP_MAX_GAP_S:
                return None
            return best[1]

    def at_or_latest(self, mono_ts: float) -> OdomSample | None:
        """Like ``at`` but falls back to the most-recent sample when no buffered
        sample is within ``ODOM_LOOKUP_MAX_GAP_S``.

        Use this for stationary operations (e.g. tag-based alignment before
        registration) where a slightly stale pose is still geometrically valid.
        Returns ``None`` only if no odom has ever arrived.
        """
        result = self.at(mono_ts)
        if result is not None:
            return result
        with self._lock:
            return self._latest

    def latest_world_position(self, calibration: Calibration) -> tuple[float, float, float] | None:
        """Transform the latest odom position into the AR world frame."""
        odom = self.latest()
        if odom is None:
            return None
        position, _ = calibration.transform_pose(odom.position, odom.orientation)
        return position
