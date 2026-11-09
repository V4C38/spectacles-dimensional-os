from types import SimpleNamespace
from unittest.mock import Mock

from dimos.ar.manipulation.operation import ManipulationOperation


def test_near_endpoint_requires_fresh_settled_feedback_and_confirmed_stop(monkeypatch):
    clock = [10.0]
    monkeypatch.setattr("dimos.ar.manipulation.operation.time.monotonic", lambda: clock[0])
    monkeypatch.setattr("dimos.ar.manipulation.operation.time.time", lambda: 100.1)
    target = SimpleNamespace(
        position=SimpleNamespace(x=0.0, y=0.0, z=0.0),
        orientation=SimpleNamespace(x=0.0, y=0.0, z=0.0, w=1.0),
    )
    observed = SimpleNamespace(
        end_effector_pose=SimpleNamespace(
            position=SimpleNamespace(x=0.009, y=0.0, z=0.0), orientation=target.orientation
        ),
        joints=SimpleNamespace(ts=100.0),
    )
    backend = Mock()
    backend.get_state.return_value = SimpleNamespace(
        execution_status=SimpleNamespace(name="EXECUTING"), groups={"arm": observed}
    )
    backend.cancel.return_value = SimpleNamespace(status=SimpleNamespace(name="ABORTED"))
    operation = ManipulationOperation(
        id="move",
        kind="executing",
        plan={"duration": 1.0},
        endpoint_pose=target,
        group="arm",
        started_at=0.0,
    )
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    clock[0] += 0.4
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    observed.joints.ts = 98.0
    clock[0] += 0.2
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    observed.joints.ts = 100.0
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    clock[0] += 0.6
    observed.joints.ts = 100.01
    backend.cancel.return_value.status.name = "UNCERTAIN"
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    observed.joints.ts = 100.02
    backend.cancel.return_value.status.name = "ABORTED"
    assert operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    assert operation.completed_id == "move"
    assert operation.id is None


def test_final_endpoint_stall_retires_execution_without_applying_gripper(monkeypatch):
    clock = [10.0]
    monkeypatch.setattr("dimos.ar.manipulation.operation.time.monotonic", lambda: clock[0])
    monkeypatch.setattr("dimos.ar.manipulation.operation.time.time", lambda: 100.2)
    target = SimpleNamespace(
        position=SimpleNamespace(x=0.0, y=0.0, z=0.0),
        orientation=SimpleNamespace(x=0.0, y=0.0, z=0.0, w=1.0),
    )
    observed = SimpleNamespace(
        end_effector_pose=SimpleNamespace(
            position=SimpleNamespace(x=0.04, y=0.0, z=0.0), orientation=target.orientation
        ),
        joints=SimpleNamespace(ts=100.0),
    )
    backend = Mock(endpoint_holding=True)
    backend.get_state.return_value = SimpleNamespace(
        execution_status=SimpleNamespace(name="EXECUTING"), groups={"arm": observed}
    )
    backend.cancel.return_value = SimpleNamespace(status=SimpleNamespace(name="ABORTED"))
    operation = ManipulationOperation(
        id="move",
        kind="executing",
        endpoint_pose=target,
        group="arm",
        started_at=0,
        final_gripper=("arm", 1, {"joint": 0.5}),
    )
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    clock[0] += 2.1
    observed.joints.ts = 100.1
    assert operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
    assert operation.failed_id == "move"
    assert operation.completed_id is None
    assert operation.gripper_error == "Target not reached"
    backend.set_gripper_position.assert_not_called()
    backend.cancel.assert_called_once()
    assert not operation.advance(backend, stopped=False, feedback_max_age_s=0.5)
