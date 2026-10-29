"""Optional official-DimOS adapter. No robot-specific policy in ARModule."""

from __future__ import annotations

import inspect
import threading
import time
from typing import Any
from uuid import uuid4

from pydantic import Field

from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.model import describe_model
from dimos.ar.manipulation.protocol import decode_request
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger

logger = setup_logger()
from dimos.manipulation.manipulation_module import ManipulationModule, ManipulationModuleConfig
from dimos.manipulation.manipulation_spec import ExecutionResult, ExecutionStatus
from dimos.manipulation.visualization.operator import ManipulationOperator, PoseTargetRequest
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.JointState import JointState


class _QuiescedExecution:
    """Local teardown after parking already confirmed cancellation remotely.

    DimOS stops module RPC services concurrently. Its default teardown would issue
    another cancellation into a coordinator that may already have closed its RPC.
    Only a completed shutdown handshake may use this local cancellation receipt.
    """

    def __init__(self, delegate: Any) -> None:
        self._delegate = delegate

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)

    def cancel(self, *args: Any, **kwargs: Any) -> Any:
        return ExecutionResult(ExecutionStatus.NO_EXECUTION, "Shutdown motion already stopped")

    def close(self) -> None:
        self._delegate.close()


class ARManipulationModuleConfig(ManipulationModuleConfig):  # type: ignore[misc]
    following_tasks: dict[str, str] = Field(default_factory=dict)
    model_asset_url: str | None = None
    wire_from_world: ReferencePose = Field(default_factory=ReferencePose)
    feedback_max_age_s: float = Field(default=0.5, gt=0, allow_inf_nan=False)


class ARManipulationModule(ManipulationModule):  # type: ignore[misc]
    config: ARManipulationModuleConfig
    _execution_manager: Any

    @rpc
    def start(self) -> None:
        self._ar_closing = False
        self._ar_started = False
        backend = getattr(self._control_coordinator, "rpc", None)
        if backend is not None and isinstance(getattr(backend, "rpc_timeouts", None), dict):
            backend.rpc_timeouts["task_invoke"] = 0.5
            backend.rpc_timeouts["set_estop"] = 0.5
        super().start()
        self._ar_started = True

    @rpc
    def stop(self) -> None:
        with self._ar_lock:
            if getattr(self, "_ar_closing", False):
                return
            self._ar_closing = True
            self._ar_started = False
            self._ar_stopped = True
            self._ar_retire()
            if getattr(self, "_ar_quiesced", False):
                self._execution_manager = _QuiescedExecution(self._execution_manager)
        super().stop()

    @rpc
    def build(self) -> None:
        if "plan_id" not in inspect.signature(
            ManipulationModule.execute
        ).parameters or not callable(getattr(ManipulationModule, "inverse_kinematics", None)):
            raise RuntimeError(
                "AR manipulation requires the official planning-group APIs with execute-by-plan-ID and nonmoving IK; update DimOS (tested baseline 76ffe6e)"
            )
        super().build()

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._ar_started = False
        self._ar_closing = False
        self._ar_shutdown = False
        self._ar_quiesced = False
        self._ar_operation_kind: str | None = None
        self._ar_feedback: JointState | None = None
        self._ar_lock = threading.RLock()
        self._ar_planning = threading.Lock()
        self._ar_owner: str | None = None
        self._ar_group: str | None = None
        self._ar_token: str | None = None
        self._ar_sequence = -1
        self._ar_updated = 0.0
        self._ar_follow_evaluated = 0.0
        self._ar_epoch = 0
        self._ar_cancelling = False
        self._ar_stopped = False
        self._ar_stop_confirmed = True
        self._ar_retired: set[str] = set()
        self._ar_plan: dict[str, Any] | None = None
        self._ar_descriptor: dict[str, Any] | None = None
        self._ar_operation: str | None = None
        self._ar_final_gripper: tuple[str, float, dict[str, float]] | None = None
        self._ar_gripper_completion_at: float | None = None
        self._ar_gripper_error: str | None = None

    def _ar_fresh(self, group: str) -> Any:
        state = self.get_state()
        observed = state.groups.get(group)
        if observed is None:
            raise ValueError("unknown planning group")
        if (
            observed.joints is None
            or not 0 <= time.time() - observed.joints.ts <= self.config.feedback_max_age_s
        ):
            raise ValueError("joint feedback is stale or unavailable")
        feedback = getattr(self, "_ar_feedback", None)
        if feedback is not None:
            if not 0 <= time.time() - feedback.ts <= self.config.feedback_max_age_s:
                raise ValueError("joint feedback is stale or unavailable")
            observed.joints.ts = feedback.ts
        return observed

    def _on_joint_state(self, msg: JointState) -> None:
        # Preserve the source sample clock; upstream snapshots recreate JointState timestamps.
        aliases = self.config.joint_state_aliases
        indices = {aliases.get(name, name): i for i, name in enumerate(msg.name)}
        names = self.config.model.joint_names
        if all(name in indices and indices[name] < len(msg.position) for name in names):
            values = [msg.position[indices[name]] for name in names]
            import math

            if all(math.isfinite(q) for q in values):
                super()._on_joint_state(msg)
                self._ar_feedback = JointState(ts=msg.ts, name=list(names), position=values)

    def _ar_require_owner(self, client_id: str, group: str) -> None:
        if (
            getattr(self, "_ar_shutdown", False)
            or client_id in self._ar_retired
            or self._ar_stopped
            or self._ar_cancelling
        ):
            raise ValueError("connection retired or manipulation stopped")
        if self._ar_owner not in (None, client_id) or self._ar_group not in (None, group):
            raise ValueError("manipulation is owned by another connection or group")

    def _ar_retire(self) -> None:
        self._ar_epoch += 1
        self._ar_token = None
        self._ar_plan = None
        self._ar_owner = None
        self._ar_group = None
        self._ar_operation = None
        self._ar_operation_kind = None
        self._ar_final_gripper = None
        self._ar_gripper_completion_at = None

    def _ar_clear_following(self) -> None:
        for task in self.config.following_tasks.values():
            self._control_coordinator.task_invoke(task, "clear")

    @rpc
    def ar_manipulation_command(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._ar_command(client_id, request)
        except ValueError as exc:
            message = str(exc)
            code = (
                "joint_limit"
                if "limit" in message.lower()
                else "ik_failed"
                if "ik" in message.lower()
                else "rejected"
            )
            return {"status": "rejected", "code": code, "message": message}

    def _ar_command(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        # Validate again at the domain boundary, including direct RPC callers.
        message = decode_request({**request, "request_id": "domain"})
        action, group, body = message.action, message.group_id, message.payload
        if action in {"reset_joints", "prepare_shutdown"}:
            return self._ar_return_zero(
                client_id, group, body["speed_scale"], action == "prepare_shutdown"
            )
        if action == "update":
            return self._ar_update(client_id, group, body)
        if action == "cancel":
            with self._ar_lock:
                if self._ar_owner not in (None, client_id):
                    raise ValueError("cannot cancel another owner's operation")
                was_stopped = self._ar_stopped
                self._ar_stopped = True
                self._ar_cancelling = True
                self._ar_stop_confirmed = False
                self._ar_retire()
                epoch = self._ar_epoch
            try:
                self._ar_clear_following()
                result = self.cancel()
            finally:
                with self._ar_lock:
                    self._ar_cancelling = False
            with self._ar_lock:
                if epoch == self._ar_epoch:
                    self._ar_stop_confirmed = result.status.name not in {"UNCERTAIN", "FAULT"}
                    self._ar_stopped = was_stopped or not self._ar_stop_confirmed
            return {"status": result.status.name.lower(), "message": result.message}
        with self._ar_lock:
            if action == "resume":
                if client_id in self._ar_retired:
                    raise ValueError("connection retired")
                if not self._ar_stopped or self._ar_owner is not None:
                    raise ValueError("resume requires stopped, unowned manipulation")
                if not self._ar_stop_confirmed:
                    raise ValueError("stop was not confirmed")
                self._ar_fresh(group)
                result = self.reset()
                if not result.succeeded:
                    raise ValueError(result.message)
                self._control_coordinator.set_estop(False)
                self._ar_stopped = False
                return {"status": "resumed"}
            self._ar_require_owner(client_id, group)
            if action != "release":
                self._ar_fresh(group)
            if action == "release":
                if self._ar_owner != client_id or self._ar_token != body["token"]:
                    raise ValueError("following token retired")
                self._ar_clear_following()
                self._ar_retire()
                return {"status": "released"}
            if action == "gripper":
                self._ar_epoch += 1
                self._ar_plan = None
                self.clear_planned_path()
                result = self.set_gripper_position(body["value"], planning_group=group)
                return {
                    "status": "completed" if result.succeeded else "rejected",
                    "message": result.message,
                }
            if self._ar_token is not None:
                raise ValueError("release following before another operation")
            execution = self.get_state().execution_status.name
            if execution in {"ACCEPTED", "EXECUTING", "UNCERTAIN", "FAULT"}:
                raise ValueError("execution active or outcome uncertain")
            if action == "acquire":
                if group not in self.config.following_tasks:
                    raise ValueError("following is unavailable for this group")
                cancelled = self.cancel()
                if cancelled.status.name in {"UNCERTAIN", "FAULT"}:
                    self._ar_stopped = True
                    self._ar_stop_confirmed = False
                    raise ValueError("could not retire prior motion")
                self._ar_plan = None
                self._ar_owner, self._ar_group = client_id, group
                self._ar_operation = None
                self._ar_token = uuid4().hex
                self._ar_follow_evaluated = float("-inf")
                self._ar_sequence = -1
                self._ar_epoch += 1
                self._ar_updated = time.monotonic()
                return {"status": "acquired", "token": self._ar_token}
            if action == "execute":
                if (
                    self._ar_plan is None
                    or self._ar_owner != client_id
                    or self._ar_plan["plan_id"] != body["plan_id"]
                ):
                    raise ValueError("reviewed plan was retired or replaced")
                result = self.execute(blocking=False, plan_id=body["plan_id"])
                if result.status.name in {"ACCEPTED", "COMPLETED"}:
                    self._ar_gripper_error = None
                    self._ar_operation = uuid4().hex
                    self._ar_operation_kind = "executing"
                    self._ar_final_gripper = None
                    self._ar_gripper_completion_at = None
                    if "final_gripper" in self._ar_plan:
                        endpoint = dict(
                            zip(
                                self._ar_plan["joint_names"],
                                self._ar_plan["trajectory"][-1]["positions"],
                                strict=True,
                            )
                        )
                        self._ar_final_gripper = (group, self._ar_plan["final_gripper"], endpoint)
                return {
                    "status": result.status.name.lower(),
                    "message": result.message,
                    "operation": getattr(self, "_ar_operation_kind", None)
                    if getattr(self, "_ar_operation_kind", None) in {"resetting", "parking"}
                    else None,
                    "operation_id": self._ar_operation,
                }
            if action == "plan":
                self._ar_operation = None
                self._ar_owner, self._ar_group = client_id, group
                self._ar_plan = None
                self._ar_epoch += 1
            epoch = self._ar_epoch
        if not self._ar_planning.acquire(blocking=False):
            raise ValueError("evaluation or planning already pending")
        try:
            if action == "evaluate":
                if self._world_monitor is None:
                    raise ValueError("planning model unavailable")
                evaluation = ManipulationOperator(self, self._world_monitor).evaluate_pose_target(
                    PoseTargetRequest({group: self._ar_pose(body)})
                )
                result_body = {
                    "status": "feasible" if evaluation.success else "infeasible",
                    "message": evaluation.message,
                    "joints": self._ar_joints(evaluation.target_joints),
                    "pose": self._ar_pose_wire(evaluation.group_poses.get(group)),
                }
            else:
                planned = self.plan_to_poses(
                    {group: self._ar_pose(body)}, speed_scale=body["speed_scale"]
                )
                if not planned.succeeded or planned.plan is None:
                    raise ValueError(planned.message)
                plan = planned.plan
                trajectory = plan.trajectory
                if len(trajectory.points) > 8192:
                    self.clear_planned_path()
                    raise ValueError("trajectory exceeds bounded preview size")
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
            with self._ar_lock:
                if epoch != self._ar_epoch or client_id in self._ar_retired:
                    raise ValueError("request retired")
                if action == "plan":
                    if "final_gripper" in body:
                        result_body["final_gripper"] = body["final_gripper"]
                    self._ar_plan = result_body
            return result_body
        finally:
            self._ar_planning.release()

    def _ar_update(self, client_id: str, group: str, body: dict[str, Any]) -> dict[str, Any]:
        with self._ar_lock:
            self._ar_require_owner(client_id, group)
            self._ar_fresh(group)
            if self._ar_token != body["token"] or self._ar_owner != client_id:
                return {
                    "status": "rejected",
                    "code": "retired",
                    "message": "Following retired",
                    "sequence": body["sequence"],
                }
            if body["sequence"] <= self._ar_sequence or not -0.1 <= time.time() - body["ts"] <= 0.5:
                raise ValueError("following sample stale or out of order")
            self._ar_sequence = body["sequence"]
            self._ar_updated = time.monotonic()
            epoch = self._ar_epoch
            if self._ar_updated - getattr(self, "_ar_follow_evaluated", float("-inf")) < 0.15:
                return {"status": "following"}
            self._ar_follow_evaluated = self._ar_updated
        evaluation = None
        if getattr(self, "_world_monitor", None) is not None:
            evaluation = ManipulationOperator(self, self._world_monitor).evaluate_pose_target(
                PoseTargetRequest({group: self._ar_pose(body)})
            )
        with self._ar_lock:
            if epoch != self._ar_epoch or self._ar_stopped:
                return {"status": "rejected", "sequence": body["sequence"], "code": "retired"}
            if evaluation is not None and not evaluation.success:
                self._ar_clear_following()
                return {
                    "status": "infeasible",
                    "sequence": body["sequence"],
                    "code": "joint_limit"
                    if "limit" in (evaluation.message or "").lower()
                    else "ik_failed",
                    "message": evaluation.message or "IK failed",
                }
            if time.time() - body["ts"] > 0.5:
                return {"status": "following"}
            task = self.config.following_tasks[group]
            self._control_coordinator.task_invoke(
                task, "set_speed_scale", {"value": body["speed_scale"]}
            )
            self._control_coordinator.task_invoke(
                task, "on_cartesian_command", {"pose": self._ar_pose(body), "t_now": None}
            )
            failure = self._control_coordinator.task_invoke(task, "get_failure", {})
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
                "joints": self._ar_joints(evaluation.target_joints) if evaluation else None,
            }

    def _ar_return_zero(
        self, client_id: str, group: str, speed: float, shutdown: bool
    ) -> dict[str, Any]:
        with self._ar_lock:
            if shutdown:
                if self._ar_stopped or self._ar_cancelling:
                    self._ar_shutdown = True
                    if self._ar_stop_confirmed:
                        self._ar_quiesced = True
                        self._execution_manager.close()
                    return {
                        "status": "skipped",
                        "message": "Emergency stop active; automatic motion skipped",
                    }
            else:
                self._ar_require_owner(client_id, group)
            self._ar_fresh(group)
            # Acquire before changing ownership: a rejected reset cannot retire a planner.
            if not self._ar_planning.acquire(blocking=False):
                raise ValueError("Planning is pending; retry reset")
            self._ar_retire()
            epoch = self._ar_epoch
            self._ar_owner, self._ar_group = client_id, group
            self._ar_operation = uuid4().hex
            self._ar_operation_kind = "parking" if shutdown else "resetting"
            if shutdown:
                self._ar_shutdown = True

        def require_current() -> None:
            if self._ar_epoch != epoch or self._ar_stopped or self._ar_cancelling:
                raise ValueError("Reset interrupted by stop or ownership change")

        operation_deadline = time.monotonic() + 55
        try:
            with self._ar_lock:
                require_current()
                self._ar_clear_following()
                ready = self.reset()
                if not ready.succeeded:
                    self._ar_stopped = True
                    self._ar_stop_confirmed = False
                    raise ValueError(ready.message)
            definition = next(g for g in self.list_planning_groups() if g.id == group)
            joints = list(definition.joint_names)
            target = JointState(name=joints, position=[0.0] * len(joints))
            # An arm already at zero needs only new settled observations, no new trajectory.
            observed = self._ar_fresh(group)
            actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
            already_zero = all(abs(actual.get(name, float("inf"))) <= 0.02 for name in joints)
            planned = (
                None
                if already_zero
                else self.plan_to_joints(
                    {group: target}, speed_scale=min(speed, 0.2) if shutdown else speed
                )
            )
            with self._ar_lock:
                require_current()
                if planned is not None and (not planned.succeeded or planned.plan is None):
                    raise ValueError(planned.message)
                if planned is not None:
                    result = self.execute(blocking=False, plan_id=planned.plan.plan_id)
                    if result.status.name not in {"ACCEPTED", "COMPLETED", "SUCCEEDED"}:
                        raise ValueError(result.message)
            started = time.monotonic()
            nominal_end = started + (planned.plan.trajectory.duration if planned is not None else 0)
            deadline = min(operation_deadline, nominal_end + 3.0)
            settled: float | None = None
            last_measurement = float("-inf")
            last_log = float("-inf")
            while time.monotonic() < deadline:
                with self._ar_lock:
                    require_current()
                observed = self._ar_fresh(group)
                actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
                now = time.monotonic()
                if now - last_log >= 0.5:
                    worst = max(joints, key=lambda name: abs(actual.get(name, float("inf"))))
                    logger.info(
                        "Arm settling",
                        operation=self._ar_operation_kind,
                        elapsed_s=round(now - started, 2),
                        joint=worst,
                        error_rad=round(abs(actual.get(worst, float("inf"))), 4),
                        feedback_age_s=round(time.time() - observed.joints.ts, 3),
                    )
                    last_log = now
                if not already_zero and self.get_state().execution_status.name in {
                    "FAULT",
                    "UNCERTAIN",
                    "ABORTED",
                    "REJECTED",
                }:
                    raise ValueError("Zero trajectory failed")
                # Repeated publication of one cached sample must not establish settling.
                if observed.joints.ts > last_measurement:
                    last_measurement = observed.joints.ts
                    if now >= nominal_end and all(
                        abs(actual.get(name, float("inf"))) <= 0.02 for name in joints
                    ):
                        if settled is None:
                            settled = now
                        if now - settled >= 0.5:
                            with self._ar_lock:
                                require_current()
                                # Approximate measured arrival is sufficient. The official
                                # reset confirms stopping and returns to IDLE even if the
                                # executor has not declared its exact endpoint complete.
                                ready = self.reset()
                                if not ready.succeeded:
                                    self._ar_stopped = True
                                    self._ar_stop_confirmed = False
                                    raise ValueError(ready.message)
                                if shutdown:
                                    self._ar_quiesced = True
                                    self._execution_manager.close()
                                return {"status": "completed", "message": "Zero pose confirmed"}
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
            with self._ar_lock:
                # An obsolete worker must never stop or reset a newer operation.
                if self._ar_epoch == epoch and not self._ar_stopped:
                    try:
                        ready = self.reset()
                    except Exception:
                        self._ar_stopped = True
                        self._ar_stop_confirmed = False
                        raise
                    if not ready.succeeded:
                        self._ar_stopped = True
                        self._ar_stop_confirmed = False
                    elif shutdown:
                        self._ar_quiesced = True
                        self._execution_manager.close()
            raise
        finally:
            with self._ar_lock:
                if self._ar_epoch == epoch:
                    self._ar_retire()
            self._ar_planning.release()

    def _ar_pose(self, body: dict[str, Any]) -> PoseStamped:
        position, orientation = self.config.wire_from_world.transform(
            body["position"], body["orientation"], inverse=True
        )
        return PoseStamped(
            ts=time.time(),
            frame_id="world",
            position=position,
            orientation=orientation,
        )

    def _ar_pose_wire(self, pose: Any) -> dict[str, Any] | None:
        if pose is None:
            return None
        position, orientation = self.config.wire_from_world.transform(
            [pose.x, pose.y, pose.z],
            [pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w],
        )
        return {"position": position, "orientation": orientation}

    @staticmethod
    def _ar_joints(joints: Any) -> dict[str, float] | None:
        return None if joints is None else dict(zip(joints.name, joints.position, strict=True))

    @rpc
    def ar_manipulation_snapshot(self) -> dict[str, Any]:
        if (
            not getattr(self, "_ar_started", False)
            or not hasattr(self, "_execution_manager")
            or self._world_monitor is None
        ):
            return {"available": False, "message": "Manipulation runtime is starting"}
        feedback = getattr(self, "_ar_feedback", None)
        if hasattr(self, "_ar_feedback") and (
            feedback is None or time.time() - feedback.ts > self.config.feedback_max_age_s
        ):
            return {"available": False, "message": "Waiting for arm feedback"}
        state = self.get_state()
        if self._ar_descriptor is None:
            self._ar_descriptor = describe_model(
                self.config.model.model.load().xml, self.config.model_asset_url
            )
        with self._ar_lock:
            if self._ar_token is not None and time.monotonic() - self._ar_updated > 0.5:
                self._ar_clear_following()
                self._ar_retire()
            if (
                self._ar_operation
                and getattr(self, "_ar_operation_kind", None) not in {"resetting", "parking"}
                and state.execution_status.name not in {"ACCEPTED", "EXECUTING"}
            ):
                deferred = self._ar_final_gripper
                waiting_for_endpoint = False
                if deferred and state.execution_status.name == "COMPLETED" and not self._ar_stopped:
                    group, value, endpoint = deferred
                    now = time.monotonic()
                    completion_at = getattr(self, "_ar_gripper_completion_at", None)
                    if completion_at is None:
                        completion_at = now
                        self._ar_gripper_completion_at = completion_at
                    waiting_for_endpoint = now - completion_at < 2.0
                    observed = state.groups.get(group)
                    if (
                        observed
                        and observed.joints
                        and 0 <= time.time() - observed.joints.ts <= self.config.feedback_max_age_s
                    ):
                        actual = dict(
                            zip(observed.joints.name, observed.joints.position, strict=True)
                        )
                        if all(
                            abs(actual.get(j, float("inf")) - q) <= 0.02
                            for j, q in endpoint.items()
                        ):
                            command = self.set_gripper_position(value, planning_group=group)
                            if command.status.name != "SUCCEEDED":
                                self._ar_gripper_error = command.message
                            self._ar_final_gripper = None
                            waiting_for_endpoint = False
                if deferred and not waiting_for_endpoint and self._ar_final_gripper is not None:
                    self._ar_gripper_error = "Gripper action skipped: endpoint not confirmed"
                if not waiting_for_endpoint:
                    self._ar_final_gripper = None
                    self._ar_gripper_completion_at = None
                    self._ar_operation = None
                    self._ar_owner = None
                    self._ar_group = None
                    self._ar_plan = None
            return {
                "available": True,
                "simulated": bool(global_config.simulation),
                "ts": time.time(),
                "model": self._ar_descriptor,
                "root_pose": (
                    self._ar_pose_wire(self.config.model.base_pose)
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
                    for g in self.list_planning_groups()
                ],
                "observations": {
                    key: {
                        "joints": self._ar_joints(value.joints),
                        "measured_at": (feedback.ts if feedback else value.joints.ts)
                        if value.joints
                        else None,
                        "pose": self._ar_pose_wire(value.end_effector_pose),
                        "gripper": value.gripper_position,
                    }
                    for key, value in state.groups.items()
                },
                "execution": state.execution_status.name.lower(),
                "message": getattr(self, "_ar_gripper_error", None) or state.error,
                "owner": self._ar_owner,
                "following": self._ar_token is not None,
                "stopped": self._ar_stopped,
                "stop_confirmed": self._ar_stop_confirmed,
                "plan": self._ar_plan,
                "operation": getattr(self, "_ar_operation_kind", None)
                if getattr(self, "_ar_operation_kind", None) in {"resetting", "parking"}
                else None,
                "operation_id": self._ar_operation,
            }

    @rpc
    def ar_manipulation_disconnect(self, client_id: str) -> None:
        with self._ar_lock:
            self._ar_retired.add(client_id)
            owned = self._ar_owner == client_id
        if owned:
            self.ar_manipulation_stop()

    @rpc
    def ar_manipulation_stop(self) -> None:
        with self._ar_lock:
            self._ar_stopped = True
            self._ar_stop_confirmed = False
            self._ar_retire()
            self._ar_clear_following()
        result = self.cancel()
        self._control_coordinator.set_estop(True)
        with self._ar_lock:
            self._ar_stop_confirmed = result.status.name not in {"UNCERTAIN", "FAULT"}
            if getattr(self, "_ar_shutdown", False) and self._ar_stop_confirmed:
                self._ar_quiesced = True
                self._execution_manager.close()
