"""Explicit wire/planning frame transforms; never rename a pose's frame."""

from __future__ import annotations

import math

import numpy as np
from pydantic import BaseModel, model_validator
from scipy.spatial.transform import Rotation


class ReferencePose(BaseModel):
    position: tuple[float, float, float] = (0, 0, 0)
    orientation: tuple[float, float, float, float] = (0, 0, 0, 1)

    @model_validator(mode="after")
    def validate_rigid_pose(self) -> ReferencePose:
        if not all(math.isfinite(v) for v in (*self.position, *self.orientation)):
            raise ValueError("reference pose must be finite")
        if not math.isclose(sum(v * v for v in self.orientation), 1, abs_tol=1e-5):
            raise ValueError("reference orientation must be a unit quaternion")
        return self

    def transform(
        self, position: list[float], orientation: list[float], *, inverse: bool = False
    ) -> tuple[list[float], list[float]]:
        rotation = Rotation.from_quat(self.orientation)
        if inverse:
            return rotation.inv().apply(np.asarray(position) - self.position).tolist(), (
                rotation.inv() * Rotation.from_quat(orientation)
            ).as_quat().tolist()
        return (rotation.apply(position) + self.position).tolist(), (
            rotation * Rotation.from_quat(orientation)
        ).as_quat().tolist()
