from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
import threading
from typing import TYPE_CHECKING

import numpy as np

from dimos.ar.localization.robot_pose_buffer import RobotPoseBuffer, RobotPoseSample
from dimos.ar.localization.types import DistortionModel, Intrinsics, Observation
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray

DEFAULT_MAXLEN = 3
DEFAULT_STATIC_SPEED_MPS = 0.05
DEFAULT_MAX_TRAVEL_M = 1.0


@dataclass(frozen=True)
class RobotObservationSample:
    observation: Observation
    travel_m: float


class RobotObservationBuffer:
    def __init__(
        self,
        *,
        robot_pose_buffer: RobotPoseBuffer,
        T_base_camopt: NDArray[np.float64],
        maxlen: int = DEFAULT_MAXLEN,
        static_speed_mps: float = DEFAULT_STATIC_SPEED_MPS,
        max_travel_m: float = DEFAULT_MAX_TRAVEL_M,
    ) -> None:
        if maxlen < 1:
            raise ValueError(f"maxlen must be at least 1, got {maxlen}")
        if not math.isfinite(static_speed_mps) or static_speed_mps < 0.0:
            raise ValueError(
                f"static_speed_mps must be finite and non-negative, got {static_speed_mps}"
            )
        if not math.isfinite(max_travel_m) or max_travel_m <= 0.0:
            raise ValueError(f"max_travel_m must be finite and positive, got {max_travel_m}")
        self._robot_pose_buffer = robot_pose_buffer
        self._T_base_camopt = T_base_camopt
        self._maxlen = maxlen
        self._static_speed_mps = static_speed_mps
        self._max_travel_m = max_travel_m
        self._lock = threading.Lock()
        self._camera_info: CameraInfo | None = None
        self._samples: deque[RobotObservationSample] = deque(maxlen=maxlen)

    def set_camera_info(self, camera_info: CameraInfo) -> None:
        with self._lock:
            self._camera_info = camera_info

    def expire(self, travel_m: float) -> None:
        with self._lock:
            self._drop_stale(travel_m)

    def push_image(
        self,
        image: Image,
        *,
        ts_server: float,
        speed_mps: float,
        travel_m: float,
    ) -> None:
        if not math.isfinite(speed_mps) or speed_mps > self._static_speed_mps:
            with self._lock:
                self._drop_stale(travel_m)
            return

        with self._lock:
            camera_info = self._camera_info
            self._drop_stale(travel_m)
        if camera_info is None:
            return

        observation = observation_from_robot_frame(
            image=image,
            camera_info=camera_info,
            robot_pose_buffer=self._robot_pose_buffer,
            T_base_camopt=self._T_base_camopt,
            ts_server=ts_server,
        )
        if observation is None:
            return

        with self._lock:
            self._drop_stale(travel_m)
            self._samples.append(RobotObservationSample(observation=observation, travel_m=travel_m))

    def newest(self) -> RobotObservationSample | None:
        with self._lock:
            if not self._samples:
                return None
            return self._samples[-1]

    def _drop_stale(self, travel_m: float) -> None:
        while self._samples and travel_m - self._samples[0].travel_m > self._max_travel_m:
            self._samples.popleft()


def observation_from_robot_frame(
    *,
    image: Image,
    camera_info: CameraInfo,
    robot_pose_buffer: RobotPoseBuffer,
    T_base_camopt: NDArray[np.float64],
    ts_server: float | None = None,
) -> Observation | None:
    if ts_server is None:
        ts_server = float(image.ts)
    robot_pose = robot_pose_buffer.at_server_ts(ts_server)
    if robot_pose is None:
        return None

    T_odom_base = _sample_to_matrix(robot_pose)
    T_odom_camopt = T_odom_base @ np.asarray(T_base_camopt, dtype=np.float64)
    return Observation(
        jpeg=image.to_jpeg_bytes(),
        intrinsics=intrinsics_from_camera_info(camera_info),
        camera_pose=matrix_to_pose(T_odom_camopt),
        ts_server=ts_server,
    )


def intrinsics_from_camera_info(camera_info: CameraInfo) -> Intrinsics:
    if camera_info.K is None or len(camera_info.K) < 9:
        raise ValueError("camera_info.K must contain 9 elements")

    fx = float(camera_info.K[0])
    fy = float(camera_info.K[4])
    cx = float(camera_info.K[2])
    cy = float(camera_info.K[5])
    distortion = tuple(float(value) for value in (camera_info.D or ()))
    return Intrinsics(
        fx=fx,
        fy=fy,
        cx=cx,
        cy=cy,
        width=int(camera_info.width),
        height=int(camera_info.height),
        distortion_model=_distortion_model_from_camera_info(camera_info.distortion_model),
        distortion=distortion,
    )


def _distortion_model_from_camera_info(model: str) -> DistortionModel:
    normalized = model.strip().lower()
    if normalized in ("", "none"):
        return "none"
    if normalized == "plumb_bob":
        return "plumb_bob"
    if normalized == "equidistant":
        return "equidistant"
    raise ValueError(f"unsupported camera distortion model {model!r}")


def _sample_to_matrix(sample: RobotPoseSample) -> NDArray[np.float64]:
    return np.asarray(
        pose_to_matrix(Pose(*sample.position, *sample.orientation)),
        dtype=np.float64,
    )
