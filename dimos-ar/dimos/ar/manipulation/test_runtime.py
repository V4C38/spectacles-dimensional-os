import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.module import ARManipulationModule


def runtime():
    module = object.__new__(ARManipulationModule)
    module._ar_lock = threading.RLock()
    module._ar_planning = threading.Lock()
    module._ar_owner = module._ar_group = module._ar_token = None
    module._ar_plan = module._ar_operation = None
    module._ar_epoch = module._ar_sequence = 0
    module._ar_cancelling = False
    module._ar_stopped = False
    module._ar_stop_confirmed = True
    module._ar_retired = set()
    module.config = SimpleNamespace(
        feedback_max_age_s=0.5, following_tasks={"arm": "follow"}, wire_from_world=ReferencePose()
    )
    observed = SimpleNamespace(joints=SimpleNamespace(ts=time.time()))
    module.get_state = Mock(
        return_value=SimpleNamespace(
            groups={"arm": observed}, execution_status=SimpleNamespace(name="IDLE")
        )
    )
    module._control_coordinator = SimpleNamespace(task_invoke=Mock(), set_estop=Mock())
    module.clear_planned_path = Mock()
    module.cancel = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="ABORTED"), message="cancelled")
    )
    module.reset = Mock(return_value=SimpleNamespace(succeeded=True))
    module.execute = Mock(
        return_value=SimpleNamespace(status=SimpleNamespace(name="ACCEPTED"), message="accepted")
    )
    return module


def command(module, action, client="a", **payload):
    return module.ar_manipulation_command(client, {"action": action, "group_id": "arm", **payload})


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
    module.get_state().groups["arm"].joints.ts = 0
    command(module, "release", token=token)  # stale feedback must never block release
    with pytest.raises(ValueError):
        command(module, "update", **update)
    assert module._control_coordinator.task_invoke.call_args.args[1] == "clear"


def test_exact_plan_binding_and_stop_resume():
    module = runtime()
    module._ar_owner = "a"
    module._ar_group = "arm"
    module._ar_plan = {"plan_id": "reviewed"}
    with pytest.raises(ValueError, match="retired or replaced"):
        command(module, "execute", plan_id="replacement")
    module.execute.assert_not_called()
    assert command(module, "execute", plan_id="reviewed")["status"] == "accepted"
    module.execute.assert_called_once_with(blocking=False, plan_id="reviewed")
    module.ar_manipulation_stop()
    with pytest.raises(ValueError, match="stopped"):
        command(module, "acquire")
    module._ar_stop_confirmed = False
    with pytest.raises(ValueError, match="not confirmed"):
        command(module, "resume")
    module._ar_stop_confirmed = True
    command(module, "resume")
    assert module._ar_plan is None
    assert module._ar_token is None


def test_owner_disconnect_stops_even_with_observer_present():
    module = runtime()
    command(module, "acquire")
    module.ar_manipulation_disconnect("observer")
    assert not module._ar_stopped
    module.ar_manipulation_disconnect("a")
    assert module._ar_stopped
    command(module, "resume", client="observer2")
    with pytest.raises(ValueError, match="retired"):
        command(module, "acquire")


def test_uncertain_cancel_keeps_motion_disabled():
    module = runtime()
    command(module, "acquire")
    module.cancel.side_effect = TimeoutError("coordinator unavailable")
    with pytest.raises(TimeoutError):
        command(module, "cancel")
    assert module._ar_stopped
    assert not module._ar_stop_confirmed
    with pytest.raises(ValueError, match="not confirmed"):
        command(module, "resume")


def test_resume_cannot_interrupt_another_owners_active_control():
    module = runtime()
    command(module, "acquire")
    with pytest.raises(ValueError, match="stopped, unowned"):
        command(module, "resume", client="observer")
    module.reset.assert_not_called()
    assert module._ar_owner == "a"


def test_late_cancel_completion_cannot_clear_a_newer_emergency_stop():
    module = runtime()
    entered, release = threading.Event(), threading.Event()
    result = SimpleNamespace(status=SimpleNamespace(name="ABORTED"), message="cancelled")

    def cancel():
        if threading.current_thread().name == "ordinary-cancel":
            entered.set()
            assert release.wait(3)
        return result

    module.cancel.side_effect = cancel
    worker = threading.Thread(target=lambda: command(module, "cancel"), name="ordinary-cancel")
    worker.start()
    try:
        assert entered.wait(2)
        module.ar_manipulation_stop()
    finally:
        release.set()
        worker.join(3)
    assert not worker.is_alive()
    assert module._ar_stopped
    with pytest.raises(ValueError, match="stopped"):
        command(module, "acquire")
