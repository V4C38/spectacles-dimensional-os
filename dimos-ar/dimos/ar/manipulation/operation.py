"""Independent execution, session, following-tail, and safe-zero lifecycles."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
import math
import time
from typing import TYPE_CHECKING, Any, Literal
import xml.etree.ElementTree as ET

from dimos.ar.manipulation.model import pose_error
from dimos.ar.manipulation.ports import ManipulationBackend
from dimos.ar.manipulation.protocol import ManipulationError
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.manipulation.runtime import ManipulationRuntime

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
    admitting: bool = False
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
        self.admitting = False
        self.kind = None
        self.final_gripper = None
        self.gripper_completion_at = None

    @property
    def published_phase(self) -> str | None:
        return self.phase if self.id is not None else self.outcome.phase if self.outcome else None

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
        if self.id is None or self.admitting or self.kind in {"resetting", "parking"}:
            return False
        state = backend.get_state()
        if state.execution_status.name in {"IDLE", "UNCERTAIN"}:
            return False
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
            distance, angle = pose_error(pose, target)
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
            backend.endpoint_holding
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
                accepted = backend.gripper_target
                current = (
                    accepted
                    if isinstance(accepted, (int, float))
                    else getattr(observed, "gripper_position", None)
                )
                if not isinstance(current, (int, float)) or abs(current - value) > 0.02:
                    try:
                        command = backend.set_gripper_position(value, planning_group=group)
                    except Exception as exc:  # noqa: BLE001 — uncertain hardware RPCs must not be retried
                        return self.finish("failed", f"Gripper acknowledgement failed: {exc}")
                    if command.status.name != "SUCCEEDED":
                        return self.finish("failed", command.message or "Gripper command rejected")
                return self.finish("completed")
        if self.gripper_completion_at is not None and now - self.gripper_completion_at >= 2:
            return self.finish("failed", "Gripper action skipped: endpoint not confirmed")
        return False


@dataclass
class ManipulationSession:
    owner: str | None = None
    group_id: str | None = None
    token: str | None = None
    sequence: int = -1
    updated_at: float = 0.0
    target_key: tuple[float, ...] | None = None
    rejected_key: tuple[float, ...] | None = None
    generation: int = 0
    retired: OrderedDict[str, None] = field(default_factory=OrderedDict)
    cancelling: bool = False
    stopped: bool = False
    stop_confirmed: bool = True
    shutdown: bool = False
    quiesced: bool = False

    def retire_client(self, client_id: str) -> None:
        self.retired[client_id] = None
        self.retired.move_to_end(client_id)
        # The native authority fence rejects old queued envelopes independently.
        while len(self.retired) > 256:
            self.retired.popitem(last=False)

    def retire(self) -> None:
        self.generation += 1
        self.target_key = self.rejected_key = None
        self.token = None
        self.owner = None
        self.group_id = None


@dataclass
class FollowingTail:
    generation: int
    group_id: str
    target_revision: int
    epoch: str
    body: dict[str, Any]
    joints: dict[str, float] | None
    started_at: float
    refreshed_at: float = float("-inf")
    joint_tolerance: float = 0.02
    settled_at: float | None = None
    last_measurement: float | None = None
    target_pose: Any = None
    continuous_joints: frozenset[str] = frozenset()
    last_joints: dict[str, float] | None = None
    stalled_at: float | None = None
    progress_error: tuple[float, float] | None = None

    def wire(self) -> dict[str, Any]:
        return {
            "generation": self.generation,
            "group_id": self.group_id,
            "target_revision": self.target_revision,
            "status": "finishing",
            "position": list(self.body["position"]),
            "orientation": list(self.body["orientation"]),
            "speed_scale": self.body["speed_scale"],
            **({"joints": dict(self.joints)} if self.joints is not None else {}),
        }

    def arrived(self, observation: Any, *, now: float) -> bool:
        stamp = float(observation.joints.ts)
        if self.last_measurement is not None and stamp <= self.last_measurement:
            return False
        previous_stamp = self.last_measurement
        previous_joints = self.last_joints
        self.last_measurement = stamp
        actual = dict(zip(observation.joints.name, observation.joints.position, strict=True))
        self.last_joints = actual
        velocities = getattr(observation.joints, "velocity", None)
        if velocities and len(velocities) == len(actual):
            stationary = all(math.isfinite(v) and abs(v) <= 0.05 for v in velocities)
        else:
            stationary = (
                previous_stamp is not None
                and previous_joints is not None
                and all(
                    name in previous_joints
                    and math.isfinite(value)
                    and abs(self.joint_delta(name, value, previous_joints[name]))
                    / (stamp - previous_stamp)
                    <= 0.05
                    for name, value in actual.items()
                )
            )
        stationary = bool(actual) and all(math.isfinite(v) for v in actual.values()) and stationary
        pose = getattr(observation, "end_effector_pose", None)
        if pose is not None and self.target_pose is not None:
            distance, angle = pose_error(pose, self.target_pose)
            close = distance <= 0.01 and angle <= math.radians(3)
            error = (distance, angle)
        else:
            delta = max(
                (
                    abs(self.joint_delta(name, actual.get(name, float("inf")), value))
                    for name, value in (self.joints or {}).items()
                ),
                default=float("inf"),
            )
            close = math.isfinite(delta) and delta <= self.joint_tolerance
            error = (delta, 0.0)
        if stationary and not close:
            previous_error = self.progress_error
            if (
                self.stalled_at is None
                or previous_error is None
                or previous_error[0] - error[0] >= 0.002
                or previous_error[1] - error[1] >= math.radians(0.5)
            ):
                self.stalled_at = now
                self.progress_error = error
        else:
            self.stalled_at = None
            self.progress_error = None
        self.settled_at = (
            (self.settled_at if self.settled_at is not None else now)
            if close and stationary
            else None
        )
        return self.settled_at is not None and now - self.settled_at >= 0.5

    def stalled(self, *, now: float) -> bool:
        return self.stalled_at is not None and now - self.stalled_at >= 2

    def joint_delta(self, name: str, current: float, expected: float) -> float:
        delta = current - expected
        if name in self.continuous_joints and math.isfinite(delta):
            return math.atan2(math.sin(delta), math.cos(delta))
        return delta


class JointZeroOperation:
    def __init__(self, runtime: ManipulationRuntime) -> None:
        self.runtime = runtime

    def run(self, client_id: str, group: str, speed: float, shutdown: bool) -> dict[str, Any]:
        runtime = self.runtime
        tolerance = runtime.config.joint_arrival_tolerance_rad
        skipped = runtime.skip_zero(shutdown)
        if skipped is not None:
            return skipped
        epoch = runtime.begin_zero(client_id, group, shutdown)

        def require_current() -> None:
            runtime.require_zero_current(epoch)

        operation_deadline = time.monotonic() + 55
        try:
            require_current()
            runtime.clear_following()
            require_current()
            ready = runtime.adapter.reset()
            runtime.confirm_zero_reset(epoch, ready)
            definition = next(g for g in runtime.adapter.list_planning_groups() if g.id == group)
            joints = list(definition.joint_names)
            bounds = {
                j.attrib["name"]: dict(limit.attrib)
                for j in ET.fromstring(runtime.config.model.model.load().xml).findall("joint")
                if (limit := j.find("limit")) is not None
            }
            positions = [
                max(
                    float(bounds[n]["lower"]) + math.radians(3),
                    min(0.0, float(bounds[n]["upper"]) - math.radians(3)),
                )
                if bounds.get(n) is not None
                else 0.0
                for n in joints
            ]
            target = JointState(name=joints, position=positions)
            expected = dict(zip(joints, positions, strict=True))
            logger.info("Safe zero target", joints=expected)
            # An arm already at zero needs only new settled observations, no new trajectory.
            observed = runtime.fresh(group)
            actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
            already_zero = all(
                abs(actual.get(name, float("inf")) - expected[name]) <= tolerance for name in joints
            )
            planned = (
                None
                if already_zero
                else runtime.adapter.plan_to_joints(
                    {group: target}, speed_scale=min(speed, 0.2) if shutdown else speed
                )
            )
            require_current()
            if planned is not None and (not planned.succeeded or planned.plan is None):
                raise ValueError(planned.message)
            if planned is not None:
                result = runtime.adapter.execute(blocking=False, plan_id=planned.plan.plan_id)
                require_current()
                if result.status.name not in {"ACCEPTED", "COMPLETED", "SUCCEEDED"}:
                    raise ValueError(result.message)
            started = time.monotonic()
            nominal_end = started + (planned.plan.trajectory.duration if planned is not None else 0)
            deadline = min(operation_deadline, nominal_end + 3.0)
            settled: float | None = None
            last_measurement = float("-inf")
            last_log = float("-inf")
            while time.monotonic() < deadline:
                require_current()
                observed = runtime.fresh(group)
                actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
                now = time.monotonic()
                if now - last_log >= 0.5:
                    worst = max(joints, key=lambda name: abs(actual.get(name, float("inf")) - expected[name]))
                    logger.info(
                        "Arm settling",
                        operation=runtime.operation.kind,
                        elapsed_s=round(now - started, 2),
                        joint=worst,
                        error_rad=round(abs(actual.get(worst, float("inf")) - expected[worst]), 4),
                        feedback_age_s=round(time.time() - observed.joints.ts, 3),
                    )
                    last_log = now
                if not already_zero and runtime.adapter.get_state().execution_status.name in {
                    "FAULT",
                    "UNCERTAIN",
                    "ABORTED",
                    "REJECTED",
                }:
                    raise ManipulationError("rejected", "Zero trajectory failed")
                # Repeated publication of one cached sample must not establish settling.
                if observed.joints.ts > last_measurement:
                    last_measurement = observed.joints.ts
                    if now >= nominal_end and all(
                        abs(actual.get(name, float("inf")) - expected[name]) <= tolerance
                        for name in joints
                    ):
                        if settled is None:
                            settled = now
                        if now - settled >= 0.5:
                            require_current()
                            ready = runtime.adapter.reset()
                            runtime.confirm_zero_reset(epoch, ready)
                            if shutdown:
                                runtime.quiesce_zero(epoch)
                            return {"status": "completed", "message": "Zero pose confirmed",
                                    "quiescent": runtime.session.quiesced}
                    else:
                        settled = None
                time.sleep(0.05)
            worst = max(joints, key=lambda name: abs(actual.get(name, float("inf")) - expected[name]))
            raise ValueError(
                f"Zero pose not confirmed: {worst} error "
                f"{abs(actual.get(worst, float('inf')) - expected[worst]):.4f} rad "
                f"(tolerance {tolerance:.4f} rad); settling deadline reached"
            )
        except Exception:
            runtime.fail_zero(epoch, shutdown)
            raise
        finally:
            runtime.finish_zero(epoch)
