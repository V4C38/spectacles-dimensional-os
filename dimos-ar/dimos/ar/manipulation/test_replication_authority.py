from __future__ import annotations

import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.manipulation.test_runtime import runtime


def _request(action: str, revision: int = 1, target: int = 7, lease: str | None = "grab-a", **body):
    return {
        "action": action,
        "group_id": "arm",
        "authority_epoch": "robot-reference",
        "authority_lease": lease,
        "authority_revision": revision,
        "target_revision": target,
        "authority_deadline": time.monotonic() + 1,
        **body,
    }


def _plan_request(**body):
    return _request("plan", position=[0.1, 0.2, 0.3], orientation=[0, 0, 0, 1], **body)


def _planning_backend(module):
    plan = SimpleNamespace(
        plan_id="checked-plan",
        trajectory=SimpleNamespace(
            joint_names=["joint"],
            duration=0.5,
            points=[
                SimpleNamespace(time_from_start=0, positions=[0]),
                SimpleNamespace(time_from_start=0.5, positions=[0.2]),
            ],
        ),
    )
    module.adapter.plan_to_poses = Mock(return_value=SimpleNamespace(succeeded=True, plan=plan))


def test_released_selected_plan_is_robot_owned_and_another_client_can_execute():
    module = runtime()
    _planning_backend(module)
    module.command("a", _plan_request())
    assert module.session.owner is None
    module.revoke_authority("robot-reference", "grab-a", 2, "released")
    assert module.operation.plan["target_revision"] == 7
    reply = module.command("b", _request("execute", revision=3, lease=None, plan_id="checked-plan"))
    assert reply["status"] == "accepted"
    module.disconnect("a")
    assert not module.session.stopped
    assert module.operation.id is not None


def test_busy_plan_rejection_preserves_accepted_plan_and_generation():
    module = runtime()
    module.operation.plan = {"plan_id": "existing"}
    generation = module.session.generation
    module.planning.acquire()
    try:
        with pytest.raises(ValueError, match="pending"):
            module.command("a", _plan_request())
    finally:
        module.planning.release()
    assert module.operation.plan == {"plan_id": "existing"}
    assert module.session.owner is None
    assert module.session.generation == generation


def test_accepted_execute_is_not_replayed_before_native_status_catches_up():
    module = runtime()
    _planning_backend(module)
    module.command("a", _plan_request())
    module.command("a", _request("execute", plan_id="checked-plan"))
    module.advance()  # Backend can still report its previous IDLE state.
    assert module.operation.id is not None
    with pytest.raises(ValueError, match="execution active"):
        module.command("a", _request("execute", plan_id="checked-plan"))
    module.adapter.execute.assert_called_once()


@pytest.mark.parametrize(
    "reason,accepted", [("released", True), ("target_changed", False), ("disconnect", False)]
)
def test_delayed_plan_finishes_only_for_unchanged_released_target(reason, accepted):
    module = runtime()
    _planning_backend(module)
    result = module.adapter.plan_to_poses.return_value
    entered, release = threading.Event(), threading.Event()
    replies = []

    def plan(*args, **kwargs):
        entered.set()
        assert release.wait(2)
        return result

    module.adapter.plan_to_poses.side_effect = plan
    worker = threading.Thread(target=lambda: replies.append(module.dispatch("a", _plan_request())))
    worker.start()
    try:
        assert entered.wait(1)
        module.revoke_authority("robot-reference", "grab-a", 2, reason)
    finally:
        release.set()
        worker.join(3)
    assert not worker.is_alive()
    assert (module.operation.plan is not None) is accepted
    assert replies[0]["status"] == ("planned" if accepted else "rejected")
    if not accepted:
        module.adapter.clear_planned_path.assert_called_once()


def test_stale_or_expired_native_authority_cannot_start_following():
    module = runtime()
    module.command("a", _request("acquire"))
    module.revoke_authority("robot-reference", "grab-a", 2)
    module.adapter.cancel.reset_mock()
    with pytest.raises(ValueError, match="retired"):
        module.command("a", _request("acquire"))
    with pytest.raises(ValueError, match="expired"):
        module.command("b", _request("acquire", revision=3, authority_deadline=0))
    module.adapter.cancel.assert_not_called()


def test_revocation_arriving_before_first_native_command_keeps_tombstone():
    module = runtime()
    module.revoke_authority("robot-reference", "grab-a", 2, "disconnect")
    with pytest.raises(ValueError, match="retired"):
        module.command("a", _request("acquire"))
    module.adapter.cancel.assert_not_called()


def test_delayed_pre_stop_resume_cannot_unlatch_newer_emergency_stop():
    module = runtime()
    module.command("a", _request("acquire"))
    delayed_resume = _request("resume", revision=2)
    module.emergency_stop(epoch="robot-reference", revision=3)
    module.adapter.set_estop.reset_mock()
    module.adapter.reset.reset_mock()
    with pytest.raises(ValueError, match="retired"):
        module.command("a", delayed_resume)
    assert module.session.stopped
    module.adapter.reset.assert_not_called()
    module.adapter.set_estop.assert_not_called()
    assert module.command("b", _request("resume", revision=4, lease=None))["status"] == "resumed"


def test_stop_before_first_native_command_retires_queued_admission():
    module = runtime()
    delayed_acquire = _request("acquire")
    module.emergency_stop(epoch="robot-reference", revision=3)
    with pytest.raises(ValueError, match="retired"):
        module.command("a", delayed_acquire)


def test_new_target_retires_released_plan_even_before_new_owner_native_command():
    module = runtime()
    _planning_backend(module)
    planned = module.adapter.plan_to_poses.return_value
    entered, finish = threading.Event(), threading.Event()
    replies = []

    def plan(*_args, **_kwargs):
        entered.set()
        assert finish.wait(2)
        return planned

    module.adapter.plan_to_poses.side_effect = plan
    worker = threading.Thread(target=lambda: replies.append(module.dispatch("a", _plan_request())))
    worker.start()
    assert entered.wait(1)
    try:
        module.revoke_authority("robot-reference", "grab-a", 2, "released")
        # B's shared edit arrived, but its first native planning RPC is pending.
        module.revoke_authority("robot-reference", "grab-b", 4, "target_changed")
    finally:
        finish.set()
        worker.join(3)
    assert replies[0]["status"] == "rejected"
    assert module.operation.plan is None


def test_plan_for_old_target_cannot_execute_after_another_revision_is_admitted():
    module = runtime()
    _planning_backend(module)
    module.command("a", _plan_request())
    with pytest.raises(ValueError, match="retired or replaced"):
        module.command(
            "b", _request("execute", revision=2, target=8, lease=None, plan_id="checked-plan")
        )
    module.adapter.execute.assert_not_called()


def test_stop_attempts_native_cancel_and_estop_when_follow_clear_fails():
    module = runtime()
    module.adapter.task_invoke.side_effect = TimeoutError("following unavailable")
    with pytest.raises(TimeoutError):
        module.emergency_stop()
    module.adapter.cancel.assert_called_once()
    module.adapter.set_estop.assert_called_once_with(True)
    assert module.session.stopped
    assert not module.session.stop_confirmed


def test_release_failure_retires_token_and_attempts_other_following_tasks_and_estop():
    module = runtime()
    module.command("a", _request("acquire"))
    module.config.following_tasks["second_arm"] = "other-follow"
    module.adapter.task_invoke.side_effect = lambda task, *_: (
        (_ for _ in ()).throw(TimeoutError("clear failed")) if task == "follow" else None
    )
    with pytest.raises(TimeoutError):
        module.revoke_authority("robot-reference", "grab-a", 2, "disconnect")
    assert module.session.token is None
    assert module.session.stopped
    assert any(call.args[0] == "other-follow" for call in module.adapter.task_invoke.call_args_list)
    module.adapter.set_estop.assert_called_once_with(True)
