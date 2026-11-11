from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING, Any
import xml.etree.ElementTree as ET

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
