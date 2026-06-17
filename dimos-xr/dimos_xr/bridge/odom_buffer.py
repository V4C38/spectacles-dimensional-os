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

import numpy as np

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

    def at_interpolated(self, mono_ts: float) -> OdomSample | None:
        """Return an interpolated sample near ``mono_ts`` when the gap is acceptable."""
        with self._lock:
            if not self._buffer:
                return self._latest
            if len(self._buffer) == 1:
                ts, sample = self._buffer[0]
                return sample if abs(ts - mono_ts) <= ODOM_LOOKUP_MAX_GAP_S else None

            before: tuple[float, OdomSample] | None = None
            after: tuple[float, OdomSample] | None = None
            for ts, sample in self._buffer:
                if ts <= mono_ts:
                    before = (ts, sample)
                    continue
                after = (ts, sample)
                break

            if before is None:
                first_ts, first_sample = self._buffer[0]
                return first_sample if abs(first_ts - mono_ts) <= ODOM_LOOKUP_MAX_GAP_S else None
            if after is None:
                last_ts, last_sample = self._buffer[-1]
                return last_sample if abs(last_ts - mono_ts) <= ODOM_LOOKUP_MAX_GAP_S else None

            before_ts, before_sample = before
            after_ts, after_sample = after
            if (
                abs(mono_ts - before_ts) > ODOM_LOOKUP_MAX_GAP_S
                and abs(after_ts - mono_ts) > ODOM_LOOKUP_MAX_GAP_S
            ):
                return None
            span = after_ts - before_ts
            if span <= 1e-6:
                return before_sample
            alpha = max(0.0, min(1.0, (mono_ts - before_ts) / span))

            before_pos = np.asarray(before_sample.position, dtype=np.float64)
            after_pos = np.asarray(after_sample.position, dtype=np.float64)
            pos = before_pos + alpha * (after_pos - before_pos)

            before_quat = np.asarray(before_sample.orientation, dtype=np.float64)
            after_quat = np.asarray(after_sample.orientation, dtype=np.float64)
            if float(np.dot(before_quat, after_quat)) < 0.0:
                after_quat = -after_quat
            quat = before_quat + alpha * (after_quat - before_quat)
            quat_norm = float(np.linalg.norm(quat))
            if quat_norm < 1e-12:
                quat_out = before_sample.orientation
            else:
                quat /= quat_norm
                quat_out = (float(quat[0]), float(quat[1]), float(quat[2]), float(quat[3]))

            return OdomSample(
                position=(float(pos[0]), float(pos[1]), float(pos[2])),
                orientation=quat_out,
            )

    def speed_at(self, mono_ts: float) -> float | None:
        """Estimate robot linear speed (m/s) from the two odom samples that bracket
        ``mono_ts``.  Returns ``None`` when fewer than two samples are available or
        the bracket gap exceeds ``ODOM_LOOKUP_MAX_GAP_S``."""
        with self._lock:
            if len(self._buffer) < 2:
                return None
            before: tuple[float, OdomSample] | None = None
            after: tuple[float, OdomSample] | None = None
            for ts, sample in self._buffer:
                if ts <= mono_ts:
                    before = (ts, sample)
                else:
                    after = (ts, sample)
                    break
            if before is None or after is None:
                return None
            before_ts, before_sample = before
            after_ts, after_sample = after
            dt = after_ts - before_ts
            if dt <= 1e-6:
                return None
            if (
                abs(mono_ts - before_ts) > ODOM_LOOKUP_MAX_GAP_S
                and abs(after_ts - mono_ts) > ODOM_LOOKUP_MAX_GAP_S
            ):
                return None
            dp = math.sqrt(
                (after_sample.position[0] - before_sample.position[0]) ** 2
                + (after_sample.position[1] - before_sample.position[1]) ** 2
                + (after_sample.position[2] - before_sample.position[2]) ** 2
            )
            return dp / dt

    def latest_world_position(self, calibration: Calibration) -> tuple[float, float, float] | None:
        """Transform the latest odom position into the AR world frame."""
        odom = self.latest()
        if odom is None:
            return None
        position, _ = calibration.transform_pose(odom.position, odom.orientation)
        return position
