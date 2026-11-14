"""Production gateway regression tests for canonical native command admission."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.replication.interaction import InteractionRequest
from test_support.module import _module_with_policy


def arm_module():
    module = _module_with_policy([])
    module._manipulation_service = Mock()
    module._interaction_controller.state.connect("owner")
    result = module._interaction_controller.state.handle(
        "owner",
        InteractionRequest(
            "grab",
            "acquire",
            module._interaction_controller.state.epoch,
            kind="manipulation_planning",
            group_id="arm",
            position=(1, 2, 3),
            orientation=(0, 0, 0, 1),
            speed_scale=0.3,
            gripper=0.7,
        ),
    )
    assert result.status == "accepted"
    return module


def test_native_plan_uses_exact_canonical_shared_target():
    module = arm_module()
    target = module._interaction_controller.state.target
    authority = module._interaction_controller.state.authority
    assert target is not None and authority is not None
    request = ManipulationRequest(
        "native",
        "plan",
        "arm",
        {
            "epoch": module._interaction_controller.state.epoch,
            "lease_id": authority.lease_id,
            "target_revision": target.revision,
            "position": [99, 99, 99],
            "orientation": [1, 0, 0, 0],
            "speed_scale": 1,
            "final_gripper": 0,
        },
    )
    module._on_manipulation_request(request, "owner", 0)
    actual = module._manipulation_service.submit.call_args.args[0].payload
    assert actual["position"] == [1, 2, 3]
    assert actual["orientation"] == [0, 0, 0, 1]
    assert actual["speed_scale"] == 0.3
    assert actual["final_gripper"] == 0.7


def test_continuous_advisory_ik_does_not_wait_for_shared_target_acknowledgements():
    module = arm_module()
    authority = module._interaction_controller.state.authority
    assert authority is not None
    for sequence in range(1, 61):
        previous = module._interaction_controller.state.target
        assert previous is not None
        module._on_interaction_request(
            InteractionRequest(
                f"sample-{sequence}", "update", module._interaction_controller.state.epoch,
                lease_id=authority.lease_id, sequence=sequence,
                position=(1 + sequence / 100, 2, 3), orientation=(0, 0, 0, 1),
            ), "owner",
        )
        latest_local = [1 + (sequence + 1) / 100, 2, 3]
        module._on_manipulation_request(ManipulationRequest(
            f"ik-{sequence}", "evaluate", "arm", {
                "epoch": module._interaction_controller.state.epoch, "lease_id": authority.lease_id,
                "target_revision": previous.revision, "position": latest_local,
                "orientation": [0, 0, 0, 1],
            },
        ), "owner", 0)
        actual = module._manipulation_service.submit.call_args.args[0].payload
        assert actual["position"] == latest_local
        assert actual["advisory_target_revision"] == previous.revision
        assert actual["advisory_current"] is False
        assert actual["target_revision"] == module._interaction_controller.state.target.revision
    assert module._manipulation_service.submit.call_count == 60


@pytest.mark.parametrize("action", ["plan", "execute"])
def test_motion_plan_actions_still_require_exact_canonical_revision(action):
    module = arm_module()
    authority = module._interaction_controller.state.authority
    assert authority is not None
    module._on_manipulation_request(ManipulationRequest("stale", action, "arm", {
        "epoch": module._interaction_controller.state.epoch, "lease_id": authority.lease_id,
        "target_revision": 0, "position": [1, 2, 3], "orientation": [0, 0, 0, 1],
        "plan_id": "old-plan",
    }), "owner", 0)
    module._manipulation_service.submit.assert_not_called()


def test_advisory_ik_requires_the_current_owner_and_accepts_antipodal_pose():
    module = arm_module()
    authority = module._interaction_controller.state.authority
    assert authority is not None
    request = ManipulationRequest("ik", "evaluate", "arm", {
        "epoch": module._interaction_controller.state.epoch, "lease_id": authority.lease_id,
        "target_revision": 0, "position": [1, 2, 3], "orientation": [0, 0, 0, -1],
    })
    module._on_manipulation_request(request, "other", 0)
    module._manipulation_service.submit.assert_not_called()
    module._on_manipulation_request(request, "owner", 0)
    admitted = module._manipulation_service.submit.call_args.args[0].payload
    assert admitted["advisory_current"] is True
    assert admitted["advisory_target_revision"] == 1


def test_repeated_equal_target_does_not_revoke_selected_plan():
    module = arm_module()
    authority = module._interaction_controller.state.authority
    assert authority is not None
    module._on_interaction_request(
        InteractionRequest(
            "sample",
            "update",
            module._interaction_controller.state.epoch,
            lease_id=authority.lease_id,
            sequence=1,
            position=(1, 2, 3),
            orientation=(0, 0, 0, 1),
        ),
        "owner",
    )
    module._manipulation_service.revoke.assert_not_called()
    module._on_interaction_request(
        InteractionRequest(
            "changed",
            "update",
            module._interaction_controller.state.epoch,
            lease_id=authority.lease_id,
            sequence=2,
            position=(4, 2, 3),
            orientation=(0, 0, 0, 1),
        ),
        "owner",
    )
    module._manipulation_service.revoke.assert_called_once()
    assert module._manipulation_service.revoke.call_args.args[-1] == "target_changed"
    assert module._manipulation_service.revoke.call_args.args[2] == module._interaction_controller.state.revision - 1


def test_uncertain_execution_keeps_robot_busy_until_explicit_confirmed_stop():
    module = arm_module()
    module._interaction_controller.state.begin_manipulation_motion("execute")
    module._on_manipulation_result(
        ManipulationRequest("execute", "execute", "arm", {}),
        {"status": "uncertain", "code": "rpc_uncertain"},
    )
    assert module._interaction_controller.state.motion_busy
    module._on_manipulation_snapshot({"available": False})
    assert module._interaction_controller.state.motion_busy
    module._on_manipulation_snapshot({"available": True, "execution": "idle"})
    assert module._interaction_controller.state.motion_busy
    module._on_manipulation_snapshot(
        {
            "available": True,
            "execution": "aborted",
            "following": False,
            "stopped": True,
            "stop_confirmed": True,
            "operation_id": None,
        }
    )
    assert not module._interaction_controller.state.motion_busy


def test_source_reset_stops_old_epoch_even_without_editing_owner():
    module = arm_module()
    old_epoch = module._interaction_controller.state.epoch
    module._interaction_controller.state.stop("released")
    module._drain_interaction_retirements()
    module._manipulation_service.reset_mock()
    module._odom_map_transform = SimpleNamespace(clear=Mock())
    module._robot_observations = SimpleNamespace(clear=Mock())
    module._localization_runner = SimpleNamespace(cancel_all=Mock())
    module._ws_server.schedule_disconnect_all = Mock()
    module._retire_robot_source()
    assert module._interaction_controller.state.epoch != old_epoch
    assert module._manipulation_service.emergency_stop.call_args.args[0] == old_epoch
    assert module._interaction_controller.state.motion_busy


@pytest.mark.asyncio
async def test_manual_mode_requires_positive_native_quiescence():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._interaction_controller.state.handle(
        "owner", InteractionRequest("agent", "mode", module._interaction_controller.state.epoch, mode="agent")
    )
    module._agent_control = SimpleNamespace(ar_agent_set_manual=lambda _manual: False)
    module._on_interaction_request(
        InteractionRequest("manual", "mode", module._interaction_controller.state.epoch, mode="manual"), "owner"
    )
    assert module._interaction_controller.mode_task is not None
    await module._interaction_controller.mode_task
    assert module._interaction_controller.state.mode == "agent"
    assert not module._interaction_controller.state.agent_busy


@pytest.mark.asyncio
async def test_native_agent_resume_refusal_restores_manual_mode():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._agent_control = SimpleNamespace(ar_agent_set_manual=lambda _manual: False)
    module._on_interaction_request(
        InteractionRequest("agent", "mode", module._interaction_controller.state.epoch, mode="agent"), "owner"
    )
    assert module._interaction_controller.mode_task is not None
    await module._interaction_controller.mode_task
    assert module._interaction_controller.state.mode == "manual"
    assert not module._interaction_controller.native_mode_uncertain


def test_terminal_operation_identity_does_not_keep_the_robot_locked():
    module = arm_module()
    for execution in ("completed", "aborted", "idle"):
        module._on_manipulation_snapshot({
            "available": True, "execution": execution,
            "operation_id": "retained-outcome", "operation": None,
        })
        assert not module._interaction_controller.state.motion_busy


@pytest.mark.parametrize("current_lease", [True, False])
def test_confirmed_cancel_clears_its_draft_but_never_a_successor(current_lease):
    module = arm_module()
    authority = module._interaction_controller.state.authority
    module._on_manipulation_request(ManipulationRequest("cancel", "cancel", "arm", {
        "epoch": module._interaction_controller.state.epoch, "sequence": 1,
        "lease_id": authority.lease_id if current_lease else "retired-lease",
    }), "owner", 0)
    assert (module._interaction_controller.state.target is None) is current_lease


def test_cancel_bypasses_motion_busy_and_confirmed_stop_fences_late_acceptance():
    module = arm_module()
    authority = module._interaction_controller.state.authority
    module._interaction_controller.state.observe_manipulation_result(
        ManipulationRequest("uncertain", "execute", "arm", {}), {"status": "uncertain"}
    )
    module._interaction_controller.state.observe_manipulation_snapshot({"available": True, "execution": "uncertain"})
    prior_revision = module._interaction_controller.state.revision
    module._on_manipulation_request(ManipulationRequest("stop", "cancel", "arm", {
        "epoch": module._interaction_controller.state.epoch, "lease_id": authority.lease_id, "sequence": 1,
    }), "owner", 0)
    admitted = module._manipulation_service.submit.call_args.args[0]
    assert admitted.action == "cancel"
    assert admitted.payload["authority_revision"] > prior_revision
    module._on_manipulation_result(admitted, {"status": "aborted"})
    assert not module._interaction_controller.state.motion_busy
    old = ManipulationRequest("old-execute", "execute", "arm", {
        "authority_epoch": module._interaction_controller.state.epoch,
        "authority_revision": admitted.payload["authority_revision"] - 1,
    })
    module._on_manipulation_result(old, {"status": "accepted"})
    assert not module._interaction_controller.state.motion_busy


@pytest.mark.parametrize("rejection", ["owner", "lease", "epoch", "busy"])
def test_reset_rejection_preserves_the_canonical_draft(rejection):
    module = arm_module()
    target = module._interaction_controller.state.target
    authority = module._interaction_controller.state.authority
    assert target is not None and authority is not None
    payload = {
        "epoch": module._interaction_controller.state.epoch,
        "lease_id": authority.lease_id,
        "sequence": 1,
        "speed_scale": 0.5,
    }
    client = "owner"
    if rejection == "owner":
        client = "other"
    elif rejection == "lease":
        payload["lease_id"] = "old-lease"
    elif rejection == "epoch":
        payload["epoch"] = "old-epoch"
    else:
        module._interaction_controller.state.observe_manipulation_snapshot({"available": True, "execution": "executing"})
    module._on_manipulation_request(
        ManipulationRequest("reset", "reset_joints", "arm", payload), client, 0
    )
    module._manipulation_service.submit.assert_not_called()
    assert module._interaction_controller.state.target is target
    assert module._interaction_controller.state.snapshot()["targets"][0]["gripper"] == 0.7


def test_reset_admission_clears_only_its_group_draft_and_fences_native_work():
    from dataclasses import replace

    module = arm_module()
    target = module._interaction_controller.state.target
    authority = module._interaction_controller.state.authority
    assert target is not None and authority is not None
    other = replace(target, group_id="other-arm")
    module._interaction_controller.state._targets[("manipulation", "other-arm")] = other
    prior_revision = module._interaction_controller.state.revision
    module._on_manipulation_request(
        ManipulationRequest("reset", "reset_joints", "arm", {
            "epoch": module._interaction_controller.state.epoch,
            "lease_id": authority.lease_id,
            "sequence": 1,
            "speed_scale": 0.5,
        }), "owner", 0,
    )
    admitted = module._manipulation_service.submit.call_args.args[0]
    assert admitted.action == "reset_joints"
    assert admitted.payload["authority_revision"] > prior_revision
    assert module._interaction_controller.state.target is None
    assert module._interaction_controller.state.snapshot()["targets"] == [other.wire()]
    assert module._interaction_controller.state.motion_busy
    assert module._interaction_controller.state.manipulation_motion_pending("reset")


@pytest.mark.parametrize("action", ["execute", "reset_joints", "prepare_shutdown"])
def test_released_target_motion_reserves_revision_after_revoke(action):
    import time

    from dimos.ar.replication.manipulation_authority import ManipulationAuthorityFence

    module = arm_module()
    owner = module._interaction_controller.state
    authority, target = owner.authority, owner.target
    assert authority is not None and target is not None
    module._on_interaction_request(InteractionRequest(
        "release", "release", owner.epoch, lease_id=authority.lease_id, sequence=1,
        position=target.position, orientation=target.orientation,
    ), "owner")
    assert owner.authority is None
    epoch, lease, retired_revision, _reason = module._manipulation_service.revoke.call_args.args
    fence = ManipulationAuthorityFence()
    assert fence.revoke(epoch, lease, retired_revision)
    module._on_manipulation_request(ManipulationRequest(
        "successor", action, "arm", {"epoch": epoch, "target_revision": target.revision,
                                    "plan_id": "reviewed-plan", "speed_scale": 0.2},
    ), "owner", 0)
    request = module._manipulation_service.submit.call_args.args[0]
    assert request.payload["authority_revision"] > retired_revision
    assert request.payload["authority_revision"] == owner.revision
    if action != "reset_joints":
        assert request.payload["target_revision"] == target.revision
    admission = fence.admit(request.payload)
    assert admission is not None
    assert admission.deadline > time.monotonic()
    assert not fence.revoke(epoch, lease, retired_revision)
    assert fence.current(admission)


@pytest.mark.asyncio
@pytest.mark.parametrize("epoch", [None, "retired-source"])
async def test_stale_manual_mode_never_reaches_native(epoch):
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._interaction_controller.state.confirm_native_mode("agent")
    native = Mock(return_value=True)
    module._agent_control = SimpleNamespace(ar_agent_set_manual=native)
    module._on_interaction_request(
        InteractionRequest("manual", "mode", epoch, mode="manual"), "owner"
    )
    assert module._interaction_controller.mode_task is None
    native.assert_not_called()
    assert module._interaction_controller.state.mode == "agent"
    assert not module._interaction_controller.state.agent_busy
    reply = json.loads(module._ws_server.interaction_sent[-1][1])
    assert (reply["status"], reply["code"]) == ("stale", "epoch_changed")


@pytest.mark.asyncio
@pytest.mark.parametrize("retirement", ["disconnect", "source"])
@pytest.mark.parametrize("mode", ["manual", "agent"])
async def test_native_mode_acknowledgement_survives_requester_retirement(retirement, mode):
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._interaction_controller.state.confirm_native_mode("agent" if mode == "manual" else "manual")
    module._agent_control = SimpleNamespace()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def call(method, manual=None, **kwargs):
        calls.append((method, manual))
        entered.set()
        await release.wait()
        return True

    module._interaction_controller._native_mode_rpc = SimpleNamespace(call=call)
    request = InteractionRequest("change", "mode", module._interaction_controller.state.epoch, mode=mode)
    module._on_interaction_request(request, "owner")
    task = module._interaction_controller.mode_task
    assert task is not None
    await asyncio.wait_for(entered.wait(), 1)
    assert module._interaction_controller.state.mode != mode  # No optimistic native acknowledgement.
    module._on_interaction_request(request, "owner")
    assert len(calls) == 1
    if retirement == "disconnect":
        module._on_client_disconnect(None, "owner")
    else:
        module._localization_runner = SimpleNamespace(cancel_all=Mock())
        module._odom_map_transform = SimpleNamespace(clear=Mock())
        module._robot_observations = SimpleNamespace(clear=Mock())
        module._ws_server.schedule_disconnect_all = Mock()
        module._retire_robot_source()
    release.set()
    await task
    assert len(calls) == (2 if retirement == "source" and mode == "agent" else 1)
    if retirement == "source" and mode == "agent":
        assert calls[-1] == ("ar_agent_takeover", None)
    expected_mode = "manual" if retirement == "source" else mode
    assert module._interaction_controller.state.mode == expected_mode
    assert not module._interaction_controller.native_mode_uncertain
    assert not module._interaction_controller.state.agent_busy
    reply = json.loads(module._ws_server.interaction_sent[-1][1])
    assert reply["code"] == ("connection_retired" if retirement == "disconnect" else "epoch_changed")


@pytest.mark.asyncio
async def test_completed_mode_request_replays_without_native_side_effect():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._agent_control = SimpleNamespace()
    calls = []

    async def call(*args, **kwargs):
        calls.append(args)
        return True

    module._interaction_controller._native_mode_rpc = SimpleNamespace(call=call)
    request = InteractionRequest("change", "mode", module._interaction_controller.state.epoch, mode="agent")
    module._on_interaction_request(request, "owner")
    await module._interaction_controller.mode_task
    module._interaction_controller.state.confirm_native_manual()
    module._on_interaction_request(request, "owner")
    assert len(calls) == 1
    assert module._interaction_controller.state.mode == "manual"
    assert module._interaction_controller.mode_task is None
    reply = json.loads(module._ws_server.interaction_sent[-1][1])
    assert reply["status"] == "accepted"


@pytest.mark.asyncio
async def test_refused_agent_resume_does_not_cache_optimistic_success():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._agent_control = SimpleNamespace()
    outcomes = iter([False, True])
    calls = []

    async def call(*args, **kwargs):
        calls.append(args)
        return next(outcomes)

    module._interaction_controller._native_mode_rpc = SimpleNamespace(call=call)
    request = InteractionRequest("change", "mode", module._interaction_controller.state.epoch, mode="agent")
    module._on_interaction_request(request, "owner")
    await module._interaction_controller.mode_task
    assert module._interaction_controller.state.mode == "manual"
    assert json.loads(module._ws_server.interaction_sent[-1][1])["status"] == "busy"
    module._on_interaction_request(request, "owner")
    await module._interaction_controller.mode_task
    assert len(calls) == 2
    assert module._interaction_controller.state.mode == "agent"


@pytest.mark.asyncio
@pytest.mark.parametrize("pause_outcome", [False, TimeoutError()])
async def test_retired_source_resume_stays_fenced_until_pause_is_confirmed(pause_outcome):
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._agent_control = SimpleNamespace()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def call(method, manual=None, **kwargs):
        calls.append(method)
        if method == "ar_agent_set_manual" and manual is False:
            entered.set()
            await release.wait()
            return True
        if isinstance(pause_outcome, Exception):
            raise pause_outcome
        return pause_outcome

    module._interaction_controller._native_mode_rpc = SimpleNamespace(call=call)
    request = InteractionRequest("change", "mode", module._interaction_controller.state.epoch, mode="agent")
    module._on_interaction_request(request, "owner")
    task = module._interaction_controller.mode_task
    await asyncio.wait_for(entered.wait(), 1)
    module._interaction_controller.state.reset()
    release.set()
    await task
    assert calls == ["ar_agent_set_manual", "ar_agent_takeover"]
    assert module._interaction_controller.state.mode == "manual"
    assert module._interaction_controller.native_mode_uncertain
    assert module._interaction_controller.mode_task is None


@pytest.mark.asyncio
async def test_retired_manual_requester_never_reaches_native():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.confirm_native_mode("agent")
    module._agent_control = SimpleNamespace(ar_agent_set_manual=Mock(return_value=True))
    module._on_interaction_request(
        InteractionRequest("manual", "mode", module._interaction_controller.state.epoch, mode="manual"), "retired"
    )
    assert module._interaction_controller.mode_task is None
    module._agent_control.ar_agent_set_manual.assert_not_called()
    assert module._interaction_controller.state.mode == "agent"
    assert json.loads(module._ws_server.interaction_sent[-1][1])["code"] == "connection_retired"


@pytest.mark.asyncio
async def test_positive_agent_acknowledgement_is_cached_even_if_a_turn_starts():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._agent_control = SimpleNamespace()
    calls = []

    async def call(*args, **kwargs):
        calls.append(args)
        module._agent_service.update_idle(False)
        return True

    module._interaction_controller._native_mode_rpc = SimpleNamespace(call=call)
    request = InteractionRequest("change", "mode", module._interaction_controller.state.epoch, mode="agent")
    module._on_interaction_request(request, "owner")
    await module._interaction_controller.mode_task
    assert module._interaction_controller.state.mode == "agent"
    assert module._interaction_controller.state.agent_busy
    assert json.loads(module._ws_server.interaction_sent[-1][1])["status"] == "accepted"
    module._on_interaction_request(request, "owner")
    assert len(calls) == 1
    assert json.loads(module._ws_server.interaction_sent[-1][1])["status"] == "accepted"


@pytest.mark.asyncio
async def test_unknown_agent_resume_does_not_cache_success_or_clear_uncertainty():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._agent_control = SimpleNamespace()
    outcomes = iter([TimeoutError(), False, True])

    async def call(*args, **kwargs):
        outcome = next(outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    module._interaction_controller._native_mode_rpc = SimpleNamespace(call=call)
    request = InteractionRequest("change", "mode", module._interaction_controller.state.epoch, mode="agent")
    module._on_interaction_request(request, "owner")
    await module._interaction_controller.mode_task
    assert module._interaction_controller.state.mode == "manual"
    assert module._interaction_controller.native_mode_uncertain
    assert json.loads(module._ws_server.interaction_sent[-1][1])["code"] == "native_mode_timeout"
    module._on_interaction_request(
        InteractionRequest("grab", "acquire", module._interaction_controller.state.epoch, kind="live"), "owner"
    )
    assert json.loads(module._ws_server.interaction_sent[-1][1])["code"] == "robot_busy"
    module._manipulation_service = Mock()
    module._on_manipulation_request(
        ManipulationRequest("plan", "plan", "arm", {"epoch": module._interaction_controller.state.epoch}), "owner", 0
    )
    module._manipulation_service.submit.assert_not_called()
    assert json.loads(module._ws_server.sent[-1][1])["code"] == "busy"
    module._on_interaction_request(request, "owner")
    await module._interaction_controller.mode_task
    assert module._interaction_controller.state.mode == "manual"
    assert module._interaction_controller.native_mode_uncertain
    assert json.loads(module._ws_server.interaction_sent[-1][1])["code"] == "native_motion_active"
    module._on_interaction_request(request, "owner")
    await module._interaction_controller.mode_task
    assert module._interaction_controller.state.mode == "agent"
    assert not module._interaction_controller.native_mode_uncertain


@pytest.mark.asyncio
async def test_compensating_pause_keeps_motion_admission_busy_during_idle_notification():
    module = _module_with_policy([], agent_available=True)
    module._interaction_controller.state.connect("owner")
    module._agent_control = SimpleNamespace()
    resumed, release_resume = asyncio.Event(), asyncio.Event()
    pausing, release_pause = asyncio.Event(), asyncio.Event()

    async def call(method, manual=None, **kwargs):
        if method == "ar_agent_set_manual" and manual is False:
            resumed.set()
            await release_resume.wait()
        else:
            pausing.set()
            await release_pause.wait()
        return True

    module._interaction_controller._native_mode_rpc = SimpleNamespace(call=call)
    module._on_interaction_request(
        InteractionRequest("agent", "mode", module._interaction_controller.state.epoch, mode="agent"), "owner"
    )
    task = module._interaction_controller.mode_task
    await asyncio.wait_for(resumed.wait(), 1)
    module._interaction_controller.state.reset()
    release_resume.set()
    await asyncio.wait_for(pausing.wait(), 1)
    await module.handle_agent_idle(True)
    assert module._interaction_controller.state.agent_busy
    module._on_interaction_request(
        InteractionRequest("grab", "acquire", module._interaction_controller.state.epoch, kind="live"), "owner"
    )
    assert json.loads(module._ws_server.interaction_sent[-1][1])["code"] == "robot_busy"
    release_pause.set()
    await task
    assert not module._interaction_controller.state.agent_busy
    assert module._interaction_controller.state.mode == "manual"
    assert not module._interaction_controller.native_mode_uncertain


@pytest.mark.asyncio
async def test_controller_close_drains_owned_tasks_and_prevents_restart():
    module = _module_with_policy([], agent_available=True)
    controller = module._interaction_controller
    controller.state.connect("owner")
    entered = asyncio.Event()

    async def call(*_args, **_kwargs):
        entered.set()
        await asyncio.Event().wait()

    rpc = SimpleNamespace(call=call, close=Mock())
    controller._native_mode_rpc = rpc
    module._agent_control = SimpleNamespace()
    controller.start()
    controller.handle_request(
        InteractionRequest("mode", "mode", controller.state.epoch, mode="agent"), "owner"
    )
    mode = controller.mode_task
    poll = controller._poll_task
    await asyncio.wait_for(entered.wait(), 1)
    await controller.close()
    assert mode.cancelled()
    assert poll.cancelled()
    assert controller.mode_task is None
    assert controller._poll_task is None
    assert controller._native_mode_rpc is None
    rpc.close.assert_called_once()
    assert not controller.state.agent_busy
    await controller.close()
    controller.start()
    controller.handle_request(
        InteractionRequest("later", "mode", controller.state.epoch, mode="agent"), "owner"
    )
    assert controller._poll_task is None
    assert controller.mode_task is None
    rpc.close.assert_called_once()


@pytest.mark.asyncio
async def test_closed_controller_rejects_inflight_preview_and_new_agent_input():

    from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest

    module = _module_with_policy([], agent_available=True)
    controller = module._interaction_controller
    owner = controller.state
    owner.connect("owner")
    owner.handle(
        "owner",
        InteractionRequest(
            "grab", "acquire", owner.epoch, kind="navigation_planning",
            position=(1.0, 0.0, 0.0), orientation=(0.0, 0.0, 0.0, 1.0),
        ),
    )
    authority = owner.authority
    target = owner.target
    request = NavGoalRequest(
        position=target.position, orientation=target.orientation, preview=True,
        epoch=owner.epoch, lease_id=authority.lease_id, target_revision=target.revision,
    )
    entered, release = asyncio.Event(), asyncio.Event()

    async def prepare(body):
        entered.set()
        await release.wait()
        return body

    module._ws_server.prepare_outbound_async = prepare
    task = asyncio.create_task(controller.observe_preview(
        "owner", request, NavGoalFrame(pose=(1.0, 0.0, 0.0, 0.0), path_poses=(), ts=1.0)
    ))
    await asyncio.wait_for(entered.wait(), 1)
    await controller.close()
    release.set()
    await task
    assert owner.preview is None
    owner.stop()
    owner.confirm_native_mode("agent")
    assert not controller.agent_input_available
