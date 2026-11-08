"""Production gateway regression tests for canonical native command admission."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.replication.interaction import InteractionRequest
from dimos.ar.test_module import _module_with_policy


def arm_module():
    module = _module_with_policy([])
    module._manipulation_service = Mock()
    module._interaction.connect("owner")
    result = module._interaction.handle(
        "owner",
        InteractionRequest(
            "grab",
            "acquire",
            module._interaction.epoch,
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
    target = module._interaction.target
    authority = module._interaction.authority
    assert target is not None and authority is not None
    request = ManipulationRequest(
        "native",
        "plan",
        "arm",
        {
            "epoch": module._interaction.epoch,
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
    authority = module._interaction.authority
    assert authority is not None
    for sequence in range(1, 61):
        previous = module._interaction.target
        assert previous is not None
        module._on_interaction_request(
            InteractionRequest(
                f"sample-{sequence}", "update", module._interaction.epoch,
                lease_id=authority.lease_id, sequence=sequence,
                position=(1 + sequence / 100, 2, 3), orientation=(0, 0, 0, 1),
            ), "owner",
        )
        latest_local = [1 + (sequence + 1) / 100, 2, 3]
        module._on_manipulation_request(ManipulationRequest(
            f"ik-{sequence}", "evaluate", "arm", {
                "epoch": module._interaction.epoch, "lease_id": authority.lease_id,
                "target_revision": previous.revision, "position": latest_local,
                "orientation": [0, 0, 0, 1],
            },
        ), "owner", 0)
        actual = module._manipulation_service.submit.call_args.args[0].payload
        assert actual["position"] == latest_local
        assert actual["advisory_target_revision"] == previous.revision
        assert actual["advisory_current"] is False
        assert actual["target_revision"] == module._interaction.target.revision
    assert module._manipulation_service.submit.call_count == 60


@pytest.mark.parametrize("action", ["plan", "execute"])
def test_motion_plan_actions_still_require_exact_canonical_revision(action):
    module = arm_module()
    authority = module._interaction.authority
    assert authority is not None
    module._on_manipulation_request(ManipulationRequest("stale", action, "arm", {
        "epoch": module._interaction.epoch, "lease_id": authority.lease_id,
        "target_revision": 0, "position": [1, 2, 3], "orientation": [0, 0, 0, 1],
        "plan_id": "old-plan",
    }), "owner", 0)
    module._manipulation_service.submit.assert_not_called()


def test_advisory_ik_requires_the_current_owner_and_accepts_antipodal_pose():
    module = arm_module()
    authority = module._interaction.authority
    assert authority is not None
    request = ManipulationRequest("ik", "evaluate", "arm", {
        "epoch": module._interaction.epoch, "lease_id": authority.lease_id,
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
    authority = module._interaction.authority
    assert authority is not None
    module._on_interaction_request(
        InteractionRequest(
            "sample",
            "update",
            module._interaction.epoch,
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
            module._interaction.epoch,
            lease_id=authority.lease_id,
            sequence=2,
            position=(4, 2, 3),
            orientation=(0, 0, 0, 1),
        ),
        "owner",
    )
    module._manipulation_service.revoke.assert_called_once()
    assert module._manipulation_service.revoke.call_args.args[-1] == "target_changed"
    assert module._manipulation_service.revoke.call_args.args[2] == module._interaction.revision - 1


def test_uncertain_execution_keeps_robot_busy_until_explicit_confirmed_stop():
    module = arm_module()
    module._pending_arm_motion.add("execute")
    module._on_manipulation_result(
        ManipulationRequest("execute", "execute", "arm", {}),
        {"status": "uncertain", "code": "rpc_uncertain"},
    )
    assert module._interaction.motion_busy
    module._on_manipulation_snapshot({"available": False})
    assert module._interaction.motion_busy
    module._on_manipulation_snapshot({"available": True, "execution": "idle"})
    assert module._interaction.motion_busy
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
    assert not module._interaction.motion_busy


def test_source_reset_stops_old_epoch_even_without_editing_owner():
    module = arm_module()
    old_epoch = module._interaction.epoch
    module._interaction.stop("released")
    module._drain_interaction_retirements()
    module._manipulation_service.reset_mock()
    module._coordinator = SimpleNamespace(invalidate_source=Mock())
    module._localization_runner = SimpleNamespace(cancel_all=Mock())
    module._ws_server.schedule_disconnect_all = Mock()
    module._retire_robot_source()
    assert module._interaction.epoch != old_epoch
    assert module._manipulation_service.emergency_stop.call_args.args[0] == old_epoch
    assert module._interaction.motion_busy


@pytest.mark.asyncio
async def test_manual_mode_requires_positive_native_quiescence():
    module = _module_with_policy([], agent_available=True)
    module._interaction.connect("owner")
    module._interaction.handle(
        "owner", InteractionRequest("agent", "mode", module._interaction.epoch, mode="agent")
    )
    module._agent_control = SimpleNamespace(ar_agent_set_manual=lambda _manual: False)
    module._on_interaction_request(
        InteractionRequest("manual", "mode", module._interaction.epoch, mode="manual"), "owner"
    )
    assert module._mode_task is not None
    await module._mode_task
    assert module._interaction.mode == "agent"
    assert not module._interaction.agent_busy


@pytest.mark.asyncio
async def test_native_agent_resume_refusal_restores_manual_mode():
    module = _module_with_policy([], agent_available=True)
    module._interaction.connect("owner")
    module._agent_control = SimpleNamespace(ar_agent_set_manual=lambda _manual: False)
    module._on_interaction_request(
        InteractionRequest("agent", "mode", module._interaction.epoch, mode="agent"), "owner"
    )
    assert module._mode_task is not None
    await module._mode_task
    assert module._interaction.mode == "manual"
    assert not module._native_mode_uncertain


def test_terminal_operation_identity_does_not_keep_the_robot_locked():
    module = arm_module()
    module._pending_arm_motion.clear()
    module._arm_uncertain = module._arm_stop_pending = False
    for execution in ("completed", "aborted", "idle"):
        module._on_manipulation_snapshot({
            "available": True, "execution": execution,
            "operation_id": "retained-outcome", "operation": None,
        })
        assert not module._interaction.motion_busy


@pytest.mark.parametrize("current_lease", [True, False])
def test_confirmed_cancel_clears_its_draft_but_never_a_successor(current_lease):
    module = arm_module()
    authority = module._interaction.authority
    module._on_manipulation_request(ManipulationRequest("cancel", "cancel", "arm", {
        "epoch": module._interaction.epoch, "sequence": 1,
        "lease_id": authority.lease_id if current_lease else "retired-lease",
    }), "owner", 0)
    assert (module._interaction.target is None) is current_lease


def test_cancel_bypasses_motion_busy_and_confirmed_stop_fences_late_acceptance():
    module = arm_module()
    authority = module._interaction.authority
    module._arm_uncertain = module._arm_native_busy = True
    module._interaction.set_motion_busy(True)
    prior_revision = module._interaction.revision
    module._on_manipulation_request(ManipulationRequest("stop", "cancel", "arm", {
        "epoch": module._interaction.epoch, "lease_id": authority.lease_id, "sequence": 1,
    }), "owner", 0)
    admitted = module._manipulation_service.submit.call_args.args[0]
    assert admitted.action == "cancel"
    assert admitted.payload["authority_revision"] > prior_revision
    module._on_manipulation_result(admitted, {"status": "aborted"})
    assert not module._interaction.motion_busy
    old = ManipulationRequest("old-execute", "execute", "arm", {
        "authority_epoch": module._interaction.epoch,
        "authority_revision": admitted.payload["authority_revision"] - 1,
    })
    module._on_manipulation_result(old, {"status": "accepted"})
    assert not module._interaction.motion_busy
