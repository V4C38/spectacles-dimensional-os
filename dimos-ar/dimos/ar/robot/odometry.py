from __future__ import annotations

from dataclasses import dataclass
import time
from uuid import uuid4

from dimos.ar.localization.pose_buffer import PoseBuffer, PoseSample
from dimos.ar.localization.source_clock import RobotSourceClock
from dimos.ar.robot.odometry_correction import correct_odom_pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


class RobotSourceChangedError(ValueError):
    pass


@dataclass(frozen=True)
class AcceptedOdometry:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]
    frame_id: str
    corrected: PoseSample

    def native_pose(self) -> PoseStamped:
        return PoseStamped(
            ts=self.corrected.ts_server,
            frame_id=self.frame_id,
            position=list(self.position),
            orientation=list(self.orientation),
        )


class RobotOdometry:
    def __init__(self, *, factor: float, recording: bool = False) -> None:
        self.history = PoseBuffer()
        self.clock = RobotSourceClock(recording=recording)
        self.generation = 0
        self.reference_id = uuid4().hex
        self._factor = factor
        self._source_frame: str | None = None
        self._latest: AcceptedOdometry | None = None

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
