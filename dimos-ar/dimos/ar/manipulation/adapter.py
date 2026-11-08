from __future__ import annotations

import inspect
import threading
import time
from typing import Any

from dimos.ar.manipulation.errors import ManipulationError, spatial_error_code
from dimos.ar.manipulation.planner_worker import PlanningWorker
from dimos.control.tasks.pose_target_ik import PinkPoseTargetSolver, PoseTargetIKTaskConfig
from dimos.manipulation.manipulation_module import ManipulationModule
from dimos.manipulation.manipulation_spec import (
    ExecutionResult,
    ExecutionStatus,
    ManipulationSnapshot,
    OperationStatus,
    PlanningGroupState,
)
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


class DimOSManipulationAdapter:
    def __init__(self, module: Any) -> None:
        self.module = module
        self.config = module.config
        self.feedback: JointState | None = None
        self.gripper: float | None = None
        self.gripper_target: float | None = None
        self.following_status: dict[str, Any] = {}
        self.following_status_at = 0.0
        self.endpoint_holding = False
        self.protection: dict[str, Any] = {"state": "normal", "effective_speed_scale": 1.0}
        self._feedback_lock = threading.Lock()
        self._protection_lock = threading.Lock()
        self._feedback_fk: Any = None
        self.worker: PlanningWorker | None = None
        self.evaluation_worker: PlanningWorker | None = None
        self._planning_generation = 0

    def prepare_feedback(self) -> None:
        self.worker = PlanningWorker(self.config)
        advisory = self.config.model_copy(deep=True)
        if advisory.kinematics.backend == "pink":
            advisory.kinematics.max_iterations = 12
        try:
            self.evaluation_worker = PlanningWorker(advisory)
        except BaseException:
            self.worker.close()
            self.worker = None
            raise
        model = self.config.model
        frames = tuple(g.tip_link for g in model.planning_groups if g.tip_link)
        self._feedback_fk = PinkPoseTargetSolver(
            PoseTargetIKTaskConfig(
                joint_names=tuple(model.joint_names),
                robot_model=model,
                target_frames=frames,
            )
        )
        # Warm the separate FK context before the runtime accepts clients.
        self._feedback_fk.frame_poses(
            JointState(
                name=list(model.joint_names),
                position=list(model.home_joints or [0.0] * len(model.joint_names)),
            ),
            frames,
        )

    def refresh_auxiliary(self) -> None:
        with self._protection_lock:
            self.protection = self.module._control_coordinator.protection_status()
        self.following_status = {
            group: self.task_invoke(task, "get_tracking_status")
            for group, task in self.config.following_tasks.items()
        }
        self.following_status_at = time.monotonic()
        self.module._refresh_execution_status()
        self.endpoint_holding = bool(
            self.task_invoke("joint_trajectory", "get_endpoint_status").get("holding_endpoint")
        )
        self.gripper = self.module._get_group_gripper_position()

    @staticmethod
    def check_compatibility() -> None:
        if "plan_id" not in inspect.signature(
            ManipulationModule.execute
        ).parameters or not callable(getattr(ManipulationModule, "inverse_kinematics", None)):
            raise RuntimeError("AR manipulation requires execute-by-plan-ID and nonmoving IK")

    def configure_rpc(self) -> None:
        backend = getattr(self.module._control_coordinator, "rpc", None)
        if backend is not None and isinstance(getattr(backend, "rpc_timeouts", None), dict):
            backend.rpc_timeouts["task_invoke"] = 0.5
            backend.rpc_timeouts["set_estop"] = 0.5

    @property
    def ready(self) -> bool:
        return hasattr(self.module, "_execution_manager") and self.module._world_monitor is not None

    def get_state(self) -> Any:
        # Never enter the planning world or call the coordinator while publishing
        # observations. Full IK holds the planning world's lock for whole solves.
        feedback = self.feedback
        groups = self.list_planning_groups()
        frames = tuple(g.tip_frame for g in groups if g.tip_frame)
        with self._feedback_lock:
            poses = self._feedback_fk.frame_poses(feedback, frames) if feedback else {}
        values = dict(zip(feedback.name, feedback.position, strict=True)) if feedback else {}
        return ManipulationSnapshot(
            timestamp=time.time(),
            operation_status=OperationStatus[self.module._state.name],
            error=self.module._error_message or None,
            has_pending_plan=self.module._last_plan is not None,
            execution_status=self.module._execution_manager.status,
            groups={
                g.id: PlanningGroupState(
                    joints=JointState(
                        ts=feedback.ts,
                        name=list(g.joint_names),
                        position=[values[n] for n in g.joint_names],
                        velocity=[
                            dict(zip(feedback.name, feedback.velocity, strict=True)).get(n, 0.0)
                            for n in g.joint_names
                        ]
                        if getattr(feedback, "velocity", None)
                        else [],
                    )
                    if feedback
                    else None,
                    end_effector_pose=poses.get(g.tip_frame),
                    gripper_position=self.gripper,
                )
                for g in groups
            },
        )

    def evaluate(self, group: str, pose: Any) -> Any:
        try:
            worker = self.evaluation_worker or self.worker
            assert worker is not None
            return worker.call(
                "evaluate", self.feedback, group, pose, seed_context=self._planning_generation
            )
        except Exception as exc:
            code = self.error_code(str(exc))
            if code in {"ik_failed", "joint_limit", "collision"}:
                joint = getattr(exc, "joint_name", None)
                raise ManipulationError(
                    code, str(exc), [joint] if isinstance(joint, str) else None
                ) from exc
            raise

    def task_invoke(self, task: str, method: str, args: dict[str, Any] | None = None) -> Any:
        if args is None:
            return self.module._control_coordinator.task_invoke(task, method)
        return self.module._control_coordinator.task_invoke(task, method, args)

    def set_estop(self, value: bool) -> bool:
        if value:
            self.gripper_target = None
        return bool(self.module._control_coordinator.set_estop(value))

    def quiesce(self) -> None:
        self.module._execution_manager.close()

    def prepare_teardown(self) -> None:
        self.module._execution_manager = _QuiescedExecution(self.module._execution_manager)

    def clear_planned_path(self) -> None:
        self._planning_generation += 1
        self.module.clear_planned_path()

    def set_gripper_position(self, value: float, *, planning_group: str) -> Any:
        result = self.module.set_gripper_position(value, planning_group=planning_group)
        if result.succeeded:
            self.gripper_target = value
        return result

    def cancel(self) -> Any:
        self._planning_generation += 1
        return self.module.cancel()

    def reset(self) -> Any:
        with self._protection_lock:
            if not self.module._control_coordinator.protection_resume():
                raise ManipulationError(
                    "protection",
                    "Arm protection has not recovered; reconnect after a hardware fault",
                )
            # Publish recovery before runtime clears its stopped flag. Serialize
            # with polling so an older paused response cannot relatch the stop.
            self.protection = self.module._control_coordinator.protection_status()
        return self.module.reset()

    def execute(self, *, blocking: bool, plan_id: str) -> Any:
        return self.module.execute(blocking=blocking, plan_id=plan_id)

    def plan_to_poses(self, poses: dict[str, Any], *, speed_scale: float) -> Any:
        try:
            result = self._plan("plan_to_poses", poses, speed_scale=speed_scale)
        except Exception as exc:
            code = self.error_code(str(exc))
            if code in {"ik_failed", "joint_limit", "collision"}:
                raise ManipulationError(code, str(exc)) from exc
            raise
        if not result.succeeded:
            raise ManipulationError(self.error_code(result.message), result.message)
        return result

    def endpoint_pose(self, group: str, joints: dict[str, float]) -> Any:
        state = JointState(name=list(joints), position=list(joints.values()))
        return self.module._world_monitor.get_group_ee_pose(group, state)

    def plan_to_joints(self, joints: dict[str, JointState], *, speed_scale: float) -> Any:
        return self._plan("plan_to_joints", joints, speed_scale=speed_scale)

    def _plan(self, action: str, targets: Any, *, speed_scale: float) -> Any:
        assert self.worker is not None
        generation = self._planning_generation
        result = self.worker.call(action, self.feedback, targets, speed_scale=speed_scale)
        with self.module._lock:
            if generation != self._planning_generation:
                raise ManipulationError("retired", "Planning result retired")
            if result.succeeded:
                self.module._last_plan = result.plan
        return result

    def list_planning_groups(self) -> Any:
        return self.module.list_planning_groups()

    @staticmethod
    def evaluation_code(evaluation: Any) -> str:
        return DimOSManipulationAdapter.error_code(evaluation.message, default="ik_failed")

    @staticmethod
    def error_code(message: str | None, default: str = "rejected") -> str:
        return spatial_error_code(message, default)
