"""Native completion and takeover use robot authority, never the released client."""

import time
from types import SimpleNamespace

import pytest

from dimos.ar.manipulation.test_runtime import runtime


@pytest.fixture
def tail_runtime(monkeypatch):
    module = runtime()
    now = [10.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    monkeypatch.setattr(time, "time", lambda: 1000 + now[0])
    observation = module.adapter.get_state().groups["arm"]
    observation.joints = SimpleNamespace(ts=time.time(), name=["joint"], position=[0.0])
    module.adapter.feedback.ts = time.time()
    module.adapter.ready = True
    module.adapter.task_invoke.return_value = None
    module.adapter.evaluate = lambda *args: SimpleNamespace(
        success=True,
        message="validated",
        target_joints=SimpleNamespace(name=["joint"], position=[0.25]),
        group_poses={},
    )
    module._control_epoch = None
    module.heartbeat("robot", 5, time.monotonic() + 0.5)

    def request(action, revision=5, lease="a", **fields):
        return {
            "action": action,
            "group_id": "arm",
            "authority_epoch": "robot",
            "authority_revision": revision,
            "authority_lease": lease,
            "authority_deadline": time.monotonic() + 0.5,
            "target_revision": 3,
            **fields,
        }

    token = module.command("owner", request("acquire"))["token"]
    update = request(
            "update",
            token=token,
            sequence=1,
            ts=time.time(),
            position=[0.1, 0.2, 0.3],
            orientation=[0, 0, 0, 1],
            speed_scale=0.5,
        )
    module.command("owner", update)
    module.evaluate_following("owner", update)
    module.revoke_authority("robot", "a", 6, "released")
    assert module.session.owner is None and module.session.token is None
    assert module.following_tail is not None
    return module, now, observation, request


def refresh(module, observation):
    observation.joints.ts = time.time()
    module.heartbeat("robot", 6, time.monotonic() + 0.5)


def test_release_keeps_validated_target_without_old_owner_heartbeats(tail_runtime):
    module, now, observation, _request = tail_runtime
    module.disconnect("owner")
    now[0] += 0.2
    refresh(module, observation)
    module.advance()
    assert module.following_tail is not None
    assert not module.session.stopped
    assert module.following_tail.wire()["target_revision"] == 3
    assert module.adapter.task_invoke.call_args_list[-2].args[1] == "set_target"


def test_new_grab_supersedes_tail_and_late_old_release(tail_runtime):
    module, _now, _observation, request = tail_runtime
    module.revoke_authority("robot", "b", 7, "superseded")
    module.revoke_authority("robot", "a", 6, "released")
    assert module.following_tail is None
    module.command("replacement", request("acquire", revision=8, lease="b"))
    module.disconnect("owner")
    assert module.session.owner == "replacement"
    assert not module.session.stopped


def test_arrival_requires_distinct_feedback_spanning_half_second(tail_runtime):
    module, now, observation, _request = tail_runtime
    observation.joints.position = [0.25]
    module.advance()
    now[0] += 0.49
    module.heartbeat("robot", 6, time.monotonic() + 0.5)
    module.advance()  # Repeated measurement cannot prove settling.
    assert module.following_tail is not None
    now[0] += 0.02
    refresh(module, observation)
    module.advance()
    assert module.following_tail is None
    assert not module.session.stopped


def test_tail_deadline_is_bounded_even_with_control_heartbeat(tail_runtime):
    module, now, observation, _request = tail_runtime
    now[0] += 55
    refresh(module, observation)
    module.advance()
    assert module.following_tail is None


@pytest.mark.parametrize("execution", [False, True])
def test_control_plane_loss_stops_tail_and_accepted_execution(tail_runtime, execution):
    module, now, observation, _request = tail_runtime
    if execution:
        module.following_tail = None
        module.operation.id = "accepted"
        module.operation.kind = "executing"
    now[0] += 0.501
    observation.joints.ts = time.time()
    module.advance()
    assert module.session.stopped and module.session.stop_confirmed
    assert module.following_tail is None
    assert module.operation.id is None
    module.adapter.set_estop.assert_called_with(True)


def test_stale_feedback_aborts_tail(tail_runtime):
    module, now, _observation, _request = tail_runtime
    now[0] += 0.501
    module.heartbeat("robot", 6, time.monotonic() + 0.5)
    module.advance()
    assert module.following_tail is None


def test_old_server_epoch_cannot_reconnect_and_refresh_replacement(tail_runtime):
    module, _now, _observation, request = tail_runtime
    module.heartbeat("replacement", 0, time.monotonic() + 0.5)
    assert module.session.stopped
    module.heartbeat("robot", 100, time.monotonic() + 0.5)
    assert module._control_epoch == "replacement"
    result = module.dispatch("owner", request("acquire", revision=200))
    assert result["status"] == "rejected"


def test_real_runtime_requires_control_heartbeat_before_trusted_admission():
    from dimos.ar.manipulation.runtime import ManipulationRuntime

    fake = runtime()
    fake.adapter.config = fake.config
    module = ManipulationRuntime(fake.adapter)
    result = module.dispatch(
        "owner",
        {
            "action": "acquire",
            "group_id": "arm",
            "authority_epoch": "new",
            "authority_revision": 1,
            "authority_lease": "lease",
            "target_revision": 1,
            "authority_deadline": time.monotonic() + 0.5,
        },
    )
    assert result["status"] == "rejected" and result["code"] == "retired"
