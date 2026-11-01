from dataclasses import dataclass
import math
import time
from typing import Any, Literal

from dimos.ar.manipulation.ports import ManipulationBackend
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


@dataclass(frozen=True)
class OperationOutcome:
    id: str
    status: Literal["completed", "failed"]
    phase: str
    message: str | None = None


@dataclass
class ManipulationOperation:
    plan: dict[str, Any] | None = None
    id: str | None = None
    kind: Literal["executing", "resetting", "parking"] | None = None
    final_gripper: tuple[str, float, dict[str, float]] | None = None
    gripper_completion_at: float | None = None
    phase: str = "motion"
    endpoint_pose: Any = None
    group: str | None = None
    started_at: float | None = None
    settled_at: float | None = None
    outcome: OperationOutcome | None = None
    stalled_at: float | None = None
    progress_pose: tuple[float, float] | None = None
    last_measurement_ts: float | None = None
    last_diagnostic_at: float = 0.0

    def clear(self) -> None:
        self.outcome = None
        self.phase = "motion"
        self.endpoint_pose = None
        self.group = None
        self.started_at = self.settled_at = None
        self.stalled_at = None
        self.progress_pose = None
        self.last_measurement_ts = None
        self.plan = None
        self.id = None
        self.kind = None
        self.final_gripper = None
        self.gripper_completion_at = None

    @property
    def completed_id(self) -> str | None:
        return self.outcome.id if self.outcome and self.outcome.status == "completed" else None

    @property
    def failed_id(self) -> str | None:
        return self.outcome.id if self.outcome and self.outcome.status == "failed" else None

    @property
    def gripper_error(self) -> str | None:
        return self.outcome.message if self.outcome else None

    def finish(self, status: Literal["completed", "failed"], message: str | None = None) -> bool:
        assert self.id is not None
        outcome = OperationOutcome(self.id, status, self.phase, message)
        self.clear()
        self.outcome = outcome
        self.phase = outcome.phase
        logger.info(
            "Arm operation finished",
            operation_id=outcome.id,
            status=status,
            phase=outcome.phase,
            message=message,
        )
        return True

    def advance(
        self, backend: ManipulationBackend, *, stopped: bool, feedback_max_age_s: float
    ) -> bool:
        if self.id is None or self.kind in {"resetting", "parking"}:
            return False
        state = backend.get_state()
        active = state.execution_status.name in {"ACCEPTED", "EXECUTING"}
        now = time.monotonic()
        observed = state.groups.get(self.group) if self.group else None
        pose = observed.end_effector_pose if observed else None
        target = self.endpoint_pose
        near = False
        distance = angle = None
        if (
            observed is not None
            and target is not None
            and pose is not None
            and observed.joints is not None
            and 0 <= time.time() - observed.joints.ts <= feedback_max_age_s
        ):
            distance = math.sqrt(
                sum(
                    (getattr(pose.position, axis) - getattr(target.position, axis)) ** 2
                    for axis in ("x", "y", "z")
                )
            )
            dot = abs(
                sum(
                    getattr(pose.orientation, axis) * getattr(target.orientation, axis)
                    for axis in ("x", "y", "z", "w")
                )
            )
            angle = 2 * math.acos(min(1, dot))
            near = distance <= 0.030 and angle <= math.radians(8)
        eligible = (
            near
            and not stopped
            and self.started_at is not None
            and now - self.started_at >= (self.plan or {}).get("duration", 0) * 0.95
        )
        self.settled_at = (
            (self.settled_at if self.settled_at is not None else now) if eligible else None
        )
        measurement_ts = observed.joints.ts if observed and observed.joints else None
        new_measurement = measurement_ts is not None and (
            self.last_measurement_ts is None or measurement_ts > self.last_measurement_ts
        )
        self.last_measurement_ts = measurement_ts
        if now - self.last_diagnostic_at >= 1:
            self.last_diagnostic_at = now
            logger.debug(
                "Arm completion check",
                operation_id=self.id,
                distance_m=distance,
                orientation_rad=angle,
                settled_at=self.settled_at,
                measurement_ts=measurement_ts,
                execution=state.execution_status.name,
            )

        final_phase = (
            getattr(backend, "endpoint_holding", False)
            or state.execution_status.name == "COMPLETED"
        )
        if (
            final_phase
            and new_measurement
            and distance is not None
            and angle is not None
            and not near
        ):
            previous = self.progress_pose
            if (
                previous is None
                or abs(previous[0] - distance) >= 0.002
                or abs(previous[1] - angle) >= math.radians(0.5)
            ):
                self.progress_pose = (distance, angle)
                self.stalled_at = now
            elif self.stalled_at is not None and now - self.stalled_at >= 2:
                receipt = backend.cancel()
                if receipt.status.name not in {"UNCERTAIN", "FAULT"}:
                    return self.finish("failed", "Target not reached")
        if (
            self.phase == "motion"
            and not active
            and state.execution_status.name in {"ABORTED", "FAULT", "FAILED", "CANCELLED"}
        ):
            return self.finish("failed", "Target not reached")
        if (
            self.phase == "motion"
            and state.execution_status.name == "COMPLETED"
            and target is not None
            and (not new_measurement or self.settled_at is None or now - self.settled_at < 0.5)
        ):
            return False
        if self.phase == "motion":
            completed = state.execution_status.name == "COMPLETED"
            if active:
                if not new_measurement or self.settled_at is None or now - self.settled_at < 0.5:
                    return False
                receipt = backend.cancel()
                if receipt.status.name in {"UNCERTAIN", "FAULT"}:
                    return False
                completed = True
            if not completed or stopped:
                return False
            if self.final_gripper is None:
                return self.finish("completed")
            self.phase = "gripper"
            self.gripper_completion_at = now
        deferred = self.final_gripper
        if deferred is None or stopped:
            return False
        group, value, endpoint = deferred
        observed = state.groups.get(group)
        if (
            observed
            and observed.joints
            and 0 <= time.time() - observed.joints.ts <= feedback_max_age_s
        ):
            actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
            confirmed = (
                near
                if target is not None
                else all(abs(actual.get(j, float("inf")) - q) <= 0.02 for j, q in endpoint.items())
            )
            if confirmed:
                # Command acknowledgement is the gripper outcome. Closing on an object
                # cannot require measured opening to reach zero. Retire before calling
                # the bridge so repeated polling cannot send the action twice.
                self.final_gripper = None
                accepted = getattr(backend, "gripper_target", None)
                current = (
                    accepted
                    if isinstance(accepted, (int, float))
                    else getattr(observed, "gripper_position", None)
                )
                if not isinstance(current, (int, float)) or abs(current - value) > 0.02:
                    try:
                        command = backend.set_gripper_position(value, planning_group=group)
                    except Exception as exc:  # noqa: BLE001 — retire uncertain RPCs without retry
                        return self.finish("failed", f"Gripper acknowledgement failed: {exc}")
                    if command.status.name != "SUCCEEDED":
                        return self.finish("failed", command.message or "Gripper command rejected")
                return self.finish("completed")
        if self.gripper_completion_at is not None and now - self.gripper_completion_at >= 2:
            return self.finish("failed", "Gripper action skipped: endpoint not confirmed")
        return False
