from __future__ import annotations

import inspect
from typing import Any

from dimos.ar.manipulation.errors import ManipulationError
from dimos.manipulation.manipulation_module import ManipulationModule
from dimos.manipulation.manipulation_spec import ExecutionResult, ExecutionStatus
from dimos.manipulation.visualization.operator import ManipulationOperator, PoseTargetRequest
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
        state = self.module.get_state()
        feedback = self.feedback
        for group in state.groups.values():
            if group.joints is not None:
                group.joints.ts = feedback.ts if feedback is not None else 0.0
        return state

    def evaluate(self, group: str, pose: Any) -> Any:
        return ManipulationOperator(self.module, self.module._world_monitor).evaluate_pose_target(
            PoseTargetRequest({group: pose})
        )

    def task_invoke(self, task: str, method: str, args: dict[str, Any] | None = None) -> Any:
        if args is None:
            return self.module._control_coordinator.task_invoke(task, method)
        return self.module._control_coordinator.task_invoke(task, method, args)

    def set_estop(self, value: bool) -> None:
        self.module._control_coordinator.set_estop(value)

    def quiesce(self) -> None:
        self.module._execution_manager.close()

    def prepare_teardown(self) -> None:
        self.module._execution_manager = _QuiescedExecution(self.module._execution_manager)

    def clear_planned_path(self) -> None:
        self.module.clear_planned_path()

    def set_gripper_position(self, value: float, *, planning_group: str) -> Any:
        return self.module.set_gripper_position(value, planning_group=planning_group)

    def cancel(self) -> Any:
        return self.module.cancel()

    def reset(self) -> Any:
        return self.module.reset()

    def execute(self, *, blocking: bool, plan_id: str) -> Any:
        return self.module.execute(blocking=blocking, plan_id=plan_id)

    def plan_to_poses(self, poses: dict[str, Any], *, speed_scale: float) -> Any:
        result = self.module.plan_to_poses(poses, speed_scale=speed_scale)
        if not result.succeeded:
            raise ManipulationError(self.error_code(result.message), result.message)
        return result

    def plan_to_joints(self, joints: dict[str, JointState], *, speed_scale: float) -> Any:
        return self.module.plan_to_joints(joints, speed_scale=speed_scale)

    def list_planning_groups(self) -> Any:
        return self.module.list_planning_groups()

    @staticmethod
    def evaluation_code(evaluation: Any) -> str:
        return DimOSManipulationAdapter.error_code(evaluation.message, default="ik_failed")

    @staticmethod
    def error_code(message: str | None, default: str = "rejected") -> str:
        # Installed planning APIs expose text rather than structured failure reasons.
        text = (message or "").lower()
        if "limit" in text:
            return "joint_limit"
        if "ik" in text:
            return "ik_failed"
        return default
