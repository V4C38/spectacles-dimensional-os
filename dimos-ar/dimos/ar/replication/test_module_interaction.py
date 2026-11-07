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


@pytest.mark.parametrize("action", ["plan", "evaluate"])
def test_native_plan_uses_exact_canonical_shared_target(action):
    module = arm_module()
    target = module._interaction.target
    authority = module._interaction.authority
    assert target is not None and authority is not None
    request = ManipulationRequest(
        "native",
        action,
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
    if action == "plan":
        assert actual["final_gripper"] == 0.7
    else:
        assert "final_gripper" not in actual


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
