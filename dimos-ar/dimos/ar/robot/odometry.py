from __future__ import annotations

from collections import deque
from dataclasses import dataclass, replace
from itertools import pairwise
import math
import statistics
import threading
import time
from uuid import uuid4

import numpy as np

from dimos.ar.robot.odometry_correction import correct_odom_pose
from dimos.ar.timing_diagnostics import TimingSummary
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


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
            raise ValueError("pose history size and endpoint age must be positive")
        self._max_endpoint_age_s = max_gap_s
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
            maxlen=self._samples.maxlen or DEFAULT_MAXLEN, max_gap_s=self._max_endpoint_age_s
        )
        with self._lock:
            result._samples.extend(self._samples)
            result._latest = self._latest
        return result

    def timing_diagnostics(self) -> dict[str, float]:
        with self._lock:
            times = [sample.ts_server for sample in self._samples]
        gaps = sorted(b - a for a, b in pairwise(times) if b > a)
        if not gaps:
            return {}
        return {
            "odom_hz": round(1 / statistics.median(gaps), 2),
            "odom_gap_p95_ms": round(gaps[int((len(gaps) - 1) * 0.95)] * 1000, 2),
            "odom_gap_max_ms": round(gaps[-1] * 1000, 2),
        }

    def at_image_ts(self, timestamp: float) -> PoseSample | None:
        """Pair moving-camera pixels with a strict, at-most-200ms pose bracket."""
        with self._lock:
            samples = tuple(self._samples)
        for sample in samples:
            if sample.ts_server == timestamp:
                return sample
        for before, after in pairwise(samples):
            if before.ts_server < timestamp < after.ts_server:
                if after.ts_server - before.ts_server > 0.2:
                    return None
                return _interpolate(deque((before, after)), timestamp, max_endpoint_age_s=0.2)
        return None

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
        # The public keyword limits endpoint age, not bracket span inside history.
        with self._lock:
            sample = _interpolate(
                self._samples,
                ts_server,
                max_endpoint_age_s=self._max_endpoint_age_s if max_gap_s is None else max_gap_s,
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
    max_endpoint_age_s: float,
) -> PoseSample | None:
    if not samples:
        return None
    if not math.isfinite(ts_server):
        return None
    if len(samples) == 1:
        sample = samples[0]
        return sample if abs(sample.ts_server - ts_server) <= max_endpoint_age_s else None

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
        return first if abs(first.ts_server - ts_server) <= max_endpoint_age_s else None
    if before.ts_server == ts_server:
        return before
    if after is None:
        last = samples[-1]
        return last if abs(last.ts_server - ts_server) <= max_endpoint_age_s else None

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
    dot = float(np.clip(np.dot(before_quat, after_quat), -1.0, 1.0))
    if dot > 0.9995:
        quat = before_quat + alpha * (after_quat - before_quat)
    else:
        angle = math.acos(dot)
        quat = (
            math.sin((1.0 - alpha) * angle) * before_quat + math.sin(alpha * angle) * after_quat
        ) / math.sin(angle)
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


class RobotSourceChangedError(ValueError):
    pass


@dataclass(frozen=True)
class AcceptedOdometry:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]
    frame_id: str
    corrected: PoseSample



class RobotOdometry:
    def __init__(self, *, factor: float, recording: bool = False) -> None:
        self.history = PoseBuffer()
        self.clock = RobotSourceClock(recording=recording)
        self.generation = 0
        self.reference_id = uuid4().hex
        self._factor = factor
        self._source_frame: str | None = None
        self._latest: AcceptedOdometry | None = None
        self._timing = TimingSummary(
            "robot odometry timing", source="replay" if recording else "live"
        )
        self._last_arrival_mono: float | None = None

    def latest(self) -> AcceptedOdometry | None:
        return self._latest

    def native_position(self) -> tuple[float, float, float] | None:
        return self._latest.position if self._latest is not None else None

    def travel(self) -> float:
        sample = self.history.latest()
        return sample.travel_m if sample is not None else 0.0

    def accept(
        self, msg: PoseStamped, *, received_at: float | None = None
    ) -> AcceptedOdometry | None:
        now = time.time() if received_at is None else received_at
        timestamp = self.clock.odometry_time(float(msg.ts), received_at=now)
        arrival = time.monotonic()
        gap_ms = (
            (arrival - self._last_arrival_mono) * 1000
            if self._last_arrival_mono is not None
            else 0.0
        )
        self._last_arrival_mono = arrival
        age = now - timestamp if timestamp is not None else None
        self._timing.record(
            counts={
                "received": 1,
                "invalid_timestamp": int(timestamp is None),
                "delayed": int(age is not None and age > 0.25),
                "stale": int(age is not None and age > 2.0),
                "future": int(age is not None and age < -0.25),
            },
            maxima={
                "arrival_gap_max_ms": gap_ms,
                **({"source_age_max_ms": age * 1000} if age is not None else {}),
            },
        )
        if timestamp is None:
            return None
        previous = self.history.latest()
        if (previous is not None and timestamp < previous.ts_server - 1.0) or (
            self._source_frame is not None and self._source_frame != msg.frame_id
        ):
            raise RobotSourceChangedError("robot odometry source changed")
        if not -0.25 <= now - timestamp <= 2.0:
            return None
        if previous is not None and timestamp <= previous.ts_server:
            return None
        native = PoseStamped(
            ts=timestamp,
            frame_id=msg.frame_id,
            position=[msg.x, msg.y, msg.z],
            orientation=[
                msg.orientation.x,
                msg.orientation.y,
                msg.orientation.z,
                msg.orientation.w,
            ],
        )
        try:
            sample = self.history.push(
                correct_odom_pose(native, factor=self._factor), ts_server=timestamp
            )
        except ValueError:
            return None
        self._source_frame = msg.frame_id
        self._latest = AcceptedOdometry(
            position=(native.x, native.y, native.z),
            orientation=sample.orientation,
            frame_id=msg.frame_id,
            corrected=sample,
        )
        return self._latest

    def retire(self) -> None:
        self.generation += 1
        self.reference_id = uuid4().hex
        self._source_frame = None
        self._latest = None
        self.history.clear()
