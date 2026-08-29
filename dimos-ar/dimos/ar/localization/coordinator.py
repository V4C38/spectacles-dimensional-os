from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.types import (
    LocalizationProviderType,
    LocalizationResult,
    LocalizedPose,
    Localizer,
    Observation,
)
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.robot.odometry_correction import correct_odom_xy
from dimos.msgs.geometry_msgs.Transform import Transform


@dataclass(frozen=True)
class LocalizationOutcome:
    result: LocalizationResult | None = None
    used_vps: bool = False
    defer_vps: bool = False


class LocalizationCoordinator:
    def __init__(
        self,
        *,
        policy: LocalizationPolicy,
        odom_map_transform: OdomMapTransform,
        robot_observations: RobotObservationBuffer,
        marker: Localizer | None,
        vps: Localizer | None,
        odom_scale_correction_factor: float,
        map_code: str | None = None,
    ) -> None:
        self._policy = policy
        self._odom_map_transform = odom_map_transform
        self._robot_observations = robot_observations
        self._marker = marker
        self._vps = vps
        self._odom_scale_correction_factor = odom_scale_correction_factor
        self._map_code = map_code

    def on_relocalization_transform(self, transform: Transform, *, ts_server: float) -> bool:
        return self._odom_map_transform.update_from_relocalization(
            transform, ts_server=ts_server
        )

    def run(self, observations: Sequence[Observation]) -> LocalizationOutcome:
        if not observations:
            return LocalizationOutcome()
        ts_server = max(observation.ts_server for observation in observations)
        if (
            self._marker is not None
            and LocalizationProviderType.FIDUCIAL_MARKER in self._policy.providers
        ):
            localized = self._marker.localize(list(observations))
            if localized is not None:
                return LocalizationOutcome(
                    result=self._result_in_odom(localized, ts_server),
                    used_vps=False,
                )
        if self._vps is None or LocalizationProviderType.VPS not in self._policy.providers:
            return LocalizationOutcome()
        if not self._policy.client_vps_ready():
            return LocalizationOutcome(defer_vps=True)
        return self._run_client_vps(observations, ts_server)

    def _run_client_vps(
        self, observations: Sequence[Observation], ts_server: float
    ) -> LocalizationOutcome:
        if not self._ensure_vps_anchor():
            return LocalizationOutcome(used_vps=True)
        vps = self._vps
        if vps is None:
            return LocalizationOutcome(used_vps=True)
        self._policy.begin_client_vps()
        localized = vps.localize([observations[-1]])
        if localized is None:
            return LocalizationOutcome(used_vps=True)
        odom_pose = self._odom_map_transform.localization_in_odom(localized)
        if odom_pose is None:
            return LocalizationOutcome(used_vps=True)
        return LocalizationOutcome(
            result=self._result_in_odom(odom_pose, ts_server),
            used_vps=True,
        )

    def _ensure_vps_anchor(self) -> bool:
        if self._odom_map_transform.is_vps_reusable(current_travel_m=self._policy.travel_m):
            return True
        if not self._policy.robot_vps_ready():
            return False
        sample = self._robot_observations.newest()
        vps = self._vps
        if sample is None or vps is None:
            return False
        self._policy.begin_robot_vps()
        localized = vps.localize([sample.observation])
        if localized is None:
            return False
        return self._odom_map_transform.update_from_vps(
            localized,
            ts_server=sample.observation.ts_server,
            travel_m=sample.travel_m,
            map_code=self._map_code,
        )

    def _result_in_odom(self, localized: LocalizedPose, ts_server: float) -> LocalizationResult:
        if localized.frame_id != "odom":
            raise ValueError(
                f"localization_result expects frame_id='odom', got {localized.frame_id!r}"
            )
        x, y = correct_odom_xy(
            localized.pose.x,
            localized.pose.y,
            factor=self._odom_scale_correction_factor,
        )
        return LocalizationResult(
            position=(x, y, localized.pose.z),
            orientation=(
                localized.pose.orientation.x,
                localized.pose.orientation.y,
                localized.pose.orientation.z,
                localized.pose.orientation.w,
            ),
            confidence=localized.confidence,
            ts_server=ts_server,
        )
