from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
import math
from typing import TYPE_CHECKING

import cv2
import numpy as np

from dimos.ar.localization.pose_buffer import PoseBuffer, PoseSample
from dimos.ar.localization.transforms import fuse_pose_estimates
from dimos.ar.localization.types import Intrinsics, LocalizedPose, Localizer, Observation
from dimos.ar.robot.profiles import FiducialMarkerMount
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.perception.fiducial.marker_pose import (
    create_aruco_detector,
    estimate_marker_pose,
    marker_reprojection_error,
)
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray


@dataclass(frozen=True)
class FiducialMarkerLocalizerConfig:
    max_reprojection_error_px: float = 3.0
    max_tilt_rad: float = math.radians(5.0)
    max_position_residual_m: float = 0.35
    max_yaw_residual_rad: float = math.radians(12.0)

    def __post_init__(self) -> None:
        if (
            not math.isfinite(self.max_reprojection_error_px)
            or self.max_reprojection_error_px <= 0.0
        ):
            raise ValueError(
                "max_reprojection_error_px must be finite and positive, "
                f"got {self.max_reprojection_error_px}"
            )
        if not math.isfinite(self.max_tilt_rad) or not 0.0 <= self.max_tilt_rad <= math.pi:
            raise ValueError(
                f"max_tilt_rad must be finite and within [0, pi], got {self.max_tilt_rad}"
            )
        if not math.isfinite(self.max_position_residual_m) or self.max_position_residual_m <= 0.0:
            raise ValueError(
                "max_position_residual_m must be finite and positive, "
                f"got {self.max_position_residual_m}"
            )
        if (
            not math.isfinite(self.max_yaw_residual_rad)
            or not 0.0 < self.max_yaw_residual_rad <= math.pi
        ):
            raise ValueError(
                "max_yaw_residual_rad must be finite and within (0, pi], "
                f"got {self.max_yaw_residual_rad}"
            )


@dataclass(frozen=True)
class _FiducialCandidate:
    transform: NDArray[np.float64]
    reprojection_error_px: float


class FiducialMarkerLocalizer(Localizer):
    def __init__(
        self,
        *,
        pose_buffer: PoseBuffer,
        marker_mounts: Sequence[FiducialMarkerMount],
        dictionary_name: str,
        config: FiducialMarkerLocalizerConfig | None = None,
    ) -> None:
        self._pose_buffer = pose_buffer
        self._mounts: dict[int, FiducialMarkerMount] = {}
        for mount in marker_mounts:
            if mount.marker_id in self._mounts:
                raise ValueError(f"duplicate fiducial marker ID {mount.marker_id}")
            self._mounts[mount.marker_id] = mount
        if not self._mounts:
            raise ValueError("marker_mounts must contain at least one mount")
        self._config = config or FiducialMarkerLocalizerConfig()
        self._detector = create_aruco_detector(dictionary_name)

    def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None:
        candidates: list[_FiducialCandidate] = []
        for observation in observations:
            candidate = self._candidate_from_observation(observation)
            if candidate is not None:
                candidates.append(candidate)

        if not candidates:
            return None

        fusion = fuse_pose_estimates(
            [candidate.transform for candidate in candidates],
            max_tilt_rad=self._config.max_tilt_rad,
            max_position_residual_m=self._config.max_position_residual_m,
            max_yaw_residual_rad=self._config.max_yaw_residual_rad,
        )
        if fusion is None:
            return None

        inliers = [candidates[index] for index in fusion.inlier_indices]
        mean_reproj = float(np.mean([candidate.reprojection_error_px for candidate in inliers]))
        worst_normalized_error = max(
            mean_reproj / self._config.max_reprojection_error_px,
            fusion.max_position_residual_m / self._config.max_position_residual_m,
            fusion.max_yaw_residual_rad / self._config.max_yaw_residual_rad,
        )
        confidence = max(0.0, min(1.0, 1.0 - worst_normalized_error))
        return LocalizedPose(
            pose=matrix_to_pose(fusion.transform),
            frame_id="odom",
            confidence=confidence,
        )

    def _candidate_from_observation(self, observation: Observation) -> _FiducialCandidate | None:
        gray = cv2.imdecode(
            np.frombuffer(observation.jpeg, dtype=np.uint8),
            cv2.IMREAD_GRAYSCALE,
        )
        if gray is None:
            return None
        image_height, image_width = gray.shape
        if (image_width, image_height) != (
            observation.intrinsics.width,
            observation.intrinsics.height,
        ):
            raise ValueError(
                f"JPEG dimensions {image_width}x{image_height} do not match intrinsics "
                f"{observation.intrinsics.width}x{observation.intrinsics.height}"
            )

        robot = self._pose_buffer.at_server_ts(observation.ts_server)
        if robot is None:
            return None

        camera_matrix, dist_coeffs = _intrinsics_to_cv(observation.intrinsics)
        corners_list, ids, _ = self._detector.detectMarkers(gray)
        if ids is None or len(ids) == 0:
            return None

        T_odom_base = _sample_to_matrix(robot)
        T_client_camopt = np.asarray(pose_to_matrix(observation.camera_pose), dtype=np.float64)

        best: _FiducialCandidate | None = None
        for corners, marker_id_arr in zip(corners_list, ids, strict=True):
            marker_id = int(marker_id_arr[0])
            mount = self._mounts.get(marker_id)
            if mount is None:
                continue

            candidate = self._candidate_from_detection(
                corners=corners,
                mount=mount,
                camera_matrix=camera_matrix,
                dist_coeffs=dist_coeffs,
                intrinsics=observation.intrinsics,
                T_odom_base=T_odom_base,
                T_client_camopt=T_client_camopt,
            )
            if candidate is None:
                continue
            if best is None or candidate.reprojection_error_px < best.reprojection_error_px:
                best = candidate

        return best

    def _candidate_from_detection(
        self,
        *,
        corners: NDArray[np.float32],
        mount: FiducialMarkerMount,
        camera_matrix: NDArray[np.float64],
        dist_coeffs: NDArray[np.float64],
        intrinsics: Intrinsics,
        T_odom_base: NDArray[np.float64],
        T_client_camopt: NDArray[np.float64],
    ) -> _FiducialCandidate | None:
        pose = estimate_marker_pose(
            corners,
            mount.size_m,
            camera_matrix,
            dist_coeffs,
            distortion_model=intrinsics.distortion_model,
        )
        if pose is None:
            return None

        rvec, tvec = pose

        reproj = marker_reprojection_error(
            corners,
            mount.size_m,
            camera_matrix,
            dist_coeffs,
            rvec,
            tvec,
            distortion_model=intrinsics.distortion_model,
        )
        if not math.isfinite(reproj) or reproj > self._config.max_reprojection_error_px:
            return None

        T_camopt_marker = _matrix_from_rvec_tvec(rvec, tvec)
        transform = compose_odom_client(
            T_odom_base,
            mount.T_base_marker,
            T_client_camopt,
            T_camopt_marker,
        )
        if not np.isfinite(transform).all():
            return None
        return _FiducialCandidate(transform=transform, reprojection_error_px=reproj)


def compose_odom_client(
    T_odom_base: NDArray[np.float64],
    T_base_marker: NDArray[np.float64],
    T_client_camopt: NDArray[np.float64],
    T_camopt_marker: NDArray[np.float64],
) -> NDArray[np.float64]:
    T_odom_marker = T_odom_base @ T_base_marker
    T_client_marker = T_client_camopt @ T_camopt_marker
    return T_odom_marker @ np.linalg.inv(T_client_marker)


def _intrinsics_to_cv(intrinsics: Intrinsics) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    camera_matrix = np.array(
        [
            [intrinsics.fx, 0.0, intrinsics.cx],
            [0.0, intrinsics.fy, intrinsics.cy],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    dist_coeffs = np.asarray(intrinsics.distortion, dtype=np.float64).reshape(-1, 1)
    return camera_matrix, dist_coeffs


def _sample_to_matrix(sample: PoseSample) -> NDArray[np.float64]:
    return np.asarray(
        pose_to_matrix(Pose(*sample.position, *sample.orientation)),
        dtype=np.float64,
    )


def _matrix_from_rvec_tvec(
    rvec: NDArray[np.float64],
    tvec: NDArray[np.float64],
) -> NDArray[np.float64]:
    rotation, _ = cv2.Rodrigues(rvec)
    transform = np.eye(4, dtype=np.float64)
    transform[:3, :3] = rotation
    transform[:3, 3] = tvec.reshape(3)
    return transform
