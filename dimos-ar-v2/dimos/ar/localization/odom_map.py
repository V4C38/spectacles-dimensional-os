from __future__ import annotations

from dataclasses import dataclass
import math
import threading
from typing import TYPE_CHECKING, Literal

import numpy as np

from dimos.ar.localization.pose_buffer import PoseBuffer, RobotPoseSample
from dimos.ar.localization.types import DistortionModel, Intrinsics, LocalizedPose, Observation
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray

OdomMapSource = Literal["vps", "relocalization"]
_ODOM_PARENT_FRAMES = frozenset({"odom", "world"})


@dataclass(frozen=True)
class OdomMapConfig:
    min_vps_confidence: float = 0.5

    def __post_init__(self) -> None:
        if not math.isfinite(self.min_vps_confidence) or not 0.0 <= self.min_vps_confidence <= 1.0:
            raise ValueError(
                "min_vps_confidence must be finite and within [0, 1], "
                f"got {self.min_vps_confidence}"
            )


@dataclass(frozen=True)
class OdomMapSample:
    T_odom_map: NDArray[np.float64]
    ts_server: float
    confidence: float
    source: OdomMapSource


class OdomMap:
    def __init__(self, *, config: OdomMapConfig | None = None) -> None:
        self._config = config or OdomMapConfig()
        self._lock = threading.Lock()
        self._sample: OdomMapSample | None = None

    def current(self) -> OdomMapSample | None:
        with self._lock:
            return self._sample

    def T_odom_map(self) -> NDArray[np.float64] | None:
        sample = self.current()
        if sample is None:
            return None
        return sample.T_odom_map.copy()

    def update_from_vps(
        self,
        localization: LocalizedPose,
        *,
        ts_server: float,
    ) -> bool:
        if localization.frame_id != "map":
            raise ValueError(
                f"VPS odom_map update expects frame_id='map', got {localization.frame_id!r}"
            )
        if localization.confidence < self._config.min_vps_confidence:
            return False

        T_map_odom = np.asarray(pose_to_matrix(localization.pose), dtype=np.float64)
        if not np.isfinite(T_map_odom).all():
            return False
        T_odom_map = np.asarray(np.linalg.inv(T_map_odom), dtype=np.float64)
        if not np.isfinite(T_odom_map).all():
            return False

        sample = OdomMapSample(
            T_odom_map=T_odom_map,
            ts_server=ts_server,
            confidence=localization.confidence,
            source="vps",
        )
        with self._lock:
            self._sample = sample
        return True

    def update_from_relocalization(self, transform: Transform) -> bool:
        if transform.child_frame_id != "map":
            return False
        if transform.frame_id not in _ODOM_PARENT_FRAMES:
            return False

        T_odom_map = np.asarray(transform.to_matrix(), dtype=np.float64)
        if not np.isfinite(T_odom_map).all():
            return False

        sample = OdomMapSample(
            T_odom_map=T_odom_map,
            ts_server=float(transform.ts),
            confidence=1.0,
            source="relocalization",
        )
        with self._lock:
            self._sample = sample
        return True

    def localization_in_odom(self, localization: LocalizedPose) -> LocalizedPose | None:
        if localization.frame_id == "odom":
            return localization
        if localization.frame_id != "map":
            raise ValueError(f"unsupported localization frame_id {localization.frame_id!r}")

        T_odom_map = self.T_odom_map()
        if T_odom_map is None:
            return None

        T_map_client = np.asarray(pose_to_matrix(localization.pose), dtype=np.float64)
        T_odom_client = compose_odom_from_map(T_odom_map, T_map_client)
        if not np.isfinite(T_odom_client).all():
            return None
        return LocalizedPose(
            pose=matrix_to_pose(T_odom_client),
            frame_id="odom",
            confidence=localization.confidence,
        )


def compose_odom_from_map(
    T_odom_map: NDArray[np.float64],
    T_map_client: NDArray[np.float64],
) -> NDArray[np.float64]:
    return T_odom_map @ T_map_client


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


def observation_from_robot_frame(
    *,
    image: Image,
    camera_info: CameraInfo,
    pose_buffer: PoseBuffer,
    T_base_camopt: NDArray[np.float64],
    ts_server: float | None = None,
) -> Observation | None:
    if ts_server is None:
        ts_server = float(image.ts)
    robot_pose = pose_buffer.at_server_ts(ts_server)
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
