from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from dimos.ar.manipulation.errors import ManipulationError
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.manipulation.runtime import ManipulationRuntime

logger = setup_logger()


class JointZeroOperation:
    def __init__(self, runtime: ManipulationRuntime) -> None:
        self.runtime = runtime

    def run(self, client_id: str, group: str, speed: float, shutdown: bool) -> dict[str, Any]:
        runtime = self.runtime
        with runtime.lock:
            if shutdown:
                if runtime.session.stopped or runtime.session.cancelling:
                    runtime.session.shutdown = True
                    if runtime.session.stop_confirmed:
                        runtime.adapter.quiesce()
                        runtime.session.quiesced = True
                    return {
                        "status": "skipped",
                        "message": "Emergency stop active; automatic motion skipped",
                        "quiescent": runtime.session.quiesced,
                    }
            else:
                runtime.require_owner(client_id, group)
            runtime.fresh(group)
            # Acquire before changing ownership: a rejected reset cannot retire a planner.
            if not runtime.planning.acquire(blocking=False):
                raise ManipulationError("busy", "Planning is pending; retry reset")
            runtime.retire()
            epoch = runtime.session.generation
            runtime.session.owner, runtime.session.group_id = client_id, group
            runtime.operation.id = uuid4().hex
            runtime.operation.kind = "parking" if shutdown else "resetting"
            if shutdown:
                runtime.session.shutdown = True

        def require_current() -> None:
            if (
                runtime.session.generation != epoch
                or runtime.session.stopped
                or runtime.session.cancelling
            ):
                raise ManipulationError(
                    "ownership", "Reset interrupted by stop or ownership change"
                )

        operation_deadline = time.monotonic() + 55
        try:
            with runtime.lock:
                require_current()
                runtime.clear_following()
                ready = runtime.adapter.reset()
                if not ready.succeeded:
                    runtime.session.stopped = True
                    runtime.session.stop_confirmed = False
                    raise ValueError(ready.message)
            definition = next(g for g in runtime.adapter.list_planning_groups() if g.id == group)
            joints = list(definition.joint_names)
            target = JointState(name=joints, position=[0.0] * len(joints))
            # An arm already at zero needs only new settled observations, no new trajectory.
            observed = runtime.fresh(group)
            actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
            already_zero = all(abs(actual.get(name, float("inf"))) <= 0.02 for name in joints)
            planned = (
                None
                if already_zero
                else runtime.adapter.plan_to_joints(
                    {group: target}, speed_scale=min(speed, 0.2) if shutdown else speed
                )
            )
            with runtime.lock:
                require_current()
                if planned is not None and (not planned.succeeded or planned.plan is None):
                    raise ValueError(planned.message)
                if planned is not None:
                    result = runtime.adapter.execute(blocking=False, plan_id=planned.plan.plan_id)
                    if result.status.name not in {"ACCEPTED", "COMPLETED", "SUCCEEDED"}:
                        raise ValueError(result.message)
            started = time.monotonic()
            nominal_end = started + (planned.plan.trajectory.duration if planned is not None else 0)
            deadline = min(operation_deadline, nominal_end + 3.0)
            settled: float | None = None
            last_measurement = float("-inf")
            last_log = float("-inf")
            while time.monotonic() < deadline:
                with runtime.lock:
                    require_current()
                observed = runtime.fresh(group)
                actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
                now = time.monotonic()
                if now - last_log >= 0.5:
                    worst = max(joints, key=lambda name: abs(actual.get(name, float("inf"))))
                    logger.info(
                        "Arm settling",
                        operation=runtime.operation.kind,
                        elapsed_s=round(now - started, 2),
                        joint=worst,
                        error_rad=round(abs(actual.get(worst, float("inf"))), 4),
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
                        abs(actual.get(name, float("inf"))) <= 0.02 for name in joints
                    ):
                        if settled is None:
                            settled = now
                        if now - settled >= 0.5:
                            with runtime.lock:
                                require_current()
                                # Approximate measured arrival is sufficient. The official
                                # reset confirms stopping and returns to IDLE even if the
                                # executor has not declared its exact endpoint complete.
                                ready = runtime.adapter.reset()
                                if not ready.succeeded:
                                    runtime.session.stopped = True
                                    runtime.session.stop_confirmed = False
                                    raise ValueError(ready.message)
                                if shutdown:
                                    runtime.adapter.quiesce()
                                    runtime.session.quiesced = True
                                return {
                                    "status": "completed",
                                    "message": "Zero pose confirmed",
                                    "quiescent": runtime.session.quiesced,
                                }
                    else:
                        settled = None
                time.sleep(0.05)
            worst = max(joints, key=lambda name: abs(actual.get(name, float("inf"))))
            raise ValueError(
                f"Zero pose not confirmed: {worst} error "
                f"{abs(actual.get(worst, float('inf'))):.4f} rad "
                "(tolerance 0.0200 rad); settling deadline reached"
            )
        except Exception:
            with runtime.lock:
                # An obsolete worker must never stop or reset a newer operation.
                if runtime.session.generation == epoch and not runtime.session.stopped:
                    try:
                        ready = runtime.adapter.reset()
                    except Exception:
                        runtime.session.stopped = True
                        runtime.session.stop_confirmed = False
                        raise
                    if not ready.succeeded:
                        runtime.session.stopped = True
                        runtime.session.stop_confirmed = False
                    elif shutdown:
                        runtime.adapter.quiesce()
                        runtime.session.quiesced = True
            raise
        finally:
            with runtime.lock:
                if runtime.session.generation == epoch:
                    runtime.retire()
            runtime.planning.release()
