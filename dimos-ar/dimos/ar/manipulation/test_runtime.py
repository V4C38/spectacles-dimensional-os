import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.operation import ManipulationOperation
from dimos.ar.manipulation.runtime import ManipulationRuntime
from dimos.ar.manipulation.session import ManipulationSession
from dimos.ar.manipulation.zero import JointZeroOperation


def runtime():
    module = object.__new__(ManipulationRuntime)
    module.session = ManipulationSession()
    module.operation = ManipulationOperation()
    module.lock = threading.RLock()
    module.planning = threading.Lock()
    module.started = True
    module.zero = JointZeroOperation(module)
    module.adapter = SimpleNamespace(ready=False, feedback=SimpleNamespace(ts=time.time()))
    module.config = SimpleNamespace(
        feedback_max_age_s=0.5, following_tasks={"arm": "follow"}, wire_from_world=ReferencePose()
    )
    observed = SimpleNamespace(joints=SimpleNamespace(ts=time.time()))
    module.adapter.get_state = Mock(
        return_value=SimpleNamespace(
            groups={"arm": observed}, execution_status=SimpleNamespace(name="IDLE")
        )
    )
    module.adapter.task_invoke = Mock()
    module.adapter.set_estop = Mock()
    module.adapter.quiesce = Mock()
    module.adapter.clear_planned_path = Mock()
    module.adapter.cancel = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="ABORTED"), message="cancelled")
    )
    module.adapter.reset = Mock(
        return_value=SimpleNamespace(succeeded=True, status=SimpleNamespace(name="SUCCEEDED"))
    )
    module.wait_for_execution = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="COMPLETED"))
    )
    module.adapter.execute = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="ACCEPTED"), message="accepted")
    )
    return module


def command(module, action, client="a", **payload):
    return module.command(client, {"action": action, "group_id": "arm", **payload})


def test_follow_owner_ordering_release_and_retired_token():
    module = runtime()
    token = command(module, "acquire")["token"]
    with pytest.raises(ValueError, match="owned"):
        command(module, "acquire", client="observer")
    update = {
        "token": token,
        "sequence": 1,
        "ts": time.time(),
        "position": [0, 0, 0.3],
        "orientation": [0, 0, 0, 1],
    }
    command(module, "update", **update)
    with pytest.raises(ValueError, match="out of order"):
        command(module, "update", **update)
    module.adapter.get_state().groups["arm"].joints.ts = 0
    command(module, "release", token=token)  # stale feedback must never block release
    with pytest.raises(ValueError):
        command(module, "update", **update)
    assert module.adapter.task_invoke.call_args.args[1] == "clear"


def test_exact_plan_binding_and_stop_resume():
    module = runtime()
    module.session.owner = "a"
    module.session.group_id = "arm"
    module.operation.plan = {"plan_id": "reviewed"}
    with pytest.raises(ValueError, match="retired or replaced"):
        command(module, "execute", plan_id="replacement")
    module.adapter.execute.assert_not_called()
    assert command(module, "execute", plan_id="reviewed")["status"] == "accepted"
    module.adapter.execute.assert_called_once_with(blocking=False, plan_id="reviewed")
    module.emergency_stop()
    with pytest.raises(ValueError, match="stopped"):
        command(module, "acquire")
    module.session.stop_confirmed = False
    with pytest.raises(ValueError, match="not confirmed"):
        command(module, "resume")
    module.session.stop_confirmed = True
    command(module, "resume")
    assert module.operation.plan is None
    assert module.session.token is None


def test_owner_disconnect_stops_even_with_observer_present():
    module = runtime()
    command(module, "acquire")
    module.disconnect("observer")
    assert not module.session.stopped
    module.disconnect("a")
    assert module.session.stopped
    command(module, "resume", client="observer2")
    with pytest.raises(ValueError, match="retired"):
        command(module, "acquire")


def test_uncertain_cancel_keeps_motion_disabled():
    module = runtime()
    command(module, "acquire")
    module.adapter.cancel.side_effect = TimeoutError("coordinator unavailable")
    with pytest.raises(TimeoutError):
        command(module, "cancel")
    assert module.session.stopped
    assert not module.session.stop_confirmed
    with pytest.raises(ValueError, match="not confirmed"):
        command(module, "resume")


def test_resume_cannot_interrupt_another_owners_active_control():
    module = runtime()
    command(module, "acquire")
    with pytest.raises(ValueError, match="stopped, unowned"):
        command(module, "resume", client="observer")
    module.adapter.reset.assert_not_called()
    assert module.session.owner == "a"


def test_late_cancel_completion_cannot_clear_a_newer_emergency_stop():
    module = runtime()
    entered, release = threading.Event(), threading.Event()
    result = SimpleNamespace(status=SimpleNamespace(name="ABORTED"), message="cancelled")

    def cancel():
        if threading.current_thread().name == "ordinary-cancel":
            entered.set()
            assert release.wait(3)
        return result

    module.adapter.cancel.side_effect = cancel
    worker = threading.Thread(target=lambda: command(module, "cancel"), name="ordinary-cancel")
    worker.start()
    try:
        assert entered.wait(2)
        module.emergency_stop()
    finally:
        release.set()
        worker.join(3)
    assert not worker.is_alive()
    assert module.session.stopped
    with pytest.raises(ValueError, match="stopped"):
        command(module, "acquire")


def test_reset_zero_waits_for_feedback_and_preserves_gripper(monkeypatch):
    import dimos.ar.manipulation.zero as implementation

    module = runtime()
    observed = module.adapter.get_state().groups["arm"]
    observed.joints.name, observed.joints.position = ["joint"], [0.0]
    module.adapter.list_planning_groups = Mock(
        return_value=[SimpleNamespace(id="arm", joint_names=["joint"])]
    )
    module.adapter.plan_to_joints = Mock(
        return_value=SimpleNamespace(
            succeeded=True,
            plan=SimpleNamespace(plan_id="zero", trajectory=SimpleNamespace(duration=0.2)),
        )
    )
    clock = [1.0]
    monkeypatch.setattr(implementation.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(
        implementation.time,
        "sleep",
        lambda dt: (
            clock.__setitem__(0, clock[0] + dt),
            setattr(observed.joints, "ts", observed.joints.ts + dt),
        ),
    )
    wall_start = observed.joints.ts
    monkeypatch.setattr(implementation.time, "time", lambda: wall_start + clock[0] - 1)
    result = command(module, "reset_joints", speed_scale=0.1)
    assert result["status"] == "completed"
    module.adapter.plan_to_joints.assert_not_called()
    module.adapter.execute.assert_not_called()
    assert module.session.owner is None
    assert module.adapter.reset.call_count == 2
    module.wait_for_execution.assert_not_called()
    # Reset releases the motion lease; following works without E-stop/resume.
    token = command(module, "acquire")["token"]
    assert token
    command(module, "release", token=token)
    module.adapter.set_estop.assert_not_called()


def test_shutdown_never_clears_estop_or_moves():
    module = runtime()
    module.session.stopped = True
    result = command(module, "prepare_shutdown")
    assert result["status"] == "skipped"
    module.adapter.execute.assert_not_called()
    module.adapter.set_estop.assert_not_called()


def test_reset_planning_failure_never_executes():
    module = runtime()
    module.adapter.list_planning_groups = Mock(
        return_value=[SimpleNamespace(id="arm", joint_names=["joint"])]
    )
    module.adapter.get_state().groups["arm"].joints.name = ["joint"]
    module.adapter.get_state().groups["arm"].joints.position = [0.3]
    module.adapter.plan_to_joints = Mock(
        return_value=SimpleNamespace(succeeded=False, message="collision")
    )
    with pytest.raises(ValueError, match="collision"):
        command(module, "reset_joints")
    module.adapter.execute.assert_not_called()
    assert module.session.owner is None


def test_follow_speed_scales_the_solver_envelope_without_mutating_limits(monkeypatch):
    from dimos.ar.manipulation.following import SpeedScaledPoseTargetSolver
    from dimos.control.tasks.pose_target_ik import PinkPoseTargetSolver

    captured = {}
    monkeypatch.setattr(
        PinkPoseTargetSolver, "_step_frame_targets", lambda self, **kw: captured.update(kw)
    )
    solver = object.__new__(SpeedScaledPoseTargetSolver)
    solver.speed_scale = 0.2
    limits = {"joint": 2.0}
    solver._step_frame_targets(max_joint_velocity_rad_s=5.0, joint_velocity_limits_rad_s=limits)
    assert captured["max_joint_velocity_rad_s"] == 1.0
    assert captured["joint_velocity_limits_rad_s"] == {"joint": 0.4}
    assert limits == {"joint": 2.0}


def test_shutdown_parking_caps_speed_and_times_out_without_claiming_success(monkeypatch):
    import dimos.ar.manipulation.zero as implementation

    module = runtime()
    module.session.owner, module.session.group_id = "old-client", "arm"
    observed = module.adapter.get_state().groups["arm"]
    observed.joints.name, observed.joints.position = ["joint"], [0.5]
    module.adapter.list_planning_groups = Mock(
        return_value=[SimpleNamespace(id="arm", joint_names=["joint"])]
    )
    module.adapter.plan_to_joints = Mock(
        return_value=SimpleNamespace(
            succeeded=True,
            plan=SimpleNamespace(plan_id="zero", trajectory=SimpleNamespace(duration=0.2)),
        )
    )
    clock = [1.0]
    monkeypatch.setattr(implementation.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(
        implementation.time, "sleep", lambda dt: clock.__setitem__(0, clock[0] + 10)
    )
    with pytest.raises(ValueError, match="settling deadline"):
        command(module, "prepare_shutdown", client="supervisor", speed_scale=0.8)
    assert module.adapter.plan_to_joints.call_args.kwargs["speed_scale"] == 0.2
    assert module.adapter.reset.call_count == 2
    assert module.session.owner is None


@pytest.mark.parametrize(
    "execution,position,stopped,expected",
    [
        ("COMPLETED", 0.3, False, 1),
        ("ABORTED", 0.3, False, 0),
        ("COMPLETED", 0.0, False, 0),
        ("COMPLETED", 0.3, True, 0),
    ],
)
def test_deferred_gripper_requires_success_and_confirmed_endpoint(
    execution, position, stopped, expected
):
    module = runtime()
    module.adapter.ready = True
    module.adapter.ready = True
    module.descriptor = {}
    module.operation.id = "operation"
    module.operation.final_gripper = ("arm", 1.0, {"joint": 0.3})
    module.session.stopped = stopped
    observed = module.adapter.get_state().groups["arm"]
    observed.joints.name = ["joint"]
    observed.joints.position = [position]
    observed.end_effector_pose = None
    observed.gripper_position = 0.0
    module.adapter.get_state().execution_status.name = execution
    module.adapter.get_state().error = None
    module.adapter.list_planning_groups = Mock(return_value=[])
    module.adapter.set_gripper_position = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="SUCCEEDED"))
    )
    module.advance()
    module.advance()
    assert module.adapter.set_gripper_position.call_count == expected
    if execution == "COMPLETED" and not stopped and position == 0:
        observed.joints.position = [0.3]
        observed.joints.ts = time.time()
        module.advance()
        assert module.adapter.set_gripper_position.call_count == 1


def test_follow_factory_uses_the_model_velocity_limits(monkeypatch):
    from dimos.ar.manipulation import following
    from dimos.control.coordinator import TaskConfig
    from dimos.robot.manipulators.openyam.config import make_openyam_model_config

    model = make_openyam_model_config()
    captured = {}
    monkeypatch.setattr(following, "SpeedScaledPoseTargetSolver", lambda config: None)
    monkeypatch.setattr(
        following,
        "SpeedScaledCartesianIKTask",
        lambda name, config, **kwargs: captured.update(config=config),
    )
    following.create_task(
        TaskConfig(
            name="follow",
            type="ar_cartesian_ik",
            joint_names=model.joint_names,
            params={"robot_model": model, "target_frame": "gripper_tip"},
        ),
        {},
    )
    config = captured["config"]
    assert config.joint_velocity_limits_rad_s == dict.fromkeys(model.joint_names, 1.0)
    assert config.max_joint_velocity_rad_s == 1.0


def test_deferred_gripper_uses_the_official_coordinator_bridge():
    from types import MethodType

    from dimos.manipulation.manipulation_module import ManipulationModule

    module = runtime()
    module.config.model = SimpleNamespace(gripper_hardware_id="openyam")
    module._resolve_gripper_group = lambda group: SimpleNamespace(id=group)
    module.adapter.config = module.config
    module.adapter._resolve_gripper_group = module._resolve_gripper_group
    module.adapter._control_coordinator = SimpleNamespace(task_invoke=module.adapter.task_invoke)
    module.adapter.set_gripper_position = MethodType(
        ManipulationModule.set_gripper_position, module.adapter
    )
    module.adapter.ready = True
    module.adapter.ready = True
    module.descriptor = {}
    module.operation.id = "operation"
    module.operation.final_gripper = ("arm", 1.0, {"joint": 0.3})
    observed = module.adapter.get_state().groups["arm"]
    observed.joints.name, observed.joints.position = ["joint"], [0.3]
    observed.end_effector_pose = None
    observed.gripper_position = 0.0
    module.adapter.get_state().execution_status.name = "COMPLETED"
    module.adapter.get_state().error = None
    module.adapter.list_planning_groups = Mock(return_value=[])
    module.advance()
    module.advance()
    module.adapter.task_invoke.assert_called_once_with(
        "openyam_gripper", "set_normalized", {"values": [1.0]}
    )


def test_snapshot_places_the_model_base_in_wire_coordinates_once():
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

    module = runtime()
    module.config.model = SimpleNamespace(base_pose=PoseStamped(position=[0.12, 0.04, 0.0]))
    module.config.wire_from_world = ReferencePose(position=(0.2, 0.0, 0.0))
    module.adapter.ready = True
    module.adapter.ready = True
    module.descriptor = {}
    observed = module.adapter.get_state().groups["arm"]
    observed.joints = None
    observed.end_effector_pose = None
    observed.gripper_position = None
    module.adapter.get_state().error = None
    module.adapter.list_planning_groups = Mock(return_value=[])
    snapshot = module.snapshot()
    assert snapshot["root_pose"]["position"] == pytest.approx([0.32, 0.04, 0.0])


def zero_fixture(monkeypatch, *, position=0.015, duration=0.2, refresh=True):
    import dimos.ar.manipulation.zero as implementation

    module = runtime()
    observed = module.adapter.get_state().groups["arm"]
    observed.joints.name, observed.joints.position = ["joint"], [position]
    module.adapter.list_planning_groups = Mock(
        return_value=[SimpleNamespace(id="arm", joint_names=["joint"])]
    )
    module.adapter.plan_to_joints = Mock(
        return_value=SimpleNamespace(
            succeeded=True,
            plan=SimpleNamespace(plan_id="zero", trajectory=SimpleNamespace(duration=duration)),
        )
    )
    clock = [1.0]
    wall = observed.joints.ts
    monkeypatch.setattr(implementation.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(implementation.time, "time", lambda: wall + clock[0] - 1)

    def step(dt):
        clock[0] += dt
        if refresh:
            observed.joints.ts = time.time()

    monkeypatch.setattr(implementation.time, "sleep", step)
    return module, observed, clock


def test_already_zero_requires_settling_without_another_trajectory(monkeypatch):
    module, _, clock = zero_fixture(monkeypatch, duration=1.0)
    module.adapter.get_state().execution_status.name = "EXECUTING"
    module.wait_for_execution.return_value.status.name = "EXECUTING"
    result = command(module, "reset_joints")
    assert result["status"] == "completed"
    assert 1.5 <= clock[0] < 2.0
    module.adapter.execute.assert_not_called()
    module.wait_for_execution.assert_not_called()
    assert module.adapter.reset.call_count == 2
    assert module.session.owner is None
    assert not module.session.stopped


def test_reset_requires_new_measurements_and_recovers_from_stale_feedback(monkeypatch):
    module, _, _ = zero_fixture(monkeypatch, refresh=False)
    with pytest.raises(ValueError, match="stale"):
        command(module, "reset_joints")
    assert module.adapter.reset.call_count == 2
    assert module.session.owner is None
    assert not module.session.stopped


def test_reset_outside_tolerance_times_out_and_leaves_no_motion_lease(monkeypatch):
    module, _, _ = zero_fixture(monkeypatch, position=0.03)
    with pytest.raises(ValueError, match="settling deadline"):
        command(module, "reset_joints")
    assert module.adapter.reset.call_count == 2
    assert module.session.owner is None
    assert not module.session.stopped


@pytest.mark.parametrize("emergency", [False, True])
def test_stop_interrupts_reset_planning_before_execution(monkeypatch, emergency):
    module, _, _ = zero_fixture(monkeypatch, position=0.3)
    planned = module.adapter.plan_to_joints.return_value

    def plan(*args, **kwargs):
        if emergency:
            module.emergency_stop()
        else:
            command(module, "cancel")
        return planned

    module.adapter.plan_to_joints.side_effect = plan
    with pytest.raises(ValueError, match="interrupted"):
        command(module, "reset_joints")
    module.adapter.execute.assert_not_called()
    # Cleanup of the retired reset cannot clear E-stop or cancel another operation.
    assert module.adapter.reset.call_count == 1
    assert module.session.owner is None
    assert module.session.stopped == emergency


def test_retired_reset_cleanup_preserves_new_ownership(monkeypatch):
    module, _, _ = zero_fixture(monkeypatch, position=0.3)
    planned = module.adapter.plan_to_joints.return_value

    def plan(*args, **kwargs):
        command(module, "cancel")
        module.session.owner, module.session.group_id = "new-owner", "arm"
        return planned

    module.adapter.plan_to_joints.side_effect = plan
    with pytest.raises(ValueError, match="interrupted"):
        command(module, "reset_joints")
    assert module.session.owner == "new-owner"
    module.adapter.execute.assert_not_called()
    assert module.adapter.reset.call_count == 1


def test_reset_rejection_while_planning_does_not_change_ownership(monkeypatch):
    module, _, _ = zero_fixture(monkeypatch)
    module.session.owner, module.session.group_id = "a", "arm"
    epoch = module.session.generation
    module.planning.acquire()
    try:
        with pytest.raises(ValueError, match="Planning is pending"):
            command(module, "reset_joints")
        assert module.session.owner == "a"
        assert module.session.generation == epoch
        module.adapter.reset.assert_not_called()
    finally:
        module.planning.release()


def test_reset_unconfirmed_stop_stays_latched(monkeypatch):
    module, _, _ = zero_fixture(monkeypatch)
    module.adapter.reset.side_effect = [
        SimpleNamespace(succeeded=True),
        SimpleNamespace(succeeded=False, message="stop unconfirmed"),
    ]
    with pytest.raises(ValueError, match="unconfirmed"):
        command(module, "reset_joints")
    assert module.session.stopped
    assert not module.session.stop_confirmed
    assert module.session.owner is None
    with pytest.raises(ValueError, match="not confirmed"):
        command(module, "resume")


def test_reset_cleanup_rpc_failure_keeps_motion_disabled(monkeypatch):
    module, _, _ = zero_fixture(monkeypatch, position=0.03)
    module.adapter.reset.side_effect = [
        SimpleNamespace(succeeded=True),
        TimeoutError("coordinator unavailable"),
    ]
    with pytest.raises(TimeoutError, match="coordinator unavailable"):
        command(module, "reset_joints")
    assert module.session.stopped
    assert not module.session.stop_confirmed
    assert module.session.owner is None


def test_snapshot_does_not_touch_unfinalized_world_before_start():
    module = runtime()
    module.started = False
    module.adapter.get_state.side_effect = RuntimeError("World must be finalized first")
    assert module.snapshot()["available"] is False
    module.adapter.get_state.assert_not_called()


def test_zero_settling_failure_returns_promptly_with_joint_error(monkeypatch):
    module, _, clock = zero_fixture(monkeypatch, position=0.03, duration=1.0)
    with pytest.raises(ValueError, match="joint error 0.0300 rad"):
        command(module, "reset_joints")
    assert clock[0] < 5.1
    assert module.session.owner is None


def test_follow_ik_failure_keeps_lease_and_recovers(monkeypatch):

    module = runtime()
    module.adapter.ready = True
    module.adapter.evaluation_code = lambda evaluation: "joint_limit"
    token = command(module, "acquire")["token"]
    outcome = SimpleNamespace(success=False, message="joint limits", target_joints=None)
    module.adapter.evaluate = lambda *args: outcome
    body = {
        "token": token,
        "sequence": 1,
        "ts": time.time(),
        "position": [0, 0, 0.3],
        "orientation": [0, 0, 0, 1],
    }
    failed = command(module, "update", **body)
    assert failed["status"] == "infeasible"
    assert failed["code"] == "joint_limit"
    assert module.session.token == token
    outcome.success = True
    outcome.target_joints = SimpleNamespace(name=["joint"], position=[0.2])
    module.session.evaluated_at = float("-inf")
    recovered = command(module, "update", **{**body, "sequence": 2})
    assert recovered["joints"] == {"joint": 0.2}
    assert module.session.token == token
    command(module, "release", token=token)
    assert module.session.token is None


def test_follow_solver_does_not_hold_ownership_lock_against_stop(monkeypatch):

    module = runtime()
    module.adapter.ready = True
    module.adapter.evaluation_code = lambda evaluation: "joint_limit"
    token = command(module, "acquire")["token"]
    entered, release = threading.Event(), threading.Event()

    def evaluate(request):
        entered.set()
        assert release.wait(3)
        return SimpleNamespace(success=True, target_joints=None)

    module.adapter.evaluate = lambda group, pose: evaluate(pose)
    replies = []
    worker = threading.Thread(
        target=lambda: replies.append(
            command(
                module,
                "update",
                token=token,
                sequence=1,
                ts=time.time(),
                position=[0, 0, 0.3],
                orientation=[0, 0, 0, 1],
            )
        )
    )
    worker.start()
    try:
        assert entered.wait(2)
        module.emergency_stop()
        assert module.session.stopped
    finally:
        release.set()
        worker.join(3)
    assert replies[0]["code"] == "retired"
    assert not any(
        call.args[1] == "on_cartesian_command" for call in module.adapter.task_invoke.call_args_list
    )


def test_public_rpc_returns_expected_rejections_without_throwing():
    module = runtime()
    module.session.stopped = True
    result = module.dispatch("a", {"action": "acquire", "group_id": "arm"})
    assert result["status"] == "rejected"
    assert "stopped" in result["message"]


def test_readiness_requires_real_joint_feedback_before_querying_gripper():
    module = runtime()
    module.adapter.feedback = None
    module.adapter.ready = True
    module.adapter.ready = True
    assert module.snapshot()["available"] is False
    module.adapter.get_state.assert_not_called()


def test_source_feedback_clock_is_preserved(monkeypatch):
    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
    from dimos.ar.manipulation.module import ARManipulationModule, ManipulationModule

    native = object.__new__(ARManipulationModule)
    native.config = SimpleNamespace(
        joint_state_aliases={"hardware": "joint"}, model=SimpleNamespace(joint_names=["joint"])
    )
    native._adapter = DimOSManipulationAdapter(native)
    parent = Mock()
    monkeypatch.setattr(ManipulationModule, "_on_joint_state", parent)
    native._on_joint_state(SimpleNamespace(name=["hardware"], position=[0.2], ts=10.0))
    assert native._adapter.feedback.ts == 10.0
    parent.assert_called_once()


def test_failed_streaming_solver_holds_target_until_it_changes(monkeypatch):
    from dimos.ar.manipulation.following import SpeedScaledCartesianIKTask
    from dimos.control.tasks.cartesian_ik_task.cartesian_ik_task import CartesianIKTask

    task = object.__new__(SpeedScaledCartesianIKTask)
    task._solver = SimpleNamespace(failure=None)
    submit = Mock()
    clear = Mock()
    task.clear = clear
    monkeypatch.setattr(CartesianIKTask, "on_cartesian_command", submit)
    monkeypatch.setattr(CartesianIKTask, "compute", lambda *args: None)
    point = SimpleNamespace(
        position=SimpleNamespace(x=0, y=0, z=0.3), orientation=SimpleNamespace(x=0, y=0, z=0, w=1)
    )
    task.on_cartesian_command(point)
    task._solver.failure = "QP failed"
    task.compute(object())
    clear.assert_called_once()
    task.on_cartesian_command(point)
    assert submit.call_count == 1
    assert task.get_failure() == "QP failed"
    point.position.z = 0.2
    task.on_cartesian_command(point)
    assert submit.call_count == 2
    assert task.get_failure() is None


def test_quiesced_teardown_does_not_cancel_into_a_closed_coordinator(monkeypatch):
    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
    from dimos.ar.manipulation.module import ARManipulationModule, ManipulationModule

    native = object.__new__(ARManipulationModule)
    native.config = SimpleNamespace()
    native._adapter = DimOSManipulationAdapter(native)
    native._runtime = ManipulationRuntime(native._adapter)
    native._runtime.session.quiesced = True
    native._closing = False
    native._lifecycle_stop = threading.Event()
    native._lifecycle_thread = None
    original = SimpleNamespace(cancel=Mock(), close=Mock())
    native._execution_manager = original

    def native_stop(self):
        result = self._execution_manager.cancel()
        assert result.status.name == "NO_EXECUTION"
        self._execution_manager.close()

    monkeypatch.setattr(ManipulationModule, "stop", native_stop)
    native.stop()
    native.stop()
    original.cancel.assert_not_called()
    original.close.assert_called_once()


def test_snapshot_reads_never_advance_or_expire_following():
    module = runtime()
    token = command(module, "acquire")["token"]
    module.adapter.ready = True
    module.descriptor = {}
    module.adapter.get_state().error = None
    observed = module.adapter.get_state().groups["arm"]
    observed.joints = None
    observed.end_effector_pose = None
    observed.gripper_position = None
    module.adapter.list_planning_groups = Mock(return_value=[])
    module.session.updated_at = time.monotonic() - 1
    module.adapter.task_invoke.reset_mock()
    assert module.snapshot()["following"] is True
    assert module.snapshot()["following"] is True
    assert module.session.token == token
    module.adapter.task_invoke.assert_not_called()
    module.advance()
    assert module.session.token is None
    module.adapter.task_invoke.assert_called_once_with("follow", "clear")


def test_following_expires_without_polling_even_when_feedback_is_missing():
    module = runtime()
    command(module, "acquire")
    module.adapter.feedback = None
    module.session.updated_at = time.monotonic() - 1
    module.advance()
    assert module.session.token is None
    assert module.session.owner is None
    module.adapter.task_invoke.assert_called_with("follow", "clear")


def test_deferred_gripper_does_not_use_republished_stale_feedback():
    module = runtime()
    module.operation.id = "execution"
    module.operation.final_gripper = ("arm", 1.0, {"joint": 0.3})
    module.adapter.get_state().execution_status.name = "COMPLETED"
    module.adapter.get_state().groups["arm"].joints = SimpleNamespace(
        ts=time.time() - 10, name=["joint"], position=[0.3]
    )
    module.adapter.set_gripper_position = Mock()
    module.advance()
    module.adapter.set_gripper_position.assert_not_called()
    assert module.operation.final_gripper is not None


@pytest.mark.parametrize("speed", [0.001, 0.049, 0.05, 0.2, 1.0])
def test_following_accepts_the_documented_positive_speed_range(speed):
    from dimos.ar.manipulation.following import SpeedScaledCartesianIKTask

    task = object.__new__(SpeedScaledCartesianIKTask)
    task._solver = SimpleNamespace(speed_scale=0.2)
    task.set_speed_scale(speed)
    assert task._solver.speed_scale == speed


@pytest.mark.parametrize("speed", [0, -1, float("nan"), float("inf"), 1.001])
def test_following_rejects_invalid_speed_without_mutation(speed):
    from dimos.ar.manipulation.following import SpeedScaledCartesianIKTask

    task = object.__new__(SpeedScaledCartesianIKTask)
    task._solver = SimpleNamespace(speed_scale=0.2)
    with pytest.raises(ValueError):
        task.set_speed_scale(speed)
    assert task._solver.speed_scale == 0.2


def test_snapshot_does_not_actuate_a_completed_deferred_gripper():
    module = runtime()
    module.adapter.ready = True
    module.descriptor = {}
    module.operation.id = "execution"
    module.operation.final_gripper = ("arm", 1.0, {"joint": 0.3})
    state = module.adapter.get_state()
    state.error = None
    state.execution_status.name = "COMPLETED"
    state.groups["arm"] = SimpleNamespace(
        joints=SimpleNamespace(ts=time.time(), name=["joint"], position=[0.3]),
        end_effector_pose=None,
        gripper_position=0.0,
    )
    module.adapter.list_planning_groups = Mock(return_value=[])
    module.adapter.set_gripper_position = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="SUCCEEDED"))
    )
    module.snapshot()
    module.snapshot()
    module.adapter.set_gripper_position.assert_not_called()
    module.advance()
    module.adapter.set_gripper_position.assert_called_once_with(1.0, planning_group="arm")
