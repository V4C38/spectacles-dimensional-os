from __future__ import annotations

from collections import deque
from dataclasses import dataclass, replace
from itertools import pairwise
import math
import threading

import numpy as np

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

DEFAULT_MAXLEN = 600
DEFAULT_MAX_GAP_S = 0.25


@dataclass(frozen=True)
class PoseSample:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]
    ts_odom: float
    ts_server: float
    frame_id: str
    travel_m: float = 0.0


class PoseBuffer:
    """Interpolate the robot pose in ``odom`` at a past ``ts_server``.

    ARModule inserts the same XY-corrected robot poses used by outbound telemetry.
    Outbound LiDAR and paths use this same fixed heuristic; native costmaps stay
    unchanged and goals invert it at ingress. Samples use the producer timestamp in the
    server clock domain, not module-delivery time. This is a receipt timestamp
    for Go2 WebRTC, not a hardware exposure timestamp. The WebSocket layer converts ``ts_capture`` to
    ``ts_server`` before building domain ``Observation``s, then localizers call
    ``at_server_ts`` for the pose at shutter time.
    """

    def __init__(
        self,
        *,
        maxlen: int = DEFAULT_MAXLEN,
        max_gap_s: float = DEFAULT_MAX_GAP_S,
    ) -> None:
        if maxlen < 1 or not math.isfinite(max_gap_s) or max_gap_s <= 0:
            raise ValueError("pose history size and interpolation gap must be positive")
        self._max_gap_s = max_gap_s
        self._lock = threading.Lock()
        self._samples: deque[PoseSample] = deque(maxlen=maxlen)
        self._latest: PoseSample | None = None

    def push(self, msg: PoseStamped, *, ts_server: float | None = None) -> PoseSample:
        if ts_server is None:
            ts_server = float(msg.ts)
        sample = _sample_from_pose(msg, ts_server=ts_server)
        with self._lock:
            if self._latest is not None:
                if sample.ts_server < self._latest.ts_server:
                    raise ValueError("out-of-order robot pose timestamp")
                if sample.ts_server == self._latest.ts_server:
                    return self._latest
                sample = replace(
                    sample,
                    travel_m=self._latest.travel_m
                    + math.hypot(
                        sample.position[0] - self._latest.position[0],
                        sample.position[1] - self._latest.position[1],
                    ),
                )
            self._latest = sample
            self._samples.append(sample)
        return sample

    def clear(self) -> None:
        with self._lock:
            self._samples.clear()
            self._latest = None

    def snapshot(self) -> PoseBuffer:
        result = PoseBuffer(
            maxlen=self._samples.maxlen or DEFAULT_MAXLEN, max_gap_s=self._max_gap_s
        )
        with self._lock:
            result._samples.extend(self._samples)
            result._latest = self._latest
        return result

    def is_static_window(
        self, start: float, end: float, *, max_speed_mps: float, max_angular_rps: float
    ) -> bool:
        """Require complete, continuous history on both sides of an estimated capture."""
        with self._lock:
            samples = tuple(self._samples)
        if not samples or samples[0].ts_server > start or samples[-1].ts_server < end:
            return False
        window = [
            sample
            for sample in samples
            if start - self._max_gap_s <= sample.ts_server <= end + self._max_gap_s
        ]
        for first, second in pairwise(window):
            dt = second.ts_server - first.ts_server
            if dt <= 0 or dt > self._max_gap_s:
                return False
            distance = math.dist(first.position, second.position)
            dot = min(1.0, abs(float(np.dot(first.orientation, second.orientation))))
            angular_distance = 2 * math.acos(dot)
            if distance / dt > max_speed_mps or angular_distance / dt > max_angular_rps:
                return False
        return len(window) >= 2

    def latest(self) -> PoseSample | None:
        with self._lock:
            return self._latest

    def at_server_ts(
        self,
        ts_server: float,
        *,
        max_gap_s: float | None = None,
        fallback_to_latest: bool = False,
    ) -> PoseSample | None:
        with self._lock:
            sample = _interpolate(
                self._samples,
                ts_server,
                max_gap_s=self._max_gap_s if max_gap_s is None else max_gap_s,
            )
            # Replay can end while the AR client keeps scanning. Hold its final
            # pose only beyond the history; never fill gaps or rewrite its time.
            if (
                sample is None
                and fallback_to_latest
                and math.isfinite(ts_server)
                and self._latest is not None
                and ts_server > self._latest.ts_server
            ):
                return self._latest
            return sample


def _sample_from_pose(msg: PoseStamped, *, ts_server: float) -> PoseSample:
    values = (
        msg.x,
        msg.y,
        msg.z,
        msg.ts,
        ts_server,
        msg.orientation.x,
        msg.orientation.y,
        msg.orientation.z,
        msg.orientation.w,
    )
    if not all(math.isfinite(float(value)) for value in values):
        raise ValueError("robot pose and timestamps must be finite")
    orientation = _normalize_quaternion(
        (
            float(msg.orientation.x),
            float(msg.orientation.y),
            float(msg.orientation.z),
            float(msg.orientation.w),
        )
    )
    return PoseSample(
        position=(float(msg.x), float(msg.y), float(msg.z)),
        orientation=orientation,
        ts_odom=float(msg.ts),
        ts_server=ts_server,
        frame_id="odom",  # DimOS Go2 stamps "world"; we only ingest odom here
    )


def _normalize_quaternion(
    quat: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    x, y, z, w = quat
    norm = math.sqrt(x * x + y * y + z * z + w * w)
    if norm < 1e-12:
        raise ValueError("robot pose quaternion must be nonzero")
    return (x / norm, y / norm, z / norm, w / norm)


def _interpolate(
    samples: deque[PoseSample],
    ts_server: float,
    *,
    max_gap_s: float,
) -> PoseSample | None:
    if not samples:
        return None
    if not math.isfinite(ts_server):
        return None
    if len(samples) == 1:
        sample = samples[0]
        return sample if abs(sample.ts_server - ts_server) <= max_gap_s else None

    before: PoseSample | None = None
    after: PoseSample | None = None
    for sample in samples:
        if sample.ts_server <= ts_server:
            before = sample
            continue
        after = sample
        break

    if before is None:
        first = samples[0]
        return first if abs(first.ts_server - ts_server) <= max_gap_s else None
    if before.ts_server == ts_server:
        return before
    if after is None:
        last = samples[-1]
        return last if abs(last.ts_server - ts_server) <= max_gap_s else None

    if after.ts_server - before.ts_server > max_gap_s:
        return None

    span = after.ts_server - before.ts_server
    if span <= 1e-6:
        return before

    alpha = max(0.0, min(1.0, (ts_server - before.ts_server) / span))
    before_pos = np.asarray(before.position, dtype=np.float64)
    after_pos = np.asarray(after.position, dtype=np.float64)
    pos = before_pos + alpha * (after_pos - before_pos)

    before_quat = np.asarray(before.orientation, dtype=np.float64)
    after_quat = np.asarray(after.orientation, dtype=np.float64)
    if float(np.dot(before_quat, after_quat)) < 0.0:
        after_quat = -after_quat
    quat = before_quat + alpha * (after_quat - before_quat)
    quat_norm = float(np.linalg.norm(quat))
    if quat_norm < 1e-12:
        quat_out = before.orientation
    else:
        quat /= quat_norm
        quat_out = (float(quat[0]), float(quat[1]), float(quat[2]), float(quat[3]))

    ts_odom = before.ts_odom + alpha * (after.ts_odom - before.ts_odom)

    return PoseSample(
        position=(float(pos[0]), float(pos[1]), float(pos[2])),
        orientation=quat_out,
        ts_odom=ts_odom,
        ts_server=ts_server,
        frame_id=before.frame_id,
        travel_m=before.travel_m + alpha * (after.travel_m - before.travel_m),
    )
