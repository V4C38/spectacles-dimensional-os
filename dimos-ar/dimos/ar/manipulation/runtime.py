from __future__ import annotations

import threading
import time
from typing import Any
from uuid import uuid4

from dimos.ar.manipulation.errors import ManipulationError, spatial_error_code
from dimos.ar.manipulation.following_tail import FollowingTail
from dimos.ar.manipulation.model import describe_model
from dimos.ar.manipulation.operation import ManipulationOperation
from dimos.ar.manipulation.ports import ManipulationBackend
from dimos.ar.manipulation.protocol import decode_request
from dimos.ar.manipulation.session import ManipulationSession
from dimos.ar.manipulation.zero import JointZeroOperation
from dimos.ar.replication.manipulation_authority import (
    ManipulationAdmission,
    ManipulationAuthorityFence,
)
from dimos.ar.websocket.protocol import ManipulationEvaluation
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
        self._target_retirement: tuple[str, int] | None = None
        self._authority = ManipulationAuthorityFence()
        self._following_target: tuple[str, dict[str, Any], dict[str, float] | None, int] | None = (
            None
        )
        self.following_tail: FollowingTail | None = None
        self._following_failure: str | None = None
        self.evaluation: ManipulationEvaluation | None = None
        self._control_epoch: str | None = None
        self._control_deadline = 0.0
        self._control_revision = -1
        self._reconnect_deadline = 0.0
        self._retired_control_epochs: set[str] = set()

    def authority(self) -> ManipulationAuthorityFence:
        if not hasattr(self, "_authority"):
            self._authority = ManipulationAuthorityFence()
        return self._authority

    def heartbeat(self, epoch: str, revision: int, deadline: float) -> None:
        import math

        now = time.monotonic()
        if not epoch or not math.isfinite(deadline) or not now < deadline <= now + 1:
            raise ValueError("invalid control-plane heartbeat")
        with self.lock:
            if not hasattr(self, "_retired_control_epochs"):
                self._retired_control_epochs = set()
            prior = getattr(self, "_control_epoch", None)
            if epoch in getattr(self, "_retired_control_epochs", set()):
                return
            if prior is not None and prior != epoch:
                self.emergency_stop()
                self._retired_control_epochs.add(prior)
                self._authority = ManipulationAuthorityFence()
            if prior == epoch and revision < getattr(self, "_control_revision", -1):
                return
            self._control_epoch, self._control_revision = epoch, revision
            self._control_deadline = deadline

    def revoke_authority(
        self, epoch: str, lease: str, revision: int, reason: str = "released"
    ) -> None:
        with self.lock:
            if reason == "superseded":
                if self.authority().supersede(epoch, revision):
                    if self.session.token is not None or getattr(self, "following_tail", None):
                        self.retire_following()
                    else:
                        self.session.generation += 1
                return
            was_current = self.authority().lease == lease
            if not self.authority().revoke(epoch, lease, revision):
                return
            if reason == "target_changed":
                previous = getattr(self, "_target_retirement", None)
                floor = previous[1] if previous is not None and previous[0] == epoch else -1
                self._target_retirement = (epoch, max(floor, revision))
            if self.session.token is not None and was_current:
                cached = getattr(self, "_following_target", None)
                if reason == "released" and cached is not None and not self.session.stopped:
                    group, body, joints, target_revision = cached
                    try:
                        self.fresh(group)
                    except ValueError:
                        self.retire_following()
                        return
                    self.session.retire()
                    self.following_tail = FollowingTail(
                        revision, group, target_revision, epoch, body, joints, time.monotonic(),
                        joint_tolerance=getattr(self.config, "joint_arrival_tolerance_rad", 0.02),
                        target_pose=self.pose(body),
                        continuous_joints=frozenset(
                            joint["name"]
                            for joint in (getattr(self, "descriptor", None) or {}).get("joints", [])
                            if joint.get("kind") == "continuous"
                        ),
                    )
                    self._following_target = None
                else:
                    self.retire_following()
            elif reason not in {"released", "target_changed"}:
                self.session.generation += 1

    def fresh(self, group: str) -> Any:
        state = self.adapter.get_state()
        observed = state.groups.get(group)
        if observed is None:
            raise ManipulationError("rejected", "unknown planning group")
        if (
            observed.joints is None
            or not 0 <= time.time() - observed.joints.ts <= self.config.feedback_max_age_s
        ):
            raise ManipulationError("stale_feedback", "joint feedback is stale or unavailable")
        return observed

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

    def retire_following(self) -> None:
        try:
            self.clear_following()
        except Exception:
            logger.exception("Following release failed; stopping native manipulation")
            self.emergency_stop()
            raise
        self.retire()

    def dispatch(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.command(client_id, request)
        except ValueError as exc:
            message = str(exc)
            code = exc.code if isinstance(exc, ManipulationError) else spatial_error_code(message)
            recoverable = request.get("action") in {"update", "evaluate", "plan"} and code in {
                "ik_failed",
                "joint_limit",
                "collision",
            }
            result: dict[str, Any] = {
                "status": "infeasible" if recoverable else "rejected",
                "code": code,
                "message": message,
            }
            if isinstance(exc, ManipulationError) and exc.failed_joints:
                result["failed_joints"] = exc.failed_joints
            if recoverable and request.get("action") == "update":
                with self.lock:
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
                request["authority_epoch"] != getattr(self, "_control_epoch", None)
                or time.monotonic() >= getattr(self, "_control_deadline", 0)
            ):
                raise ManipulationError("retired", "control plane retired")
            prior_lease = self.authority().lease
            admission = self.authority().admit(request)
            if admission is not None and getattr(self, "following_tail", None) is not None:
                self.retire_following()
            if admission is not None and prior_lease != admission.lease and self.session.token:
                self.retire_following()
        if action in {"reset_joints", "prepare_shutdown"}:
            return self.zero.run(
                client_id, group, body["speed_scale"], action == "prepare_shutdown"
            )
        if action == "update":
            return self.update(client_id, group, body, admission=admission)
        if action == "cancel":
            with self.lock:
                if self.session.owner not in (None, client_id):
                    raise ManipulationError("ownership", "cannot cancel another owner's operation")
                was_stopped = self.session.stopped
                self.session.stopped = True
                self.session.cancelling = True
                self.session.stop_confirmed = False
                self.retire()
                epoch = self.session.generation
            try:
                self.clear_following()
                result = self.adapter.cancel()
            finally:
                with self.lock:
                    self.session.cancelling = False
            with self.lock:
                if epoch == self.session.generation:
                    self.session.stop_confirmed = result.status.name not in {"UNCERTAIN", "FAULT"}
                    self.session.stopped = was_stopped or not self.session.stop_confirmed
            return {"status": result.status.name.lower(), "message": result.message}
        with self.lock:
            if action == "resume":
                if client_id in self.session.retired:
                    raise ManipulationError("retired", "connection retired")
                if not self.session.stopped or self.session.owner is not None:
                    raise ManipulationError(
                        "ownership", "resume requires stopped, unowned manipulation"
                    )
                if not self.session.stop_confirmed:
                    raise ManipulationError("stopped", "stop was not confirmed")
                self.fresh(group)
                result = self.adapter.reset()
                if not result.succeeded:
                    raise ValueError(result.message)
                self.adapter.set_estop(False)
                self.session.stopped = False
                self._following_failure = None
                return {"status": "resumed"}
            self.require_owner(client_id, group)
            if action != "release":
                self.fresh(group)
            if action == "release":
                if self.session.owner != client_id or self.session.token != body["token"]:
                    raise ManipulationError("retired", "following token retired")
                self.retire_following()
                return {"status": "released"}
            if self.operation.id is not None:
                raise ManipulationError("stopped", "execution active or outcome uncertain")
            if action == "gripper":
                if self.operation.id is not None:
                    raise ManipulationError("busy", "wait for the active arm operation")
                self.operation.outcome = None
                self.session.generation += 1
                self.operation.plan = None
                self.adapter.clear_planned_path()
                result = self.adapter.set_gripper_position(body["value"], planning_group=group)
                return {
                    "status": "completed" if result.succeeded else "rejected",
                    "message": result.message,
                }
            if self.session.token is not None and action != "evaluate":
                raise ManipulationError("rejected", "release following before another operation")
            execution = self.adapter.get_state().execution_status.name
            if execution in {"ACCEPTED", "EXECUTING", "UNCERTAIN", "FAULT"}:
                raise ManipulationError("stopped", "execution active or outcome uncertain")
            if action == "acquire":
                if group not in self.config.following_tasks:
                    raise ManipulationError("rejected", "following is unavailable for this group")
                cancelled = self.adapter.cancel()
                if cancelled.status.name in {"UNCERTAIN", "FAULT"}:
                    self.session.stopped = True
                    self.session.stop_confirmed = False
                    raise ManipulationError("rejected", "could not retire prior motion")
                self.operation.clear()
                self._following_failure = None
                self.session.owner, self.session.group_id = client_id, group
                self.operation.id = None
                self._following_target = None
                self.session.token = uuid4().hex
                self.session.evaluated_at = float("-inf")
                self.session.sequence = -1
                self.session.generation += 1
                self.session.updated_at = time.monotonic()
                return {"status": "acquired", "token": self.session.token}
            if action == "execute":
                if (
                    self.operation.plan is None
                    or self.operation.plan["plan_id"] != body["plan_id"]
                    or self.operation.plan.get("group_id", group) != group
                    or (
                        admission is not None
                        and self.operation.plan.get("target_revision") != admission.target_revision
                    )
                ):
                    raise ManipulationError("retired", "reviewed plan was retired or replaced")
                endpoint_values = dict(
                    zip(
                        self.operation.plan["joint_names"],
                        self.operation.plan["trajectory"][-1]["positions"],
                        strict=True,
                    )
                )
                endpoint_pose = self.adapter.endpoint_pose(group, endpoint_values)
                result = self.adapter.execute(blocking=False, plan_id=body["plan_id"])
                if result.status.name in {"ACCEPTED", "COMPLETED"}:
                    self.operation.outcome = None
                    self.operation.phase = "motion"
                    self.operation.id = uuid4().hex
                    self.operation.kind = "executing"
                    self.operation.stalled_at = None
                    self.operation.progress_pose = None
                    self.operation.started_at = time.monotonic()
                    self.operation.settled_at = None
                    self.operation.group = group
                    self.operation.endpoint_pose = endpoint_pose
                    self.operation.final_gripper = None
                    self.operation.gripper_completion_at = None
                    if "final_gripper" in self.operation.plan:
                        endpoint = dict(
                            zip(
                                self.operation.plan["joint_names"],
                                self.operation.plan["trajectory"][-1]["positions"],
                                strict=True,
                            )
                        )
                        self.operation.final_gripper = (
                            group,
                            self.operation.plan["final_gripper"],
                            endpoint,
                        )
                return {
                    "status": result.status.name.lower(),
                    "message": result.message,
                    "operation": self.operation.kind
                    if self.operation.kind in {"resetting", "parking"}
                    else None,
                    "operation_id": self.operation.id,
                }
            # Reserve advisory work before changing ownership, plan, or generation.
            # A rejected concurrent request must not retire the request already running.
            planning_lock = getattr(self, "evaluation_planning", self.planning) if action == "evaluate" else self.planning
            if not planning_lock.acquire(blocking=False):
                raise ManipulationError("busy", "evaluation or planning already pending")
            self._following_failure = None
            if action == "plan":
                self.operation.clear()
                self.operation.id = None
                self.operation.plan = None
                self.session.generation += 1
            epoch = self.session.generation
        try:
            if action == "evaluate":
                if not self.adapter.ready:
                    raise ManipulationError("rejected", "planning model unavailable")
                evaluation = self.adapter.evaluate(group, self.pose(body))
                result_body = {
                    "status": "feasible" if evaluation.success else "infeasible",
                    "sample_pose": {"position": body["position"], "orientation": body["orientation"]},
                    **(
                        {"code": self.adapter.evaluation_code(evaluation)}
                        if not evaluation.success
                        else {}
                    ),
                    "message": evaluation.message,
                    "joints": self.joints(evaluation.target_joints),
                    "pose": self.pose_wire(evaluation.group_poses.get(group)),
                }
            else:
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
                result_body = {
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
            with self.lock:
                retired = getattr(self, "_target_retirement", None)
                target_retired = bool(admission is not None and retired is not None
                                      and retired[0] == admission.epoch and admission.revision <= retired[1])
                if (
                    (action == "plan" and target_retired)
                    or epoch != self.session.generation
                    or client_id in self.session.retired
                    or (
                        admission is not None
                        and (self.authority().epoch != admission.epoch
                             or (action == "plan" and not self.authority().current(admission, planning=True)))
                    )
                ):
                    # The installed planner may have retained this generated plan
                    # even though delivery was retired. A later execute must never
                    # consume it by accident.
                    if action == "plan":
                        self.adapter.clear_planned_path()
                    raise ManipulationError("retired", "request retired")
                if (
                    action == "evaluate"
                    and result_body["status"] == "feasible"
                    and result_body["joints"] is not None
                    and admission is not None
                    and not target_retired
                    and request.get("advisory_current", True)
                    and self.authority().current(admission)
                ):
                    self.evaluation = {
                        "group_id": group,
                        "target_revision": admission.target_revision,
                        "joints": result_body["joints"],
                        "pose": result_body["pose"],
                    }
                if action == "plan":
                    if "final_gripper" in body:
                        result_body["final_gripper"] = body["final_gripper"]
                    self.operation.plan = result_body
            return result_body
        finally:
            planning_lock.release()

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
            if (
                feedback is None
                or not 0 <= time.time() - feedback.ts <= self.config.feedback_max_age_s
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
            self.session.sequence = body["sequence"]
            self.session.updated_at = time.monotonic()
            epoch = self.session.generation
            key = (*body["position"], *body["orientation"])
            self.session.target_key = key
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
        except Exception as exc:  # noqa: BLE001 — RPC/native errors are protocol replies
            result = {
                "status": "infeasible",
                "code": spatial_error_code(str(exc), "ik_failed"),
                "message": str(exc),
            }
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
                self._following_target = (
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
                self.adapter.task_invoke(
                    self.config.following_tasks[group],
                    "set_validated_target",
                    {"key": native_key, "joints": result["joints"]},
                )
            if result["status"] == "infeasible" and self.session.target_key == key:
                self.session.rejected_key = key
                self.clear_following()
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
        if feedback is None or not 0 <= time.time() - feedback.ts <= self.config.feedback_max_age_s:
            protection = getattr(self.adapter, "protection", None)
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
        if self.descriptor is None:
            self.descriptor = describe_model(
                self.config.model.model.load().xml,
                self.config.model_asset_url,
                visual_profile=self.config.model_visual_profile,
                gripper_open_at_lower=self.config.gripper_open_at_lower,
            )
        with self.lock:
            goal = self.session.target_key
            tracking = (getattr(self.adapter, "following_status", {}) or {}).get(
                self.session.group_id
            )
            at_target = False
            if (
                goal
                and isinstance(tracking, dict)
                and tracking.get("arrived")
                and time.monotonic() - getattr(self.adapter, "following_status_at", 0) < 0.3
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
            tail = getattr(self, "following_tail", None)
            result: dict[str, Any] = {
                "available": True,
                "simulated": bool(global_config.simulation),
                "protection": getattr(self.adapter, "protection", None),
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
                    for g in self.adapter.list_planning_groups()
                ],
                "observations": {
                    key: {
                        "joints": self.joints(value.joints),
                        "measured_at": feedback.ts if value.joints else None,
                        "pose": self.pose_wire(value.end_effector_pose),
                        "gripper": value.gripper_position,
                        "gripper_target": getattr(self.adapter, "gripper_target", None),
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
                if self.operation.id and self.operation.phase == "gripper"
                else state.execution_status.name.lower()
                if self.operation.id
                else "idle",
                "execution_phase": self.operation.phase
                if self.operation.id or self.operation.completed_id or self.operation.failed_id
                else None,
                "message": self.operation.gripper_error
                or getattr(self, "_following_failure", None)
                or (getattr(self.adapter, "protection", None) or {}).get("reason")
                or state.error,
                "owner": self.session.owner,
                "following": self.session.token is not None,
                "following_at_target": at_target,
                "following_goal": {"position": list(goal[:3]), "orientation": list(goal[3:])}
                if goal
                else None,
                "following_tail": (tail.wire() if tail is not None else None),
                "evaluation": getattr(self, "evaluation", None),
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
            return value if value is not None and value.get(identity) == revision else None

    def suspend(self, client_id: str, deadline: float) -> None:
        with self.lock:
            now = time.monotonic()
            if self.session.owner == client_id and now < deadline <= now + 1.05:
                self._reconnect_deadline = deadline

    def disconnect(self, client_id: str) -> None:
        with self.lock:
            self.session.retired.add(client_id)
            owned = self.session.owner == client_id
        if owned:
            self.emergency_stop()

    def emergency_stop(self, *, epoch: str | None = None, revision: int | None = None) -> None:
        with self.lock:
            if epoch is not None and revision is not None:
                self.authority().stop(epoch, revision)
            self.session.stopped = True
            self.session.stop_confirmed = False
            self.retire()
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
            self.session.stop_confirmed = held and confirmed and not failures
            if self.session.shutdown and self.session.stop_confirmed:
                self.adapter.quiesce()
                self.session.quiesced = True
        if failures:
            raise failures[0]

    def advance(self) -> None:
        protection = getattr(self.adapter, "protection", None)
        if (
            isinstance(protection, dict)
            and protection.get("state") in {"paused", "fault"}
            and not self.session.stopped
        ):
            self.emergency_stop()
        with self.lock:
            active = (
                self.session.token is not None
                or getattr(self, "following_tail", None)
                or self.operation.id is not None
            )
            if (
                active
                and getattr(self, "_control_epoch", None) is not None
                and time.monotonic() >= self._control_deadline
            ):
                self.emergency_stop(epoch=self._control_epoch, revision=self._control_revision)
                return
            tail = getattr(self, "following_tail", None)
            if tail is not None:
                try:
                    observation = self.fresh(tail.group_id)
                    now = time.monotonic()
                    expired = now - tail.started_at >= 55
                    arrived = tail.arrived(observation, now=now)
                    stalled = tail.stalled(now=now)
                    if expired or arrived or stalled or self.session.stopped:
                        self.retire_following()
                        if not arrived and not self.session.stopped and (expired or stalled):
                            self._following_failure = "Target not reached"
                        logger.info(
                            "Following target finished",
                            generation=tail.generation,
                            reason="arrived" if arrived else "stalled" if stalled else "deadline" if expired else "stopped",
                            elapsed_s=round(now - tail.started_at, 3),
                            remaining=tail.progress_error,
                        )
                    elif now - tail.refreshed_at >= 0.1:
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
                            self.retire_following()
                            self._following_failure = "Target not reached"
                        else:
                            tail.refreshed_at = time.monotonic()
                except ValueError:
                    self.retire_following()
            if self.session.token is not None and time.monotonic() < getattr(self, "_reconnect_deadline", 0.0):
                cached = self._following_target
                if cached is not None and cached[0] == self.session.group_id:
                    try:
                        self.fresh(cached[0])
                        self.adapter.task_invoke(self.config.following_tasks[cached[0]], "set_target",
                                                 {"pose": self.pose(cached[1]), "value": cached[1]["speed_scale"], "t_now": None})
                    except ValueError:
                        self.retire_following()
            if (self.session.token is not None and time.monotonic() - self.session.updated_at > 0.5
                    and time.monotonic() >= getattr(self, "_reconnect_deadline", 0.0)):
                logger.warning(
                    "Following lease expired: owner=%s sequence=%s age=%.3f",
                    self.session.owner,
                    self.session.sequence,
                    time.monotonic() - self.session.updated_at,
                )
                self.retire_following()
            if not self.operation.id:
                return
            if self.operation.advance(
                self.adapter,
                stopped=self.session.stopped,
                feedback_max_age_s=self.config.feedback_max_age_s,
            ):
                self.session.owner = None
                self.session.group_id = None
