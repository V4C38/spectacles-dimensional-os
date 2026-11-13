from __future__ import annotations

from copy import copy
import threading
import time
from typing import Any, cast
from uuid import uuid4

from dimos.ar.manipulation.model import describe_model
from dimos.ar.manipulation.operation import (
    CachedEvaluation,
    FollowingTail,
    FollowingTarget,
    JointZeroOperation,
    ManipulationOperation,
    ManipulationSession,
    NativeAdmission,
    PlanPreview,
    TargetRetirement,
)
from dimos.ar.manipulation.ports import ManipulationBackend
from dimos.ar.manipulation.protocol import (
    ExecutionNotStartedError,
    ManipulationError,
    decode_request,
    rejection_result,
    spatial_error_code,
)
from dimos.ar.numeric import measurement_is_fresh
from dimos.ar.replication.manipulation_authority import (
    ManipulationAdmission,
    ManipulationAuthorityFence,
)
from dimos.core.global_config import global_config
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class ManipulationRuntime:
    def __init__(self, adapter: ManipulationBackend) -> None:
        self.adapter = adapter
        self.config = adapter.config
        self.session = ManipulationSession()
        self.operation = ManipulationOperation()
        self.lock = threading.RLock()
        self.planning = threading.Lock()
        self.evaluation_planning = threading.Lock()
        self.zero = JointZeroOperation(self)
        self.descriptor: dict[str, Any] | None = None
        self.started = False
        self._pending_native: NativeAdmission | None = None
        self._target_retirement: TargetRetirement | None = None
        self._authority = ManipulationAuthorityFence()
        self._following_target: FollowingTarget | None = None
        self.following_tail: FollowingTail | None = None
        self._following_failure: str | None = None
        self.evaluation: CachedEvaluation | None = None
        self._control_epoch: str | None = None
        self._control_deadline = 0.0
        self._control_revision = -1
        self._reconnect_deadline = 0.0
        self._retired_control_epochs: set[str] = set()

    def start(self) -> None:
        with self.lock:
            self.started = True

    @property
    def quiesced(self) -> bool:
        with self.lock:
            return self.session.quiesced

    def authority(self) -> ManipulationAuthorityFence:
        return self._authority

    def heartbeat(self, epoch: str, revision: int, deadline: float) -> None:
        import math

        now = time.monotonic()
        if not epoch or not math.isfinite(deadline) or not now < deadline <= now + 1:
            raise ValueError("invalid control-plane heartbeat")
        with self.lock:
            if epoch in self._retired_control_epochs:
                return
            prior = self._control_epoch
            changed = prior is not None and prior != epoch
        if changed:
            self.emergency_stop()
        with self.lock:
            prior = self._control_epoch
            if epoch in self._retired_control_epochs:
                return
            if prior is not None and prior != epoch:
                self._retired_control_epochs.add(prior)
                self._authority = ManipulationAuthorityFence()
            if prior == epoch and revision < self._control_revision:
                return
            self._control_epoch, self._control_revision = epoch, revision
            self._control_deadline = deadline

    def revoke_authority(
        self, epoch: str, lease: str, revision: int, reason: str = "released"
    ) -> None:
        retire_generation = None
        with self.lock:
            if reason == "superseded":
                if self.authority().supersede(epoch, revision):
                    if self.session.token is not None or self.following_tail:
                        retire_generation = self.session.generation
                    else:
                        self.session.generation += 1
            else:
                was_current = self.authority().lease == lease
                if not self.authority().revoke(epoch, lease, revision):
                    return
                if reason == "target_changed":
                    previous = self._target_retirement
                    floor = (
                        previous.revision
                        if previous is not None and previous.epoch == epoch
                        else -1
                    )
                    self._target_retirement = TargetRetirement(epoch, max(floor, revision))
                if self.session.token is not None and was_current:
                    cached = self._following_target
                    feedback = self.adapter.feedback
                    fresh = feedback is not None and measurement_is_fresh(
                        feedback.ts, time.time(), self.config.feedback_max_age_s
                    )
                    if (
                        reason == "released"
                        and cached is not None
                        and not self.session.stopped
                        and fresh
                    ):
                        group, body, joints, target_revision = cached
                        self.session.retire()
                        self.following_tail = FollowingTail(
                            revision,
                            group,
                            target_revision,
                            epoch,
                            body,
                            joints,
                            time.monotonic(),
                            joint_tolerance=self.config.joint_arrival_tolerance_rad,
                            target_pose=self.pose(body),
                            continuous_joints=frozenset(
                                joint["name"]
                                for joint in (self.descriptor or {}).get("joints", [])
                                if joint.get("kind") == "continuous"
                            ),
                        )
                        self._following_target = None
                    else:
                        retire_generation = self.session.generation
                elif reason not in {"released", "target_changed"}:
                    self.session.generation += 1
        if retire_generation is not None:
            self.retire_following(retire_generation)

    def fresh(self, group: str) -> Any:
        state = self.adapter.get_state()
        observed = state.groups.get(group)
        if observed is None:
            raise ManipulationError("rejected", "unknown planning group")
        if observed.joints is None or not measurement_is_fresh(
            observed.joints.ts, time.time(), self.config.feedback_max_age_s
        ):
            raise ManipulationError("stale_feedback", "joint feedback is stale or unavailable")
        return observed

    def target_retired(self, admission: ManipulationAdmission | None) -> bool:
        retirement = self._target_retirement
        return bool(
            admission is not None
            and retirement is not None
            and retirement.epoch == admission.epoch
            and admission.revision <= retirement.revision
        )

    def require_admission(
        self, admission: ManipulationAdmission | None, *, allow_released: bool = False
    ) -> None:
        if admission is None:
            return
        if (
            admission.epoch != self._control_epoch
            or time.monotonic() >= min(admission.deadline, self._control_deadline)
            or not self.authority().current(admission, planning=allow_released)
            or self.target_retired(admission)
        ):
            raise ExecutionNotStartedError("retired", "native command authority retired")

    def require_owner(self, client_id: str, group: str) -> None:
        if (
            self.session.shutdown
            or client_id in self.session.retired
            or self.session.stopped
            or self.session.cancelling
        ):
            raise ManipulationError("retired", "connection retired or manipulation stopped")
        if self.session.owner not in (None, client_id) or self.session.group_id not in (
            None,
            group,
        ):
            raise ManipulationError(
                "ownership", "manipulation is owned by another connection or group"
            )

    def retire(self) -> None:
        self._pending_native = None
        self.evaluation = None
        self.following_tail = None
        self._following_failure = None
        self._following_target = None
        self.session.retire()
        self.operation.clear()

    def clear_following(self) -> None:
        failures: list[Exception] = []
        for task in self.config.following_tasks.values():
            try:
                self.adapter.task_invoke(task, "clear")
            except Exception as exc:
                logger.exception("Failed to clear manipulation following task", task=task)
                failures.append(exc)
        if failures:
            raise failures[0]

    def retire_following(self, expected_generation: int | None = None) -> bool:
        with self.lock:
            if expected_generation is not None and expected_generation != self.session.generation:
                return False
            self.retire()
            generation = self.session.generation
            pending = NativeAdmission("clear_following", generation)
            self._pending_native = pending
        try:
            self.clear_following()
        except Exception:
            logger.exception("Following release failed; stopping native manipulation")
            self.emergency_stop()
            raise
        finally:
            with self.lock:
                if self._pending_native == pending:
                    self._pending_native = None
        return True

    def skip_zero(self, shutdown: bool) -> dict[str, Any] | None:
        with self.lock:
            if not shutdown or not (self.session.stopped or self.session.cancelling):
                return None
            self.session.request_shutdown()
            generation = self.session.generation
            quiesce = self.session.stop_confirmed
        if quiesce:
            self.adapter.quiesce()
            with self.lock:
                if generation == self.session.generation:
                    self.session.confirm_quiesced(generation)
        return {
            "status": "skipped",
            "message": "Emergency stop active; automatic motion skipped",
            "quiescent": self.session.quiesced,
        }

    def begin_zero(self, client_id: str, group: str, shutdown: bool) -> int:
        self.fresh(group)
        with self.lock:
            if not shutdown:
                self.require_owner(client_id, group)
                if self.operation.id is not None:
                    raise ManipulationError("busy", "execution active or outcome uncertain")
            if not self.planning.acquire(blocking=False):
                raise ManipulationError("busy", "Planning is pending; retry reset")
            self.retire()
            self.session.claim(client_id, group)
            self.operation.begin(uuid4().hex, "parking" if shutdown else "resetting")
            if shutdown:
                self.session.request_shutdown()
            return self.session.generation

    def require_zero_current(self, generation: int) -> None:
        with self.lock:
            if (
                self.session.generation != generation
                or self.session.stopped
                or self.session.cancelling
            ):
                raise ManipulationError(
                    "ownership", "Reset interrupted by stop or ownership change"
                )

    def confirm_zero_reset(self, generation: int, ready: Any) -> None:
        with self.lock:
            self.require_zero_current(generation)
            if not ready.succeeded:
                self.session.latch_stop()
                raise ValueError(ready.message)

    def quiesce_zero(self, generation: int) -> None:
        self.adapter.quiesce()
        with self.lock:
            self.require_zero_current(generation)
            self.session.confirm_quiesced(generation)

    def fail_zero(self, generation: int, shutdown: bool) -> None:
        with self.lock:
            current = self.session.generation == generation and not self.session.stopped
        if not current:
            return
        try:
            ready = self.adapter.reset()
        except Exception:
            with self.lock:
                if self.session.generation == generation:
                    self.session.latch_stop()
            raise
        with self.lock:
            current = self.session.generation == generation
            if current and not ready.succeeded:
                self.session.latch_stop()
        if current and ready.succeeded and shutdown:
            self.adapter.quiesce()
            with self.lock:
                if self.session.generation == generation:
                    self.session.confirm_quiesced(generation)

    def finish_zero(self, generation: int) -> None:
        with self.lock:
            if self.session.generation == generation:
                self.retire()
        self.planning.release()

    def retire_for_teardown(self) -> None:
        with self.lock:
            self.started = False
            self.session.stopped = True
            self.retire()

    def dispatch(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.command(client_id, request)
        except ValueError as exc:
            result = rejection_result(request.get("action"), exc)
            if result["status"] == "infeasible" and request.get("action") == "update":
                self.clear_following()
            if request.get("action") == "prepare_shutdown":
                result["quiescent"] = self.session.quiesced
            return result

    def command(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        # Validate again at the domain boundary, including direct RPC callers.
        message = decode_request({**request, "request_id": "domain"})
        action, group, body = message.action, message.group_id, message.payload
        with self.lock:
            if "authority_epoch" in request and (
                request["authority_epoch"] != self._control_epoch
                or time.monotonic() >= self._control_deadline
            ):
                raise ManipulationError("retired", "control plane retired")
            prior_lease = self.authority().lease
            admission = self.authority().admit(request)
            handover = admission is not None and (
                self.following_tail is not None
                or (prior_lease != admission.lease and self.session.token is not None)
            )
            generation = self.session.generation
        if handover and not self.retire_following(generation):
            raise ManipulationError("retired", "handover retired")
        if action in {"reset_joints", "prepare_shutdown"}:
            return self.zero.run(
                client_id, group, body["speed_scale"], action == "prepare_shutdown"
            )
        if action == "update":
            return self.update(client_id, group, body, admission=admission)
        if action == "cancel":
            return self.cancel(client_id)
        if action == "execute":
            return self.execute(client_id, group, body, admission)
        if action == "release":
            with self.lock:
                self.require_owner(client_id, group)
                if self.session.owner != client_id or self.session.token != body["token"]:
                    raise ManipulationError("retired", "following token retired")
                generation = self.session.generation
            if not self.retire_following(generation):
                raise ManipulationError("retired", "following token retired")
            return {"status": "released"}
        if action in {"acquire", "gripper", "resume"}:
            return self.native_command(client_id, group, action, body, admission)
        return self.plan_or_evaluate(client_id, group, action, body, request, admission)

    def cancel(self, client_id: str) -> dict[str, Any]:
        with self.lock:
            if self.session.owner not in (None, client_id):
                raise ManipulationError("ownership", "cannot cancel another owner's operation")
            was_stopped = self.session.begin_cancel()
            self.retire()
            generation = self.session.generation
        try:
            self.clear_following()
            result = self.adapter.cancel()
        finally:
            with self.lock:
                self.session.cancelling = False
        with self.lock:
            self.session.finish_cancel(
                generation,
                was_stopped=was_stopped,
                confirmed=result.status.name not in {"UNCERTAIN", "FAULT"},
            )
        return {"status": result.status.name.lower(), "message": result.message}

    def plan_or_evaluate(
        self,
        client_id: str,
        group: str,
        action: str,
        body: dict[str, Any],
        request: dict[str, Any],
        admission: ManipulationAdmission | None,
    ) -> dict[str, Any]:
        self.fresh(group)
        execution = self.adapter.get_state().execution_status.name
        with self.lock:
            self.require_owner(client_id, group)
            if self._pending_native is not None and action != "evaluate":
                raise ManipulationError("busy", "native command pending")
            if self.operation.id is not None:
                raise ManipulationError("stopped", "execution active or outcome uncertain")
            if self.session.token is not None and action != "evaluate":
                raise ManipulationError("rejected", "release following before another operation")
            if execution in {"ACCEPTED", "EXECUTING", "UNCERTAIN", "FAULT"}:
                raise ManipulationError("stopped", "execution active or outcome uncertain")
            # Reserve advisory work before changing ownership, plan, or generation.
            # A rejected concurrent request must not retire the request already running.
            planning_lock = self.evaluation_planning if action == "evaluate" else self.planning
            if not planning_lock.acquire(blocking=False):
                raise ManipulationError("busy", "evaluation or planning already pending")
            self._following_failure = None
            if action == "plan":
                self.operation.clear()
                self.session.generation += 1
            epoch = self.session.generation
        try:
            result_body = (
                self.evaluate_pose(group, body)
                if action == "evaluate"
                else self.plan_pose(group, body, admission)
            )
            with self.lock:
                target_retired = self.target_retired(admission)
                generation_changed = epoch != self.session.generation
                client_retired = client_id in self.session.retired
                authority_changed = (
                    admission is not None and self.authority().epoch != admission.epoch
                )
                plan_retired = action == "plan" and (
                    target_retired
                    or (
                        admission is not None
                        and not self.authority().current(admission, planning=True)
                    )
                )
                request_retired = (
                    generation_changed or client_retired or authority_changed or plan_retired
                )
                if not request_retired:
                    if (
                        action == "evaluate"
                        and result_body["status"] == "feasible"
                        and result_body["joints"] is not None
                        and admission is not None
                        and not target_retired
                        and request.get("advisory_current", True)
                        and self.authority().current(admission)
                    ):
                        self.evaluation = CachedEvaluation(
                            group,
                            admission.target_revision,
                            result_body["joints"],
                            result_body["pose"],
                        )
                    if action == "plan":
                        if "final_gripper" in body:
                            result_body["final_gripper"] = body["final_gripper"]
                        self.operation.plan = cast("PlanPreview", result_body)
            if request_retired:
                if action == "plan":
                    self.adapter.clear_planned_path()
                raise ManipulationError("retired", "request retired")
            return result_body
        finally:
            planning_lock.release()

    def evaluate_pose(self, group: str, body: dict[str, Any]) -> dict[str, Any]:
        if not self.adapter.ready:
            raise ManipulationError("rejected", "planning model unavailable")
        evaluation = self.adapter.evaluate(group, self.pose(body))
        return {
            "status": "feasible" if evaluation.success else "infeasible",
            "sample_pose": {"position": body["position"], "orientation": body["orientation"]},
            **(
                {"code": self.adapter.evaluation_code(evaluation)} if not evaluation.success else {}
            ),
            "message": evaluation.message,
            "joints": self.joints(evaluation.target_joints),
            "pose": self.pose_wire(evaluation.group_poses.get(group)),
        }

    def plan_pose(
        self, group: str, body: dict[str, Any], admission: ManipulationAdmission | None
    ) -> dict[str, Any]:
        planned = self.adapter.plan_to_poses(
            {group: self.pose(body)}, speed_scale=body["speed_scale"]
        )
        if not planned.succeeded or planned.plan is None:
            raise ValueError(planned.message)
        plan = planned.plan
        trajectory = plan.trajectory
        if len(trajectory.points) > 8192:
            self.adapter.clear_planned_path()
            raise ManipulationError("rejected", "trajectory exceeds bounded preview size")
        return {
            "status": "planned",
            "group_id": group,
            **({"target_revision": admission.target_revision} if admission else {}),
            "plan_id": plan.plan_id,
            "joint_names": list(trajectory.joint_names),
            "trajectory": [
                {"time": p.time_from_start, "positions": list(p.positions)}
                for p in trajectory.points
            ],
            "duration": trajectory.duration,
            "pose": self.pose_wire(
                self.adapter.endpoint_pose(
                    group,
                    dict(
                        zip(
                            trajectory.joint_names,
                            trajectory.points[-1].positions,
                            strict=True,
                        )
                    ),
                )
            ),
        }

    def native_command(
        self,
        client_id: str,
        group: str,
        action: str,
        body: dict[str, Any],
        admission: ManipulationAdmission | None,
    ) -> dict[str, Any]:
        self.fresh(group)
        execution = self.adapter.get_state().execution_status.name
        with self.lock:
            self.require_admission(admission)
            if self._pending_native is not None:
                raise ManipulationError("busy", "native command pending")
            if action == "resume":
                if client_id in self.session.retired or self._pending_native is not None:
                    raise ManipulationError("retired", "connection retired or command pending")
                if not self.session.stopped or self.session.owner is not None:
                    raise ManipulationError(
                        "ownership", "resume requires stopped, unowned manipulation"
                    )
                if not self.session.stop_confirmed:
                    raise ManipulationError("stopped", "stop was not confirmed")
            else:
                self.require_owner(client_id, group)
                if self.operation.id is not None:
                    raise ManipulationError("stopped", "execution active or outcome uncertain")
                if action == "acquire":
                    if self.session.token is not None:
                        raise ManipulationError(
                            "rejected", "release following before another operation"
                        )
                    if execution in {"ACCEPTED", "EXECUTING", "UNCERTAIN", "FAULT"}:
                        raise ManipulationError("stopped", "execution active or outcome uncertain")
                    if group not in self.config.following_tasks:
                        raise ManipulationError(
                            "rejected", "following is unavailable for this group"
                        )
                if action == "gripper":
                    self.operation.outcome = None
                    self.operation.plan = None
            self.session.generation += 1
            generation = self.session.generation
            self._pending_native = NativeAdmission(action, generation)
        try:
            if action == "resume":
                result = self.adapter.reset()
                if not result.succeeded:
                    raise ValueError(result.message)
                with self.lock:
                    if generation != self.session.generation:
                        raise ManipulationError("retired", "resume retired by stop")
                    self.require_admission(admission)
                if self.adapter.set_estop(False) is False:
                    self.adapter.set_estop(True)
                    raise ManipulationError("stopped", "native resume was not confirmed")
            elif action == "gripper":
                self.adapter.clear_planned_path()
                result = self.adapter.set_gripper_position(body["value"], planning_group=group)
            else:
                result = self.adapter.cancel()
            with self.lock:
                current = generation == self.session.generation
                if current:
                    if action == "resume":
                        self.session.resume()
                        self._following_failure = None
                        return {"status": "resumed"}
                    if action == "gripper":
                        return {
                            "status": "completed" if result.succeeded else "rejected",
                            "message": result.message,
                        }
                    if result.status.name in {"UNCERTAIN", "FAULT"}:
                        self.session.latch_stop()
                        raise ManipulationError("rejected", "could not retire prior motion")
                    self.operation.clear()
                    self._following_failure = None
                    self._following_target = None
                    self.session.acquire_following(
                        client_id, group, uuid4().hex, now=time.monotonic()
                    )
                    return {"status": "acquired", "token": self.session.token}
            if action == "resume":
                self.adapter.set_estop(True)
            raise ManipulationError("retired", "native command retired")
        finally:
            with self.lock:
                if self._pending_native == (action, generation):
                    self._pending_native = None

    def execute(
        self,
        client_id: str,
        group: str,
        body: dict[str, Any],
        admission: ManipulationAdmission | None,
    ) -> dict[str, Any]:
        self.fresh(group)
        execution = self.adapter.get_state().execution_status.name
        with self.lock:
            self.require_owner(client_id, group)
            if self._pending_native is not None:
                raise ManipulationError("busy", "native command pending")
            if self.operation.id is not None or self.session.token is not None:
                raise ManipulationError("stopped", "execution active or following not released")
            if execution in {"ACCEPTED", "EXECUTING", "UNCERTAIN", "FAULT"}:
                raise ManipulationError("stopped", "execution active or outcome uncertain")
            plan = self.operation.plan
            if (
                plan is None
                or plan["plan_id"] != body["plan_id"]
                or plan.get("group_id", group) != group
                or (
                    admission is not None
                    and plan.get("target_revision") != admission.target_revision
                )
            ):
                raise ManipulationError("retired", "reviewed plan was retired or replaced")
            self.session.generation += 1
            generation = self.session.generation
            self.operation.begin(uuid4().hex, "executing", admitting=True)
        try:
            endpoint = dict(
                zip(plan["joint_names"], plan["trajectory"][-1]["positions"], strict=True)
            )
            endpoint_pose = self.adapter.endpoint_pose(group, endpoint)
            with self.lock:
                if generation != self.session.generation or self.session.stopped:
                    raise ExecutionNotStartedError("retired", "execution admission retired")
                self.require_admission(admission, allow_released=True)
            result = self.adapter.execute(blocking=False, plan_id=body["plan_id"])
        except ExecutionNotStartedError:
            with self.lock:
                if generation == self.session.generation:
                    self.operation.clear()
            raise
        except Exception:
            with self.lock:
                current = generation == self.session.generation
            if current:
                self.emergency_stop(expected_generation=generation)
            raise
        if result.status.name in {"UNCERTAIN", "FAULT"}:
            self.emergency_stop(expected_generation=generation)
            return {
                "status": result.status.name.lower(),
                "message": result.message,
                "operation": None,
                "operation_id": None,
            }
        with self.lock:
            if generation != self.session.generation or self.session.stopped:
                raise ManipulationError("retired", "execution admission retired")
            if result.status.name in {"ACCEPTED", "COMPLETED"}:
                self.operation.confirm_execution(
                    group, endpoint_pose, endpoint, now=time.monotonic()
                )
            else:
                self.operation.reject_execution()
            return {
                "status": result.status.name.lower(),
                "message": result.message,
                "operation": None,
                "operation_id": self.operation.id,
            }

    def update(
        self,
        client_id: str,
        group: str,
        body: dict[str, Any],
        *,
        admission: ManipulationAdmission | None = None,
    ) -> dict[str, Any]:
        with self.lock:
            self.require_owner(client_id, group)
            feedback = self.adapter.feedback
            if feedback is None or not measurement_is_fresh(
                feedback.ts, time.time(), self.config.feedback_max_age_s
            ):
                raise ManipulationError("stale_feedback", "joint feedback is stale or unavailable")
            if self.session.token != body["token"] or self.session.owner != client_id:
                return {
                    "status": "rejected",
                    "code": "retired",
                    "message": "Following retired",
                    "sequence": body["sequence"],
                }
            if (
                body["sequence"] <= self.session.sequence
                or not -0.1 <= time.time() - body["ts"] <= 0.5
            ):
                return {"status": "following", "code": "stale_target", "sequence": body["sequence"]}
            epoch = self.session.generation
            key = (*body["position"], *body["orientation"])
            self.session.accept_sample(body["sequence"], key, now=time.monotonic())
            if key == self.session.rejected_key:
                return {"status": "following", "sequence": body["sequence"]}
        with self.lock:
            if (
                epoch != self.session.generation
                or self.session.stopped
                or (admission is not None and not self.authority().current(admission))
            ):
                return {"status": "rejected", "sequence": body["sequence"], "code": "retired"}
            if time.time() - body["ts"] > 0.5:
                return {"status": "following"}
        task = self.config.following_tasks[group]
        failure = self.adapter.task_invoke(
            task,
            "set_target",
            {
                "pose": self.pose(body),
                "value": body["speed_scale"],
                "t_now": None,
            },
        )
        with self.lock:
            if epoch != self.session.generation or self.session.stopped:
                return {"status": "rejected", "sequence": body["sequence"], "code": "retired"}
        if isinstance(failure, dict) and failure.get("message"):
            return {"status": "infeasible", "sequence": body["sequence"], **failure}
        if isinstance(failure, str) and failure:
            return {
                "status": "infeasible",
                "sequence": body["sequence"],
                "code": "ik_failed",
                "message": failure,
            }
        return {"status": "following", "sequence": body["sequence"]}

    def evaluate_following(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        body = decode_request({**request, "action": "update", "request_id": "advisory"}).payload
        group = request["group_id"]
        with self.lock:
            self.require_owner(client_id, group)
            if self.session.owner != client_id or self.session.token != body["token"]:
                return {"status": "following", "code": "retired"}
            epoch = self.session.generation
        try:
            evaluation = self.adapter.evaluate(group, self.pose(body))
            result = {
                "status": "feasible" if evaluation.success else "infeasible",
                "message": evaluation.message,
                "joints": self.joints(evaluation.target_joints),
                "pose": self.pose_wire(evaluation.group_poses.get(group)),
            }
            if not evaluation.success:
                result["code"] = self.adapter.evaluation_code(evaluation)
        except Exception as exc:  # noqa: BLE001 — native IK failures are advisory wire results
            result = {
                "status": "infeasible",
                "code": spatial_error_code(str(exc), "ik_failed"),
                "message": str(exc),
            }
        validated = None
        rejected = False
        with self.lock:
            if epoch != self.session.generation or self.session.token != body["token"]:
                return {"status": "following", "code": "retired"}
            key = (*body["position"], *body["orientation"])
            if (
                result["status"] == "feasible"
                and self.session.target_key == key
                and result.get("joints")
            ):
                self.session.rejected_key = None
                self._following_target = FollowingTarget(
                    group,
                    dict(body),
                    result["joints"],
                    self.authority().target_revision,
                )
                pose = self.pose(body)
                native_key = [
                    pose.x,
                    pose.y,
                    pose.z,
                    pose.orientation.x,
                    pose.orientation.y,
                    pose.orientation.z,
                    pose.orientation.w,
                ]
                validated = {"key": native_key, "joints": result["joints"]}
            if result["status"] == "infeasible" and self.session.target_key == key:
                self.session.rejected_key = key
                rejected = True
        if validated is not None:
            self.adapter.task_invoke(
                self.config.following_tasks[group], "set_validated_target", validated
            )
        if rejected:
            self.clear_following()
        with self.lock:
            if epoch != self.session.generation:
                return {"status": "following", "code": "retired"}
        return result

    def pose(self, body: dict[str, Any]) -> PoseStamped:
        position, orientation = self.config.wire_from_world.transform(
            body["position"], body["orientation"], inverse=True
        )
        return PoseStamped(
            ts=time.time(),
            frame_id="world",
            position=position,
            orientation=orientation,
        )

    def pose_wire(self, pose: Any) -> dict[str, Any] | None:
        if pose is None:
            return None
        position, orientation = self.config.wire_from_world.transform(
            [pose.x, pose.y, pose.z],
            [pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w],
        )
        return {"position": position, "orientation": orientation}

    @staticmethod
    def joints(joints: Any) -> dict[str, float] | None:
        return None if joints is None else dict(zip(joints.name, joints.position, strict=True))

    def snapshot(self, *, include_bulk: bool = True) -> dict[str, Any]:
        if not self.started or not self.adapter.ready:
            return {"available": False, "message": "Manipulation runtime is starting"}
        feedback = self.adapter.feedback
        if feedback is None or not measurement_is_fresh(
            feedback.ts, time.time(), self.config.feedback_max_age_s
        ):
            protection = self.adapter.protection
            faulted = isinstance(protection, dict) and protection.get("state") in {
                "paused",
                "fault",
            }
            return {
                "available": False,
                "message": "Waiting for arm feedback",
                "protection": protection,
                "stopped": self.session.stopped or faulted,
                "stop_confirmed": self.session.stop_confirmed,
            }
        state = self.adapter.get_state()
        groups = self.adapter.list_planning_groups()
        if self.descriptor is None:
            self.descriptor = describe_model(
                self.config.model.model.load().xml,
                self.config.model_asset_url,
                visual_profile=self.config.model_visual_profile,
                gripper_open_at_lower=self.config.gripper_open_at_lower,
                gripper_joint_names=self.config.gripper_joint_names,
            )
        with self.lock:
            goal = self.session.target_key
            tracking = (
                self.adapter.following_status.get(self.session.group_id)
                if self.session.group_id is not None
                else None
            )
            at_target = False
            if (
                goal
                and isinstance(tracking, dict)
                and tracking.get("arrived")
                and time.monotonic() - self.adapter.following_status_at < 0.3
            ):
                native = self.pose({"position": goal[:3], "orientation": goal[3:]})
                key = [
                    native.x,
                    native.y,
                    native.z,
                    native.orientation.x,
                    native.orientation.y,
                    native.orientation.z,
                    native.orientation.w,
                ]
                at_target = tracking.get("target_key") is not None and all(
                    abs(a - b) < 1e-6 for a, b in zip(key, tracking["target_key"], strict=True)
                )
            tail = self.following_tail
            result: dict[str, Any] = {
                "available": True,
                "simulated": bool(global_config.simulation),
                "protection": self.adapter.protection,
                "ts": time.time(),
                "model": self.descriptor,
                "root_pose": (
                    self.pose_wire(self.config.model.base_pose)
                    if getattr(self.config, "model", None) is not None
                    and getattr(self.config.model, "base_pose", None) is not None
                    else self.config.wire_from_world.model_dump()
                ),
                "groups": [
                    {
                        "id": g.id,
                        "joint_names": list(g.joint_names),
                        "base_frame": g.base_frame,
                        "tip_frame": g.tip_frame,
                        "has_gripper": g.has_gripper,
                        "following": g.id in self.config.following_tasks,
                    }
                    for g in groups
                ],
                "observations": {
                    key: {
                        "joints": self.joints(value.joints),
                        "measured_at": feedback.ts if value.joints else None,
                        "pose": self.pose_wire(value.end_effector_pose),
                        "gripper": value.gripper_position,
                        "gripper_target": self.adapter.gripper_target,
                        "joint_velocities": dict(
                            zip(value.joints.name, value.joints.velocity, strict=True)
                        )
                        if value.joints and getattr(value.joints, "velocity", None)
                        else {},
                    }
                    for key, value in state.groups.items()
                },
                "execution": "aborted"
                if self.operation.failed_id
                else "completed"
                if self.operation.completed_id
                else "executing"
                if self.operation.id
                and (
                    self.operation.admitting
                    or self.operation.phase == "gripper"
                    or state.execution_status.name == "COMPLETED"
                )
                else state.execution_status.name.lower()
                if self.operation.id
                else "idle",
                "execution_phase": self.operation.published_phase,
                "message": self.operation.gripper_error
                or self._following_failure
                or (self.adapter.protection or {}).get("reason")
                or state.error,
                "owner": self.session.owner,
                "following": self.session.token is not None,
                "following_at_target": at_target,
                "following_goal": {"position": list(goal[:3]), "orientation": list(goal[3:])}
                if goal
                else None,
                "following_tail": (tail.wire() if tail is not None else None),
                "evaluation": self.evaluation.wire() if self.evaluation is not None else None,
                "stopped": self.session.stopped,
                "stop_confirmed": self.session.stop_confirmed,
                "plan": self.operation.plan,
                "operation": self.operation.kind
                if self.operation.kind in {"resetting", "parking"}
                else None,
                "operation_id": self.operation.id
                or self.operation.completed_id
                or self.operation.failed_id,
            }

        if not include_bulk:
            model = result.pop("model")
            result["model_revision"] = model["revision"]
            plan = result.pop("plan")
            result["plan_revision"] = plan["plan_id"] if plan is not None else None
            result["plan_metadata"] = (
                {key: value for key, value in plan.items() if key != "trajectory"}
                if plan is not None
                else None
            )
        return result

    def asset(self, kind: str, revision: str) -> dict[str, Any] | None:
        with self.lock:
            value = (
                self.descriptor
                if kind == "model"
                else self.operation.plan
                if kind == "plan"
                else None
            )
            identity = "revision" if kind == "model" else "plan_id"
            return (
                cast("dict[str, Any]", value)
                if value is not None and value.get(identity) == revision
                else None
            )

    def suspend(self, client_id: str, deadline: float) -> None:
        with self.lock:
            now = time.monotonic()
            if self.session.owner == client_id and now < deadline <= now + 1.05:
                self._reconnect_deadline = deadline

    def disconnect(self, client_id: str) -> None:
        with self.lock:
            self.session.retire_client(client_id)
            owned = self.session.owner == client_id
        if owned:
            self.emergency_stop()

    def emergency_stop(
        self,
        *,
        epoch: str | None = None,
        revision: int | None = None,
        expected_generation: int | None = None,
    ) -> None:
        with self.lock:
            if expected_generation is not None and expected_generation != self.session.generation:
                raise ManipulationError("retired", "execution generation retired")
            if epoch is not None and revision is not None:
                self.authority().stop(epoch, revision)
            self.session.latch_stop()
            self.retire()
            generation = self.session.generation
        failures: list[Exception] = []
        confirmed = False
        held = False
        try:
            held = self.adapter.set_estop(True) is not False
        except Exception:
            logger.exception("Failed to assert manipulation emergency stop")
        try:
            self.clear_following()
        except Exception as exc:
            logger.exception("Failed to stop manipulation following")
            failures.append(exc)
        try:
            result = self.adapter.cancel()
            confirmed = result.status.name not in {"UNCERTAIN", "FAULT"}
        except Exception as exc:
            logger.exception("Failed to cancel manipulation execution")
            failures.append(exc)
        with self.lock:
            current = generation == self.session.generation
            if current:
                self.session.confirm_stop(generation, confirmed=held and confirmed and not failures)
            quiesce = current and self.session.shutdown and self.session.stop_confirmed
        if quiesce:
            self.adapter.quiesce()
            with self.lock:
                if generation == self.session.generation:
                    self.session.confirm_quiesced(generation)
        if failures:
            raise failures[0]

    def check_control_lease(self) -> None:
        with self.lock:
            active = (
                self.session.token is not None
                or self.following_tail
                or self.operation.id is not None
            )
            expired = (
                active
                and self._control_epoch is not None
                and time.monotonic() >= self._control_deadline
            )
            epoch, revision = self._control_epoch, self._control_revision
        if expired:
            self.emergency_stop(epoch=epoch, revision=revision)

    def advance(self) -> None:
        protection = self.adapter.protection
        with self.lock:
            protection_stop = (
                isinstance(protection, dict)
                and protection.get("state") in {"paused", "fault"}
                and not self.session.stopped
            )
        if protection_stop:
            self.emergency_stop()
            return
        self.check_control_lease()
        with self.lock:
            tail = copy(self.following_tail)
            generation = self.session.generation
        if tail is not None:
            try:
                observation = self.fresh(tail.group_id)
                now = time.monotonic()
                expired = now - tail.started_at >= 55
                arrived = tail.arrived(observation, now=now)
                stalled = tail.stalled(now=now)
                if expired or arrived or stalled:
                    if self.retire_following(generation):
                        with self.lock:
                            if not arrived and not self.session.stopped:
                                self._following_failure = "Target not reached"
                        logger.info(
                            "Following target finished",
                            generation=tail.generation,
                            reason="arrived" if arrived else "stalled" if stalled else "deadline",
                            elapsed_s=round(now - tail.started_at, 3),
                            remaining=tail.progress_error,
                        )
                elif now - tail.refreshed_at >= 0.1:
                    with self.lock:
                        current = generation == self.session.generation and not self.session.stopped
                    if current:
                        task = self.config.following_tasks[tail.group_id]
                        self.adapter.task_invoke(
                            task,
                            "set_target",
                            {
                                "pose": self.pose(tail.body),
                                "value": tail.body["speed_scale"],
                                "t_now": None,
                            },
                        )
                        failure = self.adapter.task_invoke(task, "get_failure", {})
                        if isinstance(failure, (str, dict)) and failure:
                            if self.retire_following(generation):
                                with self.lock:
                                    self._following_failure = "Target not reached"
                        else:
                            tail.refreshed_at = time.monotonic()
                            with self.lock:
                                if (
                                    generation == self.session.generation
                                    and self.following_tail is not None
                                ):
                                    self.following_tail = tail
                else:
                    with self.lock:
                        if (
                            generation == self.session.generation
                            and self.following_tail is not None
                        ):
                            self.following_tail = tail
            except ValueError:
                self.retire_following(generation)
        with self.lock:
            generation = self.session.generation
            reconnect = (
                self.session.token is not None and time.monotonic() < self._reconnect_deadline
            )
            cached = self._following_target if reconnect else None
            group = self.session.group_id
        if cached is not None and cached.group == group:
            try:
                self.fresh(cached.group)
                with self.lock:
                    current = generation == self.session.generation and not self.session.stopped
                if current:
                    self.adapter.task_invoke(
                        self.config.following_tasks[cached.group],
                        "set_target",
                        {
                            "pose": self.pose(cached.body),
                            "value": cached.body["speed_scale"],
                            "t_now": None,
                        },
                    )
            except ValueError:
                self.retire_following(generation)
        with self.lock:
            generation = self.session.generation
            expired = (
                self.session.token is not None
                and time.monotonic() - self.session.updated_at > 0.5
                and time.monotonic() >= self._reconnect_deadline
            )
        if expired:
            self.retire_following(generation)
        with self.lock:
            if not self.operation.id or self.operation.admitting:
                return
            operation = self.operation.copy_for_observation()
            operation_id = operation.id
            generation = self.session.generation
            stopped = self.session.stopped
        finished = operation.advance(
            self.adapter, stopped=stopped, feedback_max_age_s=self.config.feedback_max_age_s
        )
        with self.lock:
            if generation == self.session.generation and operation_id == self.operation.id:
                self.operation = operation
                if finished:
                    self.session.release_owner()
