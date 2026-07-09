"""WorldRegistry — commit/clear lifecycle for world frame, static TF, and refiner baseline."""

from __future__ import annotations

from collections.abc import Callable
import time
from typing import TYPE_CHECKING

import numpy as np

from dimos.ar.registration.types import RegistrationCandidate
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import OdomSample, pose_to_matrix
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.world_frame.refinement import WorldFrameRefiner

logger = setup_logger()


class WorldRegistry:
    """Owns world-frame mutation, static TF, and refiner baseline sync.

    ``WorldFrameState`` is constructed elsewhere (``ARBridge``) and passed in.
    This class is the sole writer for registration commits, clears, and runtime
    refinement transform updates. Static TF is published on commit and on every
    ``apply_runtime_transform`` so DimOS TF tracks live ``T_world_odom``.
    """

    def __init__(
        self,
        state: WorldFrameState,
        tf_publish_static: Callable[[Transform], None],
        refiner: WorldFrameRefiner | None = None,
        odom_latest: Callable[[], OdomSample | None] | None = None,
    ) -> None:
        self._state = state
        self._tf_publish_static = tf_publish_static
        self._tf_publish_static_unsupported = False
        self._refiner = refiner
        self._odom_latest = odom_latest

    @property
    def state(self) -> WorldFrameState:
        return self._state

    def attach_refiner(self, refiner: WorldFrameRefiner) -> None:
        """Wire post-commit refiner after two-phase construction in ``ARBridge.build``."""
        self._refiner = refiner

    def commit(
        self,
        candidate: RegistrationCandidate,
        *,
        odom: OdomSample | None = None,
    ) -> None:
        if candidate.odom_scale is None:
            self._state.commit(
                candidate.T_world_odom,
                method=candidate.mode.value,
                approximate=candidate.approximate,
            )
        else:
            self._state.commit(
                candidate.T_world_odom,
                method=candidate.mode.value,
                approximate=candidate.approximate,
                odom_scale=float(candidate.odom_scale),
            )
        T_committed = self._state.current_transform()
        if T_committed is None:
            raise RuntimeError("WorldFrameState not committed after registry.commit()")
        self._publish_world_odom_tf(T_committed)
        if self._refiner is not None:
            self._refiner.set_refinement_baseline(T_committed)
            sample = odom if odom is not None else (
                self._odom_latest() if self._odom_latest is not None else None
            )
            self._state.set_odom_anchor_xy(0.0, 0.0)
            if sample is not None and self._refiner is not None:
                T_odom_base = pose_to_matrix(sample.position, sample.orientation)
                base_world = T_committed @ T_odom_base
                floor_y = float(base_world[1, 3])
                self._refiner.set_floor_lock(floor_y)

    def clear(self) -> None:
        self._state.clear()
        if self._refiner is not None:
            self._refiner.clear_refinement_baseline()
            self._refiner.clear_floor_lock()

    def apply_runtime_transform(
        self,
        T_world_odom: np.ndarray,
        *,
        update_refiner_baseline: bool = True,
    ) -> None:
        """Apply a live world←odom update after registration commit (runtime refinement)."""
        if not self._state.is_committed:
            raise RuntimeError("apply_runtime_transform requires committed world frame")
        self._state.apply_transform(T_world_odom)
        T_live = self._state.current_transform()
        if T_live is None:
            raise RuntimeError("WorldFrameState has no transform after apply_runtime_transform")
        if update_refiner_baseline and self._refiner is not None:
            self._refiner.set_refinement_baseline(T_live)
        self._publish_world_odom_tf(T_live)

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
