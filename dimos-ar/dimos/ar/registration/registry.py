"""WorldRegistry — owns Calibration / T_world_odom and TF publish."""

from __future__ import annotations

from collections.abc import Callable
import time
from typing import Any

import numpy as np

from dimos.ar.registration.transforms import Calibration
from dimos.ar.registration.types import RegistrationCandidate
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class WorldRegistry:
    """Wraps Calibration state and static TF publish for registration commits."""

    def __init__(
        self,
        calibration: Calibration,
        tf_publish_static: Callable[[Transform], None],
    ) -> None:
        self._calibration = calibration
        self._tf_publish_static = tf_publish_static
        self._tf_publish_static_unsupported = False

    @property
    def calibration(self) -> Calibration:
        return self._calibration

    def commit(self, candidate: RegistrationCandidate) -> None:
        self._calibration.register_world_odom(candidate.T_world_odom)
        self._publish_world_odom_tf(candidate.T_world_odom)

    def _publish_world_odom_tf(self, T_world_odom: np.ndarray) -> None:
        if self._tf_publish_static_unsupported:
            return
        rot_mat = T_world_odom[:3, :3]
        tx = float(T_world_odom[0, 3])
        ty = float(T_world_odom[1, 3])
        tz = float(T_world_odom[2, 3])
        quat = Quaternion.from_rotation_matrix(rot_mat)
        tf = Transform(
            translation=Vector3(tx, ty, tz),
            rotation=quat,
            frame_id="world",
            child_frame_id="odom",
            ts=time.time(),
        )
        try:
            self._tf_publish_static(tf)
        except NotImplementedError:
            self._tf_publish_static_unsupported = True
            logger.debug(
                "TF publish_static not supported by current backend — skipping world→odom TF"
            )
        except Exception as exc:
            logger.exception("TF publish_static failed", error=str(exc))
