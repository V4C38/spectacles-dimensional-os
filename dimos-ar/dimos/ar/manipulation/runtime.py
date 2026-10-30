from __future__ import annotations

import threading
import time
from typing import Any
from uuid import uuid4

from dimos.ar.manipulation.errors import ManipulationError
from dimos.ar.manipulation.model import describe_model
from dimos.ar.manipulation.operation import ManipulationOperation
from dimos.ar.manipulation.ports import ManipulationBackend
from dimos.ar.manipulation.protocol import decode_request
from dimos.ar.manipulation.session import ManipulationSession
from dimos.ar.manipulation.zero import JointZeroOperation
from dimos.core.global_config import global_config
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


class ManipulationRuntime:
    def __init__(self, adapter: ManipulationBackend) -> None:
        self.adapter = adapter
        self.config = adapter.config
        self.session = ManipulationSession()
        self.operation = ManipulationOperation()
        self.lock = threading.RLock()
        self.planning = threading.Lock()
        self.zero = JointZeroOperation(self)
        self.descriptor: dict[str, Any] | None = None
        self.started = False

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
        self.session.retire()
        self.operation.clear()

    def clear_following(self) -> None:
        for task in self.config.following_tasks.values():
            self.adapter.task_invoke(task, "clear")

    def dispatch(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.command(client_id, request)
        except ValueError as exc:
            message = str(exc)
            code = exc.code if isinstance(exc, ManipulationError) else "rejected"
            result: dict[str, Any] = {"status": "rejected", "code": code, "message": message}
            if request.get("action") == "prepare_shutdown":
                result["quiescent"] = self.session.quiesced
            return result

    def command(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        # Validate again at the domain boundary, including direct RPC callers.
        message = decode_request({**request, "request_id": "domain"})
        action, group, body = message.action, message.group_id, message.payload
        if action in {"reset_joints", "prepare_shutdown"}:
            return self.zero.run(
                client_id, group, body["speed_scale"], action == "prepare_shutdown"
            )
        if action == "update":
            return self.update(client_id, group, body)
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
                return {"status": "resumed"}
            self.require_owner(client_id, group)
            if action != "release":
                self.fresh(group)
            if action == "release":
                if self.session.owner != client_id or self.session.token != body["token"]:
                    raise ManipulationError("retired", "following token retired")
                self.clear_following()
                self.retire()
                return {"status": "released"}
            if action == "gripper":
                self.session.generation += 1
                self.operation.plan = None
                self.adapter.clear_planned_path()
                result = self.adapter.set_gripper_position(body["value"], planning_group=group)
                return {
                    "status": "completed" if result.succeeded else "rejected",
                    "message": result.message,
                }
            if self.session.token is not None:
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
                self.operation.plan = None
                self.session.owner, self.session.group_id = client_id, group
                self.operation.id = None
                self.session.token = uuid4().hex
                self.session.evaluated_at = float("-inf")
                self.session.sequence = -1
                self.session.generation += 1
                self.session.updated_at = time.monotonic()
                return {"status": "acquired", "token": self.session.token}
            if action == "execute":
                if (
                    self.operation.plan is None
                    or self.session.owner != client_id
                    or self.operation.plan["plan_id"] != body["plan_id"]
                ):
                    raise ManipulationError("retired", "reviewed plan was retired or replaced")
                result = self.adapter.execute(blocking=False, plan_id=body["plan_id"])
                if result.status.name in {"ACCEPTED", "COMPLETED"}:
                    self.operation.gripper_error = None
                    self.operation.id = uuid4().hex
                    self.operation.kind = "executing"
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
            if action == "plan":
                self.operation.id = None
                self.session.owner, self.session.group_id = client_id, group
                self.operation.plan = None
                self.session.generation += 1
            epoch = self.session.generation
        if not self.planning.acquire(blocking=False):
            raise ManipulationError("busy", "evaluation or planning already pending")
        try:
            if action == "evaluate":
                if not self.adapter.ready:
                    raise ManipulationError("rejected", "planning model unavailable")
                evaluation = self.adapter.evaluate(group, self.pose(body))
                result_body = {
                    "status": "feasible" if evaluation.success else "infeasible",
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
                    "plan_id": plan.plan_id,
                    "joint_names": list(trajectory.joint_names),
                    "trajectory": [
                        {"time": p.time_from_start, "positions": list(p.positions)}
                        for p in trajectory.points
                    ],
                    "duration": trajectory.duration,
                }
            with self.lock:
                if epoch != self.session.generation or client_id in self.session.retired:
                    raise ManipulationError("retired", "request retired")
                if action == "plan":
                    if "final_gripper" in body:
                        result_body["final_gripper"] = body["final_gripper"]
                    self.operation.plan = result_body
            return result_body
        finally:
            self.planning.release()

    def update(self, client_id: str, group: str, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            self.require_owner(client_id, group)
            self.fresh(group)
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
                raise ManipulationError("stale_feedback", "following sample stale or out of order")
            self.session.sequence = body["sequence"]
            self.session.updated_at = time.monotonic()
            epoch = self.session.generation
            if self.session.updated_at - self.session.evaluated_at < 0.15:
                return {"status": "following"}
            self.session.evaluated_at = self.session.updated_at
        evaluation = None
        if self.adapter.ready:
            evaluation = self.adapter.evaluate(group, self.pose(body))
        with self.lock:
            if epoch != self.session.generation or self.session.stopped:
                return {"status": "rejected", "sequence": body["sequence"], "code": "retired"}
            if evaluation is not None and not evaluation.success:
                self.clear_following()
                return {
                    "status": "infeasible",
                    "sequence": body["sequence"],
                    "code": self.adapter.evaluation_code(evaluation),
                    "message": evaluation.message or "IK failed",
                }
            if time.time() - body["ts"] > 0.5:
                return {"status": "following"}
            task = self.config.following_tasks[group]
            self.adapter.task_invoke(task, "set_speed_scale", {"value": body["speed_scale"]})
            self.adapter.task_invoke(
                task, "on_cartesian_command", {"pose": self.pose(body), "t_now": None}
            )
            failure = self.adapter.task_invoke(task, "get_failure", {})
            if isinstance(failure, str) and failure:
                return {
                    "status": "infeasible",
                    "sequence": body["sequence"],
                    "code": "ik_failed",
                    "message": failure,
                }
            return {
                "status": "feasible",
                "sequence": body["sequence"],
                "joints": self.joints(evaluation.target_joints) if evaluation else None,
            }

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

    def snapshot(self) -> dict[str, Any]:
        if not self.started or not self.adapter.ready:
            return {"available": False, "message": "Manipulation runtime is starting"}
        feedback = self.adapter.feedback
        if feedback is None or not 0 <= time.time() - feedback.ts <= self.config.feedback_max_age_s:
            return {"available": False, "message": "Waiting for arm feedback"}
        state = self.adapter.get_state()
        if self.descriptor is None:
            self.descriptor = describe_model(
                self.config.model.model.load().xml,
                self.config.model_asset_url,
                visual_profile=self.config.model_visual_profile,
                gripper_open_at_lower=self.config.gripper_open_at_lower,
            )
        with self.lock:
            return {
                "available": True,
                "simulated": bool(global_config.simulation),
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
                    }
                    for key, value in state.groups.items()
                },
                "execution": state.execution_status.name.lower(),
                "message": self.operation.gripper_error or state.error,
                "owner": self.session.owner,
                "following": self.session.token is not None,
                "stopped": self.session.stopped,
                "stop_confirmed": self.session.stop_confirmed,
                "plan": self.operation.plan,
                "operation": self.operation.kind
                if self.operation.kind in {"resetting", "parking"}
                else None,
                "operation_id": self.operation.id,
            }

    def disconnect(self, client_id: str) -> None:
        with self.lock:
            self.session.retired.add(client_id)
            owned = self.session.owner == client_id
        if owned:
            self.emergency_stop()

    def emergency_stop(self) -> None:
        with self.lock:
            self.session.stopped = True
            self.session.stop_confirmed = False
            self.retire()
            self.clear_following()
        result = self.adapter.cancel()
        self.adapter.set_estop(True)
        with self.lock:
            self.session.stop_confirmed = result.status.name not in {"UNCERTAIN", "FAULT"}
            if self.session.shutdown and self.session.stop_confirmed:
                self.adapter.quiesce()
                self.session.quiesced = True

    def advance(self) -> None:
        with self.lock:
            if self.session.token is not None and time.monotonic() - self.session.updated_at > 0.5:
                self.clear_following()
                self.retire()
            if not self.operation.id:
                return
            if self.operation.advance(
                self.adapter,
                stopped=self.session.stopped,
                feedback_max_age_s=self.config.feedback_max_age_s,
            ):
                self.session.owner = None
                self.session.group_id = None
