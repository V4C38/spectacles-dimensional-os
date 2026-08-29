from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
import math
from typing import TYPE_CHECKING, Protocol

import cv2
import numpy as np

from dimos.ar.localization.transforms import fuse_pose_estimates
from dimos.ar.localization.types import Intrinsics, LocalizedPose, Localizer, Observation
from dimos.ar.localization.undistort import undistort_to_pinhole
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

if TYPE_CHECKING:
    from numpy.typing import NDArray


@dataclass(frozen=True)
class VpsQueryResult:
    camera_pose: Pose
    confidence: float


class VpsClient(Protocol):
    def query(self, *, jpeg: bytes, intrinsics: Intrinsics) -> VpsQueryResult | None: ...


@dataclass(frozen=True)
class VpsLocalizerConfig:
    max_tilt_rad: float = math.radians(5.0)
    max_position_residual_m: float = 0.35
    max_yaw_residual_rad: float = math.radians(12.0)
    min_query_confidence: float = 0.5
    max_image_longest_side: int = 1280

    def __post_init__(self) -> None:
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
        if (
            not math.isfinite(self.min_query_confidence)
            or not 0.0 <= self.min_query_confidence <= 1.0
        ):
            raise ValueError(
                "min_query_confidence must be finite and within [0, 1], "
                f"got {self.min_query_confidence}"
            )
        if self.max_image_longest_side <= 0:
            raise ValueError(
                f"max_image_longest_side must be positive, got {self.max_image_longest_side}"
            )


@dataclass(frozen=True)
class _VpsCandidate:
    transform: NDArray[np.float64]
    query_confidence: float


class VpsLocalizer(Localizer):
    def __init__(
        self,
        *,
        client: VpsClient,
        config: VpsLocalizerConfig | None = None,
    ) -> None:
        self._client = client
        self._config = config or VpsLocalizerConfig()

    def localize(self, observations: Sequence[Observation]) -> LocalizedPose | None:
        candidates: list[_VpsCandidate] = []
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
        mean_query_confidence = float(
            np.mean([candidate.query_confidence for candidate in inliers])
        )
        worst_normalized_error = max(
            1.0 - mean_query_confidence,
            fusion.max_position_residual_m / self._config.max_position_residual_m,
            fusion.max_yaw_residual_rad / self._config.max_yaw_residual_rad,
        )
        confidence = max(0.0, min(1.0, 1.0 - worst_normalized_error))
        return LocalizedPose(
            pose=matrix_to_pose(fusion.transform),
            frame_id="map",
            confidence=confidence,
        )

    def _candidate_from_observation(self, observation: Observation) -> _VpsCandidate | None:
        image = cv2.imdecode(
            np.frombuffer(observation.jpeg, dtype=np.uint8),
            cv2.IMREAD_COLOR,
        )
        if image is None:
            return None
        color = np.asarray(image, dtype=np.uint8)
        image_height, image_width = color.shape[:2]
        if (image_width, image_height) != (
            observation.intrinsics.width,
            observation.intrinsics.height,
        ):
            raise ValueError(
                f"JPEG dimensions {image_width}x{image_height} do not match intrinsics "
                f"{observation.intrinsics.width}x{observation.intrinsics.height}"
            )

        frame = undistort_to_pinhole(color, observation.intrinsics)
        jpeg, intrinsics = _encode_for_query(
            frame.image,
            frame.intrinsics,
            max_longest_side=self._config.max_image_longest_side,
        )

        result = self._client.query(jpeg=jpeg, intrinsics=intrinsics)
        if result is None:
            return None
        if not math.isfinite(result.confidence):
            return None
        if result.confidence < self._config.min_query_confidence:
            return None

        T_map_camopt = np.asarray(pose_to_matrix(result.camera_pose), dtype=np.float64)
        T_client_camopt = np.asarray(pose_to_matrix(observation.camera_pose), dtype=np.float64)
        transform = compose_map_client(T_map_camopt, T_client_camopt)
        if not np.isfinite(transform).all():
            return None

        return _VpsCandidate(transform=transform, query_confidence=result.confidence)


def compose_map_client(
    T_map_camopt: NDArray[np.float64],
    T_client_camopt: NDArray[np.float64],
) -> NDArray[np.float64]:
    return T_map_camopt @ np.linalg.inv(T_client_camopt)


def _encode_for_query(
    image: NDArray[np.uint8],
    intrinsics: Intrinsics,
    *,
    max_longest_side: int,
) -> tuple[bytes, Intrinsics]:
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= max_longest_side:
        prepared = image
        prepared_intrinsics = intrinsics
    else:
        scale = max_longest_side / float(longest)
        new_width = max(1, round(width * scale))
        new_height = max(1, round(height * scale))
        prepared = np.asarray(
            cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_AREA),
            dtype=np.uint8,
        )
        prepared_intrinsics = _scale_intrinsics(intrinsics, scale=scale)

    ok, encoded = cv2.imencode(".jpg", prepared)
    if not ok:
        raise ValueError("failed to encode JPEG for VPS query")
    return encoded.tobytes(), prepared_intrinsics


def _scale_intrinsics(intrinsics: Intrinsics, *, scale: float) -> Intrinsics:
    if not math.isfinite(scale) or scale <= 0.0:
        raise ValueError(f"scale must be finite and positive, got {scale}")

    width = max(1, round(intrinsics.width * scale))
    height = max(1, round(intrinsics.height * scale))
    return Intrinsics(
        fx=intrinsics.fx * scale,
        fy=intrinsics.fy * scale,
        cx=intrinsics.cx * scale,
        cy=intrinsics.cy * scale,
        width=width,
        height=height,
        distortion_model="none",
        distortion=(),
    )
