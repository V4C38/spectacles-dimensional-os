from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
import threading
import time

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


class PoseBuffer:
    """Interpolate the robot pose in ``odom`` at a past ``ts_server``.

    Odom samples are indexed by the server time each message arrived
    (``handle_odom``). The WebSocket layer converts wire ``ts_capture`` to
    ``ts_server`` before building domain ``Observation``s, then localizers call
    ``at_server_ts`` for the pose at shutter time.
    """

    def __init__(
        self,
        *,
        maxlen: int = DEFAULT_MAXLEN,
        max_gap_s: float = DEFAULT_MAX_GAP_S,
    ) -> None:
        self._max_gap_s = max_gap_s
        self._lock = threading.Lock()
        self._samples: deque[PoseSample] = deque(maxlen=maxlen)
        self._latest: PoseSample | None = None

    def push(self, msg: PoseStamped, *, ts_server: float | None = None) -> PoseSample:
        if ts_server is None:
            ts_server = time.time()
        sample = _sample_from_pose(msg, ts_server=ts_server)
        with self._lock:
            self._latest = sample
            self._samples.append(sample)
        return sample

    def latest(self) -> PoseSample | None:
        with self._lock:
            return self._latest

    def at_server_ts(self, ts_server: float) -> PoseSample | None:
        with self._lock:
            return _interpolate(self._samples, ts_server, max_gap_s=self._max_gap_s)


def _sample_from_pose(msg: PoseStamped, *, ts_server: float) -> PoseSample:
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
        return (0.0, 0.0, 0.0, 1.0)
    return (x / norm, y / norm, z / norm, w / norm)


def _interpolate(
    samples: deque[PoseSample],
    ts_server: float,
    *,
    max_gap_s: float,
) -> PoseSample | None:
    if not samples:
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
    if after is None:
        last = samples[-1]
        return last if abs(last.ts_server - ts_server) <= max_gap_s else None

    if abs(ts_server - before.ts_server) > max_gap_s and abs(after.ts_server - ts_server) > max_gap_s:
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
    )
