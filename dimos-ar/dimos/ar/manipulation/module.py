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
from dimos.manipulation.manipulation_module import ManipulationModule, ManipulationModuleConfig
from dimos.manipulation.visualization.operator import ManipulationOperator, PoseTargetRequest
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.JointState import JointState


class ARManipulationModuleConfig(ManipulationModuleConfig):  # type: ignore[misc]
    following_tasks: dict[str, str] = Field(default_factory=dict)
    model_asset_url: str | None = None
    wire_from_world: ReferencePose = Field(default_factory=ReferencePose)
    feedback_max_age_s: float = Field(default=0.5, gt=0, allow_inf_nan=False)


class ARManipulationModule(ManipulationModule):  # type: ignore[misc]
    config: ARManipulationModuleConfig

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
        return observed

    def _ar_require_owner(self, client_id: str, group: str) -> None:
        if client_id in self._ar_retired or self._ar_stopped or self._ar_cancelling:
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
        self._ar_final_gripper = None
        self._ar_gripper_completion_at = None

    def _ar_clear_following(self) -> None:
        for task in self.config.following_tasks.values():
            self._control_coordinator.task_invoke(task, "clear")

    @rpc
    def ar_manipulation_command(self, client_id: str, request: dict[str, Any]) -> dict[str, Any]:
        # Validate again at the domain boundary, including direct RPC callers.
        message = decode_request({**request, "request_id": "domain"})
        action, group, body = message.action, message.group_id, message.payload
        if action in {"reset_joints", "prepare_shutdown"}:
            return self._ar_return_zero(
                client_id, group, body["speed_scale"], action == "prepare_shutdown"
            )
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
            if action == "update":
                if self._ar_token != body["token"] or self._ar_owner != client_id:
                    raise ValueError("following token retired")
                if (
                    body["sequence"] <= self._ar_sequence
                    or not -0.1 <= time.time() - body["ts"] <= 0.5
                ):
                    raise ValueError("following sample stale or out of order")
                if (
                    getattr(self, "_world_monitor", None) is not None
                    and time.monotonic() - getattr(self, "_ar_follow_evaluated", 0) >= 0.15
                ):
                    self._ar_follow_evaluated = time.monotonic()
                    evaluation = ManipulationOperator(
                        self, self._world_monitor
                    ).evaluate_pose_target(PoseTargetRequest({group: self._ar_pose(body)}))
                    if not evaluation.success:
                        self._ar_clear_following()
                        self._ar_retire()
                        raise ValueError(
                            evaluation.message or "Following target is unreachable or colliding"
                        )
                task = self.config.following_tasks[group]
                self._control_coordinator.task_invoke(
                    task, "set_speed_scale", {"value": body["speed_scale"]}
                )
                self._control_coordinator.task_invoke(
                    task, "on_cartesian_command", {"pose": self._ar_pose(body), "t_now": None}
                )
                self._ar_sequence = body["sequence"]
                self._ar_updated = time.monotonic()
                return {"status": "following"}
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

    def _ar_return_zero(
        self, client_id: str, group: str, speed: float, shutdown: bool
    ) -> dict[str, Any]:
        with self._ar_lock:
            if shutdown:
                if self._ar_stopped or self._ar_cancelling:
                    return {
                        "status": "skipped",
                        "message": "Emergency stop active; automatic motion skipped",
                    }
            else:
                self._ar_require_owner(client_id, group)
            self._ar_fresh(group)
            self._ar_clear_following()
            self._ar_retire()
            self._ar_owner, self._ar_group = client_id, group
        if not self._ar_planning.acquire(blocking=False):
            raise ValueError("Planning is pending; retry reset")
        try:
            cancelled = self.cancel()
            if cancelled.status.name in {"UNCERTAIN", "FAULT"}:
                raise ValueError("Could not confirm motion stopped")
            definition = next(g for g in self.list_planning_groups() if g.id == group)
            joints = list(definition.joint_names)
            target = JointState(name=joints, position=[0.0] * len(joints))
            planned = self.plan_to_joints(
                {group: target}, speed_scale=min(speed, 0.2) if shutdown else speed
            )
            if not planned.succeeded or planned.plan is None:
                raise ValueError(planned.message)
            result = self.execute(blocking=False, plan_id=planned.plan.plan_id)
            if result.status.name not in {"ACCEPTED", "COMPLETED", "SUCCEEDED"}:
                raise ValueError(result.message)
            deadline, settled = time.monotonic() + 60, None
            while time.monotonic() < deadline:
                with self._ar_lock:
                    if self._ar_stopped:
                        raise ValueError("Reset interrupted by emergency stop")
                observed = self._ar_fresh(group)
                actual = dict(zip(observed.joints.name, observed.joints.position, strict=True))
                if all(abs(actual.get(name, float("inf"))) <= 0.02 for name in joints):
                    settled = settled or time.monotonic()
                    if time.monotonic() - settled >= 0.5:
                        terminal = self.wait_for_execution(timeout=0.1)
                        if terminal.status.name == "COMPLETED":
                            ready = self.reset()
                            if ready.status.name != "SUCCEEDED":
                                raise ValueError(ready.message)
                            return {"status": "completed", "message": "Zero pose confirmed"}
                else:
                    settled = None
                time.sleep(0.05)
            self.cancel()
            raise ValueError("Zero pose was not confirmed within 60 seconds")
        except Exception:
            self.cancel()
            raise
        finally:
            with self._ar_lock:
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
        if not hasattr(self, "_execution_manager") or self._world_monitor is None:
            return {"available": False, "message": "Manipulation runtime is starting"}
        state = self.get_state()
        if self._ar_descriptor is None:
            self._ar_descriptor = describe_model(
                self.config.model.model.load().xml, self.config.model_asset_url
            )
        with self._ar_lock:
            if self._ar_token is not None and time.monotonic() - self._ar_updated > 0.5:
                self._ar_clear_following()
                self._ar_retire()
            if self._ar_operation and state.execution_status.name not in {"ACCEPTED", "EXECUTING"}:
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
                        "measured_at": value.joints.ts if value.joints else None,
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
