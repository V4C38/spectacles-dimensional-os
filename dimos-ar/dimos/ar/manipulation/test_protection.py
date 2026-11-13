import pytest

from dimos.ar.manipulation.operation import DeferredGripper
from dimos.ar.manipulation.protection import MotorProtection, ProtectionPolicy


def row(**updates):
    return {
        "joint": "j1",
        "command": 0.2,
        "position": 0.0,
        "velocity": 0.0,
        "temperature_mos": 30,
        "temperature_rotor": 30,
        "enabled": True,
        **updates,
    }


def test_stall_derates_then_latches_pause_and_requires_explicit_recovered_resume():
    guard = MotorProtection(ProtectionPolicy(tracking_pause=True))
    guard.observe([row()], 0)
    guard.observe([row()], 0.21)
    assert guard.scale == 0.5
    guard.observe([row()], 0.8)
    assert guard.state == "paused"
    assert not guard.resume(0.8)
    guard.observe([row(command=0)], 1)
    guard.observe([row(command=0)], 3.1)
    assert guard.state == "paused"
    assert guard.resume(3.1)
    assert guard.scale == 1


def test_hardware_fault_never_resumes_automatically():
    guard = MotorProtection()
    guard.observe([row(fault=4)], 0)
    guard.observe([row(command=0)], 10)
    assert guard.state == "fault"
    assert not guard.resume(20)


def test_temperature_and_moving_tracking_error_are_distinguished():
    guard = MotorProtection()
    guard.observe([row(velocity=0.1)], 0)
    guard.observe([row(velocity=0.1)], 1)
    assert guard.state == "normal"
    guard.observe([row(command=0, temperature_mos=61)], 2)
    guard.observe([row(command=0, temperature_mos=61)], 2.6)
    assert guard.state == "derated"
    guard.observe([row(command=0, temperature_mos=71)], 2.7)
    assert guard.state == "paused"


def test_execution_clock_and_status_share_derating_and_pause(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from dimos.ar.manipulation.protection import create_trajectory_task
    from dimos.control.task import CoordinatorState, JointStateSnapshot
    from dimos.control.tasks.trajectory_task import trajectory_task

    compute, status, cancel = Mock(), Mock(), Mock()
    native = SimpleNamespace(
        compute=compute,
        cancel=cancel,
        get_status=status,
        is_active=lambda: True,
        execute=Mock(),
        on_preempted=Mock(),
    )
    monkeypatch.setattr(trajectory_task, "create_task", lambda *_: native)
    guard = MotorProtection()
    task = create_trajectory_task(
        None, {"arm": SimpleNamespace(_wb_adapter=SimpleNamespace(guard=guard))}
    )
    task.compute(CoordinatorState(joints=JointStateSnapshot(), t_now=10, dt=0.01))
    first = compute.call_args.args[0].t_now
    guard.state = "derated"
    task.compute(CoordinatorState(joints=JointStateSnapshot(), t_now=10.01, dt=0.01))
    assert compute.call_args.args[0].t_now - first == pytest.approx(0.005)
    assert compute.call_args.args[0].dt == 0.005
    task.get_status(10.01)
    assert status.call_args.args[0] == compute.call_args.args[0].t_now
    guard.state = "paused"
    task.compute(CoordinatorState(joints=JointStateSnapshot(), t_now=10.02, dt=0.01))
    cancel.assert_called_once()


def test_normal_loaded_tracking_error_derates_without_an_emergency_stop():
    guard = MotorProtection()
    for now in [0, 0.3, 1, 3, 10]:
        guard.observe([row()], now)
    assert guard.state == "derated"
    assert guard.scale == 0.5


def test_hot_loaded_motor_reports_temperature_as_the_latched_cause():
    guard = MotorProtection()
    guard.observe([row(temperature_mos=71)], 0)
    assert guard.state == "paused"
    assert guard.reason == "Motor temperature"


def test_trajectory_keeps_final_command_until_measured_arrival(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from dimos.ar.manipulation.protection import create_trajectory_task
    from dimos.control.task import CoordinatorState, JointCommandOutput, JointStateSnapshot
    from dimos.control.tasks.trajectory_task import trajectory_task
    from dimos.msgs.trajectory_msgs.TrajectoryStatus import (
        TrajectoryState as State,
        TrajectoryStatus,
    )

    def Status():
        return TrajectoryStatus(state=State.COMPLETED)

    endpoint = JointCommandOutput(joint_names=["joint"], positions=[0.5])
    native = SimpleNamespace(
        is_active=lambda: False,
        execute=Mock(),
        on_preempted=Mock(),
        compute=Mock(side_effect=[endpoint, None, None, None, None]),
        cancel=Mock(),
        get_status=lambda _: Status(),
    )
    monkeypatch.setattr(trajectory_task, "create_task", lambda *_: native)
    guard = MotorProtection()
    task = create_trajectory_task(
        None, {"arm": SimpleNamespace(_wb_adapter=SimpleNamespace(guard=guard))}
    )

    def tick(now, position):
        return task.compute(
            CoordinatorState(
                joints=JointStateSnapshot(joint_positions={"joint": position}),
                t_now=now,
                dt=0.01,
            )
        )

    assert tick(0, 0) is endpoint
    assert tick(3, 0.3) is endpoint  # More than the old deferred-gripper timeout.
    assert task.get_status(3).state == State.EXECUTING
    assert tick(4, 0.5) is endpoint
    assert tick(4.4, 0.5) is endpoint
    tick(4.6, 0.5)
    assert task.get_status(4.6).state == State.COMPLETED


def test_tracking_derating_requires_a_full_healthy_second_to_clear():
    guard = MotorProtection()
    guard.observe([row()], 0)
    guard.observe([row()], 0.21)
    assert guard.state == "derated"
    guard.observe([row(command=0.07)], 0.3)  # Below entry threshold but above recovery threshold.
    guard.observe([row(command=0.07)], 2)
    assert guard.state == "derated"
    guard.observe([row(command=0.01)], 3)
    guard.observe([row(command=0.01)], 3.9)
    assert guard.state == "derated"
    guard.observe([row(command=0.01)], 4.01)
    assert guard.state == "normal"


def test_real_trajectory_status_survives_rpc_and_applies_deferred_gripper_after_arrival():
    import time
    from types import SimpleNamespace
    from unittest.mock import Mock

    from dimos.ar.manipulation.operation import ActiveOperation, ManipulationOperation
    from dimos.ar.manipulation.protection import create_trajectory_task
    from dimos.control.coordinator import TaskConfig
    from dimos.control.task import CoordinatorState, JointStateSnapshot
    from dimos.msgs.sensor_msgs.JointState import JointState
    from dimos.msgs.trajectory_msgs.JointTrajectory import JointTrajectory
    from dimos.msgs.trajectory_msgs.TrajectoryPoint import TrajectoryPoint
    from dimos.msgs.trajectory_msgs.TrajectoryStatus import TrajectoryState, TrajectoryStatus

    guard = MotorProtection()
    task = create_trajectory_task(
        TaskConfig(
            name="joint_trajectory",
            type="ar_joint_trajectory",
            joint_names=["j"],
            params={"velocity_limits": {"j": 1.0}},
        ),
        {"arm": SimpleNamespace(_wb_adapter=SimpleNamespace(guard=guard))},
    )
    trajectory = JointTrajectory(
        joint_names=["j"],
        points=[
            TrajectoryPoint(time_from_start=0, positions=[0]),
            TrajectoryPoint(time_from_start=0.5, positions=[0.5]),
        ],
    )
    task.execute(trajectory, {"j": 0})
    import threading

    from dimos.control.tick_loop import TickLoop

    loop = SimpleNamespace(_task_lock=threading.Lock(), _tasks={"arm": task})
    for frame in range(101):
        assert task.is_active()
        outputs = TickLoop._compute_all_tasks(
            loop,
            CoordinatorState(
                joints=JointStateSnapshot(joint_positions={"j": 0}), t_now=frame * 0.01, dt=0.01
            ),
        )
    assert outputs and outputs[0][2] is not None
    pending = task.get_status(1)
    assert isinstance(pending, TrajectoryStatus)
    assert TrajectoryStatus.decode(pending.encode()).state == TrajectoryState.EXECUTING
    observed = SimpleNamespace(
        joints=JointState(name=["j"], position=[0], ts=time.time()),
        end_effector_pose=None,
        gripper_position=0,
    )
    backend = SimpleNamespace(
        endpoint_holding=False,
        gripper_target=None,
        get_state=lambda: SimpleNamespace(
            execution_status=task.get_status(1).state, groups={"arm": observed}
        ),
        set_gripper_position=Mock(
            return_value=SimpleNamespace(status=SimpleNamespace(name="SUCCEEDED"))
        ),
        cancel=Mock(),
    )
    operation = ManipulationOperation(
        active=ActiveOperation(
            id="op",
            kind="executing",
            group="arm",
            final_gripper=DeferredGripper("arm", 1, {"j": 0.5}),
        )
    )
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    backend.set_gripper_position.assert_not_called()
    for now in [2, 2.6]:
        task.compute(
            CoordinatorState(
                joints=JointStateSnapshot(joint_positions={"j": 0.5}), t_now=now, dt=0.01
            )
        )
    observed.joints = JointState(name=["j"], position=[0.5], ts=time.time())
    assert operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    backend.set_gripper_position.assert_called_once_with(1, planning_group="arm")
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    backend.set_gripper_position.assert_called_once()


@pytest.mark.parametrize("protected", [False, True])
def test_endpoint_poll_is_declared_and_quiet_for_real_and_simulated_tasks(monkeypatch, protected):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from dimos.ar.manipulation import following
    from dimos.ar.manipulation.protection import create_trajectory_task
    import dimos.control.coordinator as coordinator_module
    from dimos.control.coordinator import TaskConfig
    import dimos.control.tasks.registry as registry_module
    from dimos.control.tasks.registry import ControlTaskRegistry

    registry = ControlTaskRegistry()
    monkeypatch.setattr(following, "control_task_registry", registry)
    monkeypatch.setattr(registry_module, "control_task_registry", registry)
    monkeypatch.setattr(following.ArmPoseCoordinator, "build", lambda _: None)
    warning = Mock()
    monkeypatch.setattr(coordinator_module.logger, "warning", warning)
    coordinator = following.ARManipulationCoordinator(publish_joint_state=False)
    try:
        coordinator.build()
        task = create_trajectory_task(
            TaskConfig(name="joint_trajectory", type="ar_joint_trajectory", joint_names=["j"]),
            {"arm": SimpleNamespace(_wb_adapter=SimpleNamespace(guard=MotorProtection()))}
            if protected
            else {},
        )
        coordinator.add_task(task, task_type="ar_joint_trajectory")
        for _ in range(100):
            assert coordinator.task_invoke("joint_trajectory", "get_endpoint_status") == {
                "holding_endpoint": False
            }
        assert "get_endpoint_status" in coordinator._task_commands["joint_trajectory"]
        warning.assert_not_called()
    finally:
        coordinator.stop()
