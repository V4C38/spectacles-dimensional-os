"""A marker takeover fences native agent work before granting human authority."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.replication.interaction import InteractionRequest
from dimos.ar.websocket.protocol import decode_inbound
from test_support.module import _module_with_policy


def fixture():
    module = _module_with_policy([], agent_available=True)
    owner = module._interaction_controller.state
    owner.connect("human")
    owner.connect("other")
    owner.confirm_native_mode("agent")
    owner.set_agent_busy(True)
    module._agent_control = SimpleNamespace()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def call(method, *args, **kwargs):
        calls.append(method)
        entered.set()
        await release.wait()
        return True

    async def wait_idle(_method):
        return None

    module._interaction_controller._native_mode_rpc = SimpleNamespace(
        call=call, wait_idle=wait_idle, close=Mock()
    )
    request = InteractionRequest(
        "grab", "takeover", owner.epoch, acquisition_id="gesture", kind="live",
        source_id="hand", position=(1, 0, 0), orientation=(0, 0, 0, 1),
    )
    return module, owner, request, entered, release, calls


@pytest.mark.asyncio
async def test_takeover_reserves_agent_preemption_then_atomically_grants_manual_lease():
    module, owner, request, entered, release, calls = fixture()
    controller = module._interaction_controller
    try:
        controller.handle_request(request, "human")
        task = controller.mode_task
        await asyncio.wait_for(entered.wait(), 1)
        assert owner.mode == "agent" and owner.authority is None
        assert not controller.agent_input_available
        sent = len(module._ws_server.interaction_sent)
        controller.handle_request(request, "human")
        assert len(module._ws_server.interaction_sent) == sent
        controller.handle_request(InteractionRequest(
            "competing", "takeover", owner.epoch, kind="live", acquisition_id="other-gesture"
        ), "other")
        assert json.loads(module._ws_server.interaction_sent[-1][1])["status"] == "busy"
        release.set()
        await asyncio.wait_for(task, 1)
        assert calls == ["ar_agent_takeover"]
        assert owner.mode == "manual"
        assert owner.authority.client_id == "human"
        assert owner.authority.acquisition_id == "gesture"
        reply = json.loads(module._ws_server.interaction_sent[-1][1])
        assert reply["status"] == "accepted"
        assert reply["lease_id"] == owner.authority.lease_id
    finally:
        release.set()
        await controller.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("retirement", ["cancel", "disconnect", "epoch", "stop"])
async def test_late_takeover_ack_never_restores_retired_gesture(retirement):
    module, owner, request, entered, release, _calls = fixture()
    controller = module._interaction_controller
    try:
        controller.handle_request(request, "human")
        task = controller.mode_task
        await asyncio.wait_for(entered.wait(), 1)
        if retirement == "cancel":
            controller.handle_request(InteractionRequest(
                "cancel", "cancel_acquire", owner.epoch, acquisition_id="gesture"
            ), "human")
        elif retirement == "disconnect":
            owner.disconnect("human")
        elif retirement == "epoch":
            owner.reset()
        else:
            owner.stop()
        release.set()
        await asyncio.wait_for(task, 1)
        assert owner.authority is None
        assert owner.mode == "manual"
        assert not controller.agent_input_available
        assert json.loads(module._ws_server.interaction_sent[-1][1])["status"] != "accepted"
    finally:
        release.set()
        await controller.close()


@pytest.mark.asyncio
async def test_takeover_rejects_other_human_ownership_and_true_operation_stop():
    module, owner, request, _entered, release, calls = fixture()
    controller = module._interaction_controller
    try:
        owner.confirm_native_manual()
        owner.set_agent_busy(False)
        grant = owner.handle("other", InteractionRequest("other-grab", "acquire", owner.epoch, kind="live"))
        owner.confirm_native_mode("agent")
        controller.handle_request(request, "human")
        assert owner.authority.lease_id == grant.lease_id
        assert not calls
        owner.stop()
        module._safety.on_estop_request()
        controller.handle_request(request, "human")
        assert not calls and owner.authority is None
        assert json.loads(module._ws_server.interaction_sent[-1][1])["code"] == "operation_stopped"
    finally:
        release.set()
        await controller.close()


def test_agent_capability_unavailable_rejects_selection_and_takeover():
    module = _module_with_policy([], agent_available=False)
    owner = module._interaction_controller.state
    owner.connect("human")
    module._agent_control = Mock()
    for action in ("mode", "takeover"):
        module._on_interaction_request(InteractionRequest(
            action, action, owner.epoch, mode="agent", kind="live"
        ), "human")
        assert json.loads(module._ws_server.interaction_sent[-1][1])["status"] == "rejected"
    assert owner.mode == "manual" and owner.authority is None
    module._agent_control.assert_not_called()


def test_takeover_protocol_reuses_the_acquire_identity_fields():
    request = decode_inbound(json.dumps({
        "type": "interaction_request", "request_id": "take", "action": "takeover", "epoch": "e",
        "kind": "live", "source_id": "right", "acquisition_id": "gesture",
        "position": [1, 0, 0], "orientation": [0, 0, 0, 1],
    }))
    assert isinstance(request, InteractionRequest)
    assert request.action == "takeover" and request.acquisition_id == "gesture"


@pytest.mark.asyncio
async def test_stop_racing_agent_resume_retires_it_instead_of_reenabling_old_work():
    module, owner, _request, entered, release, calls = fixture()
    controller = module._interaction_controller
    owner.confirm_native_manual()
    owner.set_agent_busy(False)
    try:
        controller.handle_request(InteractionRequest(
            "resume-agent", "mode", owner.epoch, mode="agent"
        ), "human")
        task = controller.mode_task
        await asyncio.wait_for(entered.wait(), 1)
        module._on_estop_request(None, None)
        assert not controller.agent_input_available
        await asyncio.sleep(0)
        assert calls == ["ar_agent_set_manual", "ar_agent_takeover"]
        release.set()
        await asyncio.wait_for(task, 1)
        if controller.mode_task is not None:
            await asyncio.wait_for(controller.mode_task, 1)
        assert len(calls) >= 3
        assert all(method == "ar_agent_takeover" for method in calls[1:])
        assert owner.mode == "manual" and owner.authority is None
        assert not controller.native_mode_uncertain
        assert controller.mode_task is None
    finally:
        release.set()
        await controller.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", [False, TimeoutError("uncertain")])
async def test_unconfirmed_native_takeover_never_grants_or_reopens_agent_admission(outcome):
    module, owner, request, _entered, release, _calls = fixture()
    controller = module._interaction_controller

    async def call(*args, **kwargs):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    controller._native_mode_rpc.call = call
    try:
        controller.handle_request(request, "human")
        await asyncio.wait_for(controller.mode_task, 1)
        assert owner.mode == "agent" and owner.authority is None
        assert controller.native_mode_uncertain
        assert not controller.agent_input_available
        controller.handle_request(InteractionRequest(
            "try-manual", "acquire", owner.epoch, kind="live"
        ), "human")
        assert json.loads(module._ws_server.interaction_sent[-1][1])["code"] == "robot_busy"
    finally:
        release.set()
        await controller.close()


@pytest.mark.asyncio
async def test_stop_dispatches_before_a_hung_resume_and_waits_for_its_actual_late_effect():
    import threading

    from dimos.ar.async_execution import NativeRPC

    module = _module_with_policy([], agent_available=True)
    controller = module._interaction_controller
    controller.state.connect("human")
    entered, release, stopped = threading.Event(), threading.Event(), threading.Event()

    class Runtime:
        enabled = False

        def ar_agent_set_manual(self, manual):
            entered.set()
            assert release.wait(2)
            self.enabled = not manual
            return True

        def ar_agent_takeover(self):
            self.enabled = False
            stopped.set()
            return True

    runtime = Runtime()
    module._agent_control = runtime
    controller._native_mode_rpc = NativeRPC(runtime)
    native_call = controller._native_mode_rpc.call

    async def short_resume(method, *args, **kwargs):
        if method == "ar_agent_set_manual":
            kwargs["timeout"] = 0.02
        return await native_call(method, *args, **kwargs)

    controller._native_mode_rpc.call = short_resume
    try:
        controller.handle_request(InteractionRequest(
            "resume", "mode", controller.state.epoch, mode="agent"
        ), "human")
        resume = controller.mode_task
        assert await asyncio.to_thread(entered.wait, 1)
        module._on_estop_request(None, None)
        assert await asyncio.to_thread(stopped.wait, 1)
        await asyncio.wait_for(resume, 1)
        assert controller.mode_task is not None
        assert controller.native_mode_uncertain
        assert not controller.agent_input_available
        release.set()
        await asyncio.wait_for(controller.mode_task, 1)
        assert not runtime.enabled
        assert not controller.native_mode_uncertain
        assert controller.state.mode == "manual"
        assert controller.state.authority is None
    finally:
        release.set()
        await controller.close()
