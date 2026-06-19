"""OdomBuffer — thread-safe odometry ring buffer with monotonic- and source-ts lookup.

Uses ``time.monotonic()`` for receive-time speed estimation. Frame↔odom pairing
uses robot production timestamps (``source_ts``) after Lens clock sync.
"""

from __future__ import annotations

from collections import deque
import math
import threading
import time
from typing import TYPE_CHECKING, Union

import numpy as np

from dimos.utils.logging_config import setup_logger

from dimos_xr.tracking.transforms import Calibration, OdomSample

if TYPE_CHECKING:
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.msgs.nav_msgs.Odometry import Odometry

logger = setup_logger()

OdomMsg = Union["PoseStamped", "Odometry"]

ODOM_BUFFER_MAXLEN = 600
ODOM_LOOKUP_MAX_GAP_S = 0.25

_source_ts_provenance_logged = False
_source_ts_provenance_lock = threading.Lock()


class OdomBuffer:
    """Thread-safe odometry ring buffer with monotonic- and source-ts lookup."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest: OdomSample | None = None
        self._buffer: deque[tuple[float, OdomSample]] = deque(maxlen=ODOM_BUFFER_MAXLEN)
        self._source_buffer: deque[tuple[float, OdomSample]] = deque(maxlen=ODOM_BUFFER_MAXLEN)

    def _normalize_orientation(
        self, q: object
    ) -> tuple[float, float, float, float]:
        x, y, z, w = float(q.x), float(q.y), float(q.z), float(q.w)  # type: ignore[attr-defined]
        norm = math.sqrt(x * x + y * y + z * z + w * w)
        if norm < 1e-12:
            return (0.0, 0.0, 0.0, 1.0)
        return (x / norm, y / norm, z / norm, w / norm)

    def sample_from_msg(self, msg: OdomMsg) -> OdomSample:
        """Build an OdomSample from a PoseStamped or Odometry message."""
        orientation = self._normalize_orientation(msg.orientation)
        measured_speed_mps: float | None = None
        if hasattr(msg, "vx") and hasattr(msg, "vy"):
            measured_speed_mps = math.hypot(float(msg.vx), float(msg.vy))  # type: ignore[attr-defined]
        return OdomSample(
            position=(float(msg.x), float(msg.y), float(msg.z)),  # type: ignore[attr-defined]
            orientation=orientation,
            source_ts=float(msg.ts),
            measured_speed_mps=measured_speed_mps,
        )

    def sample(self, msg: PoseStamped) -> OdomSample:
        """Build an OdomSample from a PoseStamped (normalises quaternion)."""
        return self.sample_from_msg(msg)

    def _maybe_log_source_ts_provenance(self, *, source_ts: float, receive_mono: float) -> None:
        """Once-per-session: first sample source_ts vs receive mono.

        Remove after hardware confirms sensor timestamps; assume good for now.
        """
        global _source_ts_provenance_logged
        with _source_ts_provenance_lock:
            if _source_ts_provenance_logged:
                return
            _source_ts_provenance_logged = True
        logger.debug(
            "odom source_ts provenance (assume good; remove log after hardware check)",
            source_ts=round(source_ts, 6),
            receive_mono=round(receive_mono, 6),
            delta_s=round(receive_mono - source_ts, 6),
        )

    def update(self, msg: OdomMsg) -> OdomSample:
        """Sample from msg, store as latest, and append to both ring buffers."""
        s = self.sample_from_msg(msg)
        mono = time.monotonic()
        source_ts = float(msg.ts)
        with self._lock:
            self._latest = s
            self._buffer.append((mono, s))
            self._source_buffer.append((source_ts, s))
        self._maybe_log_source_ts_provenance(source_ts=source_ts, receive_mono=mono)
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

    def latest_source_ts(self) -> float | None:
        with self._lock:
            if self._source_buffer:
                return self._source_buffer[-1][0]
            return None

    def _lookup_nearest(
        self,
        buffer: deque[tuple[float, OdomSample]],
        ts: float,
        *,
        fallback_latest: bool,
    ) -> OdomSample | None:
        with self._lock:
            if not buffer:
                return self._latest
            best: tuple[float, OdomSample] | None = None
            best_gap = float("inf")
            for entry_ts, sample in buffer:
                gap = abs(entry_ts - ts)
                if gap < best_gap:
                    best_gap = gap
                    best = (entry_ts, sample)
            if best is None or best_gap > ODOM_LOOKUP_MAX_GAP_S:
                if fallback_latest:
                    return self._latest
                return None
            return best[1]

    def at(self, mono_ts: float) -> OdomSample | None:
        """Return the sample closest to ``mono_ts`` within ``ODOM_LOOKUP_MAX_GAP_S``."""
        return self._lookup_nearest(self._buffer, mono_ts, fallback_latest=False)

    def at_or_latest(self, mono_ts: float) -> OdomSample | None:
        """Like ``at`` but falls back to the most-recent sample when no buffered
        sample is within ``ODOM_LOOKUP_MAX_GAP_S``.
        """
        return self._lookup_nearest(self._buffer, mono_ts, fallback_latest=True)

    def at_by_source(self, source_ts: float) -> OdomSample | None:
        return self._lookup_nearest(self._source_buffer, source_ts, fallback_latest=False)

    def at_or_latest_by_source(self, source_ts: float) -> OdomSample | None:
        return self._lookup_nearest(self._source_buffer, source_ts, fallback_latest=True)

    def _interpolate(
        self,
        buffer: deque[tuple[float, OdomSample]],
        ts: float,
    ) -> OdomSample | None:
        with self._lock:
            if not buffer:
                return self._latest
            if len(buffer) == 1:
                entry_ts, sample = buffer[0]
                return sample if abs(entry_ts - ts) <= ODOM_LOOKUP_MAX_GAP_S else None

            before: tuple[float, OdomSample] | None = None
            after: tuple[float, OdomSample] | None = None
            for entry_ts, sample in buffer:
                if entry_ts <= ts:
                    before = (entry_ts, sample)
                    continue
                after = (entry_ts, sample)
                break

            if before is None:
                first_ts, first_sample = buffer[0]
                return first_sample if abs(first_ts - ts) <= ODOM_LOOKUP_MAX_GAP_S else None
            if after is None:
                last_ts, last_sample = buffer[-1]
                return last_sample if abs(last_ts - ts) <= ODOM_LOOKUP_MAX_GAP_S else None

            before_ts, before_sample = before
            after_ts, after_sample = after
            if (
                abs(ts - before_ts) > ODOM_LOOKUP_MAX_GAP_S
                and abs(after_ts - ts) > ODOM_LOOKUP_MAX_GAP_S
            ):
                return None
            span = after_ts - before_ts
            if span <= 1e-6:
                return before_sample
            alpha = max(0.0, min(1.0, (ts - before_ts) / span))

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

            measured_speed_mps = before_sample.measured_speed_mps
            if (
                before_sample.measured_speed_mps is not None
                and after_sample.measured_speed_mps is not None
            ):
                measured_speed_mps = (
                    before_sample.measured_speed_mps
                    + alpha * (after_sample.measured_speed_mps - before_sample.measured_speed_mps)
                )

            return OdomSample(
                position=(float(pos[0]), float(pos[1]), float(pos[2])),
                orientation=quat_out,
                source_ts=before_sample.source_ts,
                measured_speed_mps=measured_speed_mps,
            )

    def at_interpolated(self, mono_ts: float) -> OdomSample | None:
        """Return an interpolated sample near ``mono_ts`` when the gap is acceptable."""
        return self._interpolate(self._buffer, mono_ts)

    def at_interpolated_by_source(self, source_ts: float) -> OdomSample | None:
        """Return an interpolated sample near ``source_ts`` when the gap is acceptable."""
        return self._interpolate(self._source_buffer, source_ts)

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

    def speed_windowed(self, mono_ts: float, horizon_s: float) -> float | None:
        """Average linear speed (m/s) over odom samples within ``horizon_s`` of ``mono_ts``."""
        if horizon_s <= 0.0:
            return self.speed_at(mono_ts)
        with self._lock:
            if len(self._buffer) < 2:
                return None
            window = [
                (ts, sample)
                for ts, sample in self._buffer
                if mono_ts - horizon_s <= ts <= mono_ts
            ]
            if len(window) < 2:
                return None
            first_ts, first_sample = window[0]
            last_ts, last_sample = window[-1]
            dt = last_ts - first_ts
            if dt <= 1e-6:
                return 0.0
            dp = math.sqrt(
                (last_sample.position[0] - first_sample.position[0]) ** 2
                + (last_sample.position[1] - first_sample.position[1]) ** 2
                + (last_sample.position[2] - first_sample.position[2]) ** 2
            )
            return dp / dt

    def latest_world_position(self, calibration: Calibration) -> tuple[float, float, float] | None:
        """Transform the latest odom position into the AR world frame."""
        odom = self.latest()
        if odom is None:
            return None
        position, _ = calibration.transform_pose(odom.position, odom.orientation)
        return position
