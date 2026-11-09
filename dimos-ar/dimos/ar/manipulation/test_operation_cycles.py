"""Exercise production command bridges with deterministic, nonphysical joint I/O."""

from types import MethodType, SimpleNamespace

from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
from dimos.ar.manipulation.operation import ManipulationOperation
from dimos.control.coordinator import ControlCoordinator, TaskConfig
from dimos.control.task import CoordinatorState, JointStateSnapshot
from dimos.control.tasks.gripper_task.gripper_task import (
    GripperControlTask,
    GripperControlTaskConfig,
)
from dimos.control.tasks.trajectory_task.trajectory_task import create_task
from dimos.manipulation.manipulation_module import ManipulationModule
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.msgs.trajectory_msgs.JointTrajectory import JointTrajectory
from dimos.msgs.trajectory_msgs.TrajectoryPoint import TrajectoryPoint
from test_support.manipulation import command, runtime


def test_one_hundred_plan_execute_gripper_cycles_through_real_coordinator(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("time.time", lambda: clock[0])
    monkeypatch.setattr("time.monotonic", lambda: clock[0])
    coordinator = ControlCoordinator(publish_joint_state=False)
    gripper = GripperControlTask("openyam_gripper", GripperControlTaskConfig(["finger"]), [(0, 1)])
    trajectory = create_task(
        TaskConfig(name="joint_trajectory", type="trajectory", joint_names=["joint"]), {}
    )
    coordinator.add_task(trajectory, task_type="trajectory")
    coordinator.add_task(gripper, task_type="gripper")
    values = {"joint": 0.0, "finger": 0.0}
    coordinator.get_joint_positions = lambda: dict(values)
    bridge = SimpleNamespace(
        config=SimpleNamespace(model=SimpleNamespace(gripper_hardware_id="openyam")),
        _control_coordinator=coordinator,
        _resolve_gripper_group=lambda _: SimpleNamespace(id="arm"),
    )
    bridge.set_gripper_position = MethodType(ManipulationModule.set_gripper_position, bridge)
    adapter = DimOSManipulationAdapter(bridge)
    module = runtime()
    observed = module.adapter.get_state().groups["arm"]
    observed.joints = JointState(name=["joint"], position=[0], ts=clock[0])
    observed.end_effector_pose = PoseStamped(position=[0, 0, 0])
    observed.gripper_position = 0.0
    module.adapter.set_gripper_position = adapter.set_gripper_position
    module.adapter.endpoint_pose = lambda _, joints: PoseStamped(position=[joints["joint"], 0, 0])
    module.adapter.cancel = coordinator.cancel_trajectory
    module.adapter.ready = True
    module.descriptor = {}
    module.adapter.list_planning_groups = list
    module.adapter.get_state().error = None
    calls = []
    native_set = gripper.set_normalized

    def record(values, t_now=None):
        calls.append(values[0])
        return native_set(values, t_now)

    gripper.set_normalized = record
    try:
        for cycle in range(100):
            goal = 0.2 if cycle % 2 == 0 else 0.4
            desired = 1.0 if cycle % 2 == 0 else 0.0
            start = values["joint"]
            path = JointTrajectory(
                joint_names=["joint"],
                points=[
                    TrajectoryPoint(time_from_start=0, positions=[start]),
                    TrajectoryPoint(time_from_start=0.1, positions=[goal]),
                ],
            )
            plan = SimpleNamespace(plan_id=f"p{cycle}", trajectory=path)
            module.adapter.plan_to_poses = lambda *_, saved_plan=plan, **__: SimpleNamespace(
                succeeded=True, plan=saved_plan
            )
            module.adapter.execute = lambda saved_path=path, **_: coordinator.execute_trajectory(
                saved_path
            )
            command(
                module,
                "plan",
                position=[goal, 0, 0],
                orientation=[0, 0, 0, 1],
                speed_scale=0.5,
                final_gripper=desired,
            )
            assert module.operation.outcome is None
            result = command(module, "execute", plan_id=plan.plan_id)
            assert result["status"] == "accepted"
            operation_id = result["operation_id"]
            for _ in range(85):
                clock[0] += 0.01
                state = CoordinatorState(
                    joints=JointStateSnapshot(joint_positions=dict(values)), t_now=clock[0], dt=0.01
                )
                output = trajectory.compute(state)
                if output is not None:
                    # Simulate the observed physical residual that previously skipped
                    # the deferred gripper: 20 mm shy of the requested endpoint.
                    values["joint"] = (
                        min(output.positions[0], goal - 0.02)
                        if goal > start
                        else max(output.positions[0], goal + 0.02)
                    )
                grip = gripper.compute(state)
                if grip is not None:
                    # An object prevents closing to zero; acknowledgement still succeeds.
                    values["finger"] = max(0.35, grip.positions[0])
                observed.joints = JointState(
                    ts=clock[0], name=["joint"], position=[values["joint"]]
                )
                observed.end_effector_pose = PoseStamped(position=[values["joint"], 0, 0])
                observed.gripper_position = values["finger"]
                module.adapter.feedback.ts = clock[0]
                module.adapter.get_state().execution_status.name = trajectory.get_status(
                    clock[0]
                ).state.name
                module.advance()
            assert module.operation.completed_id == operation_id
            assert module.operation.failed_id is None
            assert module.operation.id is None
            assert module.session.owner is None
            assert module.operation.gripper_error is None
            assert adapter.gripper_target == desired
            assert len(calls) == cycle + 1
            assert not module.operation.advance(
                module.adapter, stopped=False, feedback_max_age_s=0.5
            )
        assert calls == [float(i % 2 == 0) for i in range(100)]
    finally:
        coordinator.stop()


def test_failed_gripper_has_one_terminal_outcome_and_next_plan_clears_it():
    module = runtime()
    observed = module.adapter.get_state().groups["arm"]
    observed.joints = JointState(ts=__import__("time").time(), name=["joint"], position=[0.3])
    observed.gripper_position = 0
    module.adapter.get_state().execution_status.name = "COMPLETED"
    module.adapter.set_gripper_position = lambda *_, **__: SimpleNamespace(
        status=SimpleNamespace(name="FAILED"), message="Gripper command rejected"
    )
    module.operation = ManipulationOperation(id="bad", final_gripper=("arm", 1, {"joint": 0.3}))
    module.advance()
    assert module.operation.failed_id == "bad"
    assert module.operation.completed_id is None
    assert module.operation.outcome.phase == "gripper"
    assert not module.operation.advance(module.adapter, stopped=False, feedback_max_age_s=0.5)
    module.operation.clear()
    assert module.operation.outcome is None
    assert module.operation.gripper_error is None
