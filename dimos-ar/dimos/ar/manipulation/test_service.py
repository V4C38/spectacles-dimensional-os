import asyncio
import json
import threading

import pytest

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.service import ManipulationService


@pytest.mark.parametrize("status", ["feasible", "infeasible"])
@pytest.mark.parametrize("action", ["evaluate", "update"])
def test_advisory_outcomes_identify_the_attempted_pose_and_source_revision(status, action):
    replies = []
    service = ManipulationService(object(), lambda _, frame: replies.append(json.loads(frame)), lambda _: None)
    service.connect("owner")
    request = ManipulationRequest("sample", action, "arm", {
        "position": [1, 2, 3], "orientation": [0, 0, 0, 1],
        "target_revision": 9, "advisory_target_revision": 7,
    })
    service._reply("owner", request, {"status": status, "pose": None})
    assert replies[0]["sample_pose"] == {"position": [1, 2, 3], "orientation": [0, 0, 0, 1]}
    assert replies[0]["pose"] is None
    assert replies[0]["target_revision"] == 7


@pytest.mark.asyncio
async def test_stop_dispatch_is_independent_of_blocking_plan():
    entered, release, cancelled = threading.Event(), threading.Event(), threading.Event()

    class Runtime:
        def ar_manipulation_command(self, client_id, request):
            if request["action"] == "plan":
                entered.set()
                assert release.wait(3)
            else:
                cancelled.set()
                release.set()
            return {"status": "cancelled"}

        def ar_manipulation_disconnect(self, client_id):
            release.set()

        def ar_manipulation_stop(self):
            release.set()

    results = []
    service = ManipulationService(Runtime(), lambda *args: results.append(args), lambda _: None)
    service.connect("owner")
    service.submit(ManipulationRequest("p", "plan", "arm", {}), "owner")
    assert await asyncio.to_thread(entered.wait, 2)
    service.submit(ManipulationRequest("c", "cancel", "arm", {}), "owner")
    assert await asyncio.to_thread(cancelled.wait, 2)
    await service.close()


@pytest.mark.asyncio
async def test_shutdown_retires_connections_before_stopping_runtime():
    events = []

    class Runtime:
        def ar_manipulation_disconnect(self, client_id):
            events.append(("disconnect", client_id))

        def ar_manipulation_stop(self):
            events.append(("stop", None))

    service = ManipulationService(Runtime(), lambda *args: None, lambda _: None)
    service.connect("owner")
    service.connect("observer")
    await service.close()
    assert events[0] == ("stop", None)
    assert set(events[1:]) == {("disconnect", "owner"), ("disconnect", "observer")}


@pytest.mark.asyncio
async def test_readiness_is_emitted_once_and_polling_retires_before_stop():
    snapshots = [{"available": False}, {"available": True}]
    ready = asyncio.Event()
    observations = []

    class Runtime:
        def ar_manipulation_snapshot(self):
            observations.append("snapshot")
            return snapshots.pop(0) if snapshots else {"available": True}

        def ar_manipulation_stop(self):
            assert service._poll is None
            observations.append("stop")

    calls = []

    def on_ready():
        calls.append("ready")
        ready.set()

    service = ManipulationService(Runtime(), lambda *args: None, lambda _: None, on_ready)
    service.start()
    await asyncio.wait_for(ready.wait(), timeout=2)
    await asyncio.sleep(0.15)
    await service.close()
    assert calls == ["ready"]
    assert observations[-1] == "stop"


@pytest.mark.asyncio
async def test_cancelled_rpc_keeps_actual_slot_until_late_reply():
    from types import SimpleNamespace
    from unittest.mock import Mock

    callbacks = []
    unsubscribe = Mock()

    def call(name, args, callback):
        callbacks.append(callback)
        return unsubscribe

    runtime = SimpleNamespace(rpc=SimpleNamespace(call=call), remote_name="ManipulationModule")
    service = ManipulationService(runtime, lambda *args: None, lambda _: None)
    task = asyncio.create_task(service._rpc.call("ar_manipulation_snapshot"))
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    unsubscribe.assert_not_called()
    with pytest.raises(TimeoutError, match="still running"):
        await service._rpc.call("ar_manipulation_snapshot")
    assert len(callbacks) == 1
    callbacks[0]({"available": True})
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    unsubscribe.assert_called_once()
    assert not service._rpc._inflight


@pytest.mark.asyncio
async def test_prepared_shutdown_retires_locally_without_late_runtime_calls():
    from unittest.mock import Mock

    runtime = Mock()
    service = ManipulationService(runtime, lambda *args: None, lambda _: None)
    service._quiescent = True
    service.connect("supervisor")
    await service.close()
    runtime.ar_manipulation_stop.assert_not_called()
    runtime.ar_manipulation_disconnect.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result,quiescent",
    [
        ({"status": "rejected"}, False),
        ({"status": "completed"}, False),
        ({"status": "skipped", "quiescent": False}, False),
        ({"status": "completed", "quiescent": True}, True),
        ({"status": "rejected", "quiescent": True}, True),
        ({"status": "completed", "quiescent": "true"}, False),
        (TimeoutError("parking deadline"), False),
    ],
)
async def test_only_explicit_quiescence_suppresses_teardown_stop(result, quiescent):
    from unittest.mock import Mock

    runtime = Mock(
        spec=["ar_manipulation_command", "ar_manipulation_stop", "ar_manipulation_disconnect"]
    )
    if isinstance(result, Exception):
        runtime.ar_manipulation_command.side_effect = result
    else:
        runtime.ar_manipulation_command.return_value = result
    service = ManipulationService(runtime, lambda *args: None, lambda _: None)
    service.connect("supervisor")
    await service._dispatch(
        ManipulationRequest("s", "prepare_shutdown", "arm", {}), "supervisor", 0
    )
    assert service._quiescent is quiescent
    await service.close()
    assert runtime.ar_manipulation_stop.call_count == (0 if quiescent else 1)


@pytest.mark.asyncio
async def test_emergency_stop_uses_the_service_task_owner():
    from unittest.mock import Mock

    runtime = Mock(spec=["ar_manipulation_stop", "ar_manipulation_disconnect"])
    service = ManipulationService(runtime, lambda *args: None, lambda _: None)
    service.emergency_stop()
    service.emergency_stop()
    await asyncio.gather(*service._tasks)
    runtime.ar_manipulation_stop.assert_called_once()
    await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["update", "evaluate", "plan"])
@pytest.mark.parametrize(
    "message,code",
    [
        ("Pink IK did not converge within the iteration budget", "ik_failed"),
        ("Pink IK candidate violates DimOS joint limits", "joint_limit"),
        (
            "Pink IK solver failed: QP solver did not find a solution to the differential IK problem",
            "ik_failed",
        ),
    ],
)
async def test_recorded_ik_rpc_exceptions_reach_wire_as_recoverable_results(action, message, code):
    import json
    from unittest.mock import Mock

    runtime = Mock(spec=["ar_manipulation_command"])
    runtime.ar_manipulation_command.side_effect = ValueError(message)
    packets = []
    service = ManipulationService(
        runtime, lambda client, packet: packets.append(json.loads(packet)), lambda _: None
    )
    service.connect("owner")
    request = ManipulationRequest("target-7", action, "arm", {"sequence": 7, "ts": 0})
    await service._dispatch(request, "owner", 0)
    assert packets == [
        {
            "type": "manipulation_result",
            "request_id": "target-7",
            "group_id": "arm",
            "action": action,
            "status": "infeasible",
            "code": code,
            "message": message,
            **({"sequence": 7} if action == "update" else {}),
        }
    ]
async def test_motion_rpc_failure_is_uncertain_and_reported_after_disconnect():
    from unittest.mock import Mock

    runtime = Mock(spec=["ar_manipulation_command", "ar_manipulation_stop"])
    runtime.ar_manipulation_command.side_effect = TimeoutError("unknown outcome")
    outcomes = []
    service = ManipulationService(
        runtime,
        lambda *args: None,
        lambda _: None,
        on_result=lambda request, result: outcomes.append(result),
    )
    await service._dispatch(ManipulationRequest("execute", "execute", "arm", {}), "gone", 0)
    assert outcomes[0]["status"] == "uncertain"
    assert outcomes[0]["code"] == "rpc_uncertain"
    await service.close()


@pytest.mark.asyncio
async def test_emergency_stop_carries_atomic_native_revision_tombstone():
    from unittest.mock import Mock

    runtime = Mock(spec=["ar_manipulation_stop"])
    service = ManipulationService(runtime, lambda *args: None, lambda _: None)
    service.emergency_stop("old-epoch", 42)
    await asyncio.gather(*service._tasks)
    runtime.ar_manipulation_stop.assert_called_once_with("old-epoch", 42)
    service._quiescent = True
    await service.close()


@pytest.mark.asyncio
async def test_close_tombstone_blocks_delayed_resume_from_before_close():
    import time

    from dimos.ar.replication.manipulation_authority import ManipulationAuthorityFence

    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    fence = ManipulationAuthorityFence()
    resumed = []
    stops = []

    class Runtime:
        def ar_manipulation_command(self, client_id, body):
            entered.set()
            assert release.wait(2)
            try:
                fence.admit(body)
                resumed.append(True)
                return {"status": "resumed"}
            except ValueError:
                return {"status": "rejected"}
            finally:
                finished.set()

        def ar_manipulation_stop(self, epoch, revision):
            fence.stop(epoch, revision)
            stops.append((epoch, revision))
            release.set()

        def ar_manipulation_disconnect(self, client_id):
            pass

    service = ManipulationService(Runtime(), lambda *args: None, lambda _: None)
    service.connect("owner")
    service.submit(
        ManipulationRequest(
            "resume",
            "resume",
            "arm",
            {
                "authority_epoch": "robot",
                "authority_revision": 41,
                "authority_lease": None,
                "target_revision": 3,
                "authority_deadline": time.monotonic() + 10,
            },
        ),
        "owner",
    )
    assert await asyncio.to_thread(entered.wait, 2)
    await service.close()
    assert await asyncio.to_thread(finished.wait, 2)
    assert stops == [("robot", 42)]
    assert not resumed


@pytest.mark.asyncio
async def test_native_bulk_assets_are_fetched_once_per_revision():
    from unittest.mock import Mock

    runtime = Mock(spec=["ar_manipulation_asset"])
    runtime.ar_manipulation_asset.side_effect = lambda kind, revision: {"revision": revision}
    service = ManipulationService(runtime, lambda *args: None, lambda _: None)
    metadata = {
        "available": True,
        "model_revision": "model1",
        "plan_revision": None,
        "plan_metadata": None,
    }
    first = await service._materialize(metadata)
    second = await service._materialize(metadata)
    assert first["model"] is second["model"]
    runtime.ar_manipulation_asset.assert_called_once_with("model", "model1")
    changed = await service._materialize({**metadata, "model_revision": "model2"})
    assert changed["model"]["revision"] == "model2"
    assert runtime.ar_manipulation_asset.call_count == 2
    service._quiescent = True
    await service.close()


@pytest.mark.asyncio
async def test_hung_snapshot_has_one_actual_call_and_stop_stays_independent():
    from types import SimpleNamespace
    from unittest.mock import Mock

    callbacks = {}
    calls = []

    def call(name, args, callback):
        calls.append(name)
        if name.endswith("ar_manipulation_stop"):
            callback(None)
        else:
            callbacks[name] = callback
        return Mock()

    rpc = ManipulationService(
        SimpleNamespace(rpc=SimpleNamespace(call=call), remote_name="Native"),
        lambda *args: None,
        lambda _: None,
    )._rpc
    with pytest.raises(TimeoutError):
        await rpc.call("ar_manipulation_snapshot", timeout=0.01)
    for _ in range(5):
        with pytest.raises(TimeoutError):
            await rpc.call("ar_manipulation_snapshot", timeout=0.01)
    await rpc.call("ar_manipulation_stop", timeout=0.1)
    assert calls == ["Native/ar_manipulation_snapshot", "Native/ar_manipulation_stop"]
    callbacks["Native/ar_manipulation_snapshot"]({"available": False})
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not rpc._inflight
    rpc.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("snapshot_during_command", [False, True])
async def test_old_idle_snapshot_cannot_retire_accepted_execution(snapshot_during_command):
    from test_support.module import (
        _arm_grab,
        _arm_module_with_two_clients,
        _release_arm_grab,
    )

    module = _arm_module_with_two_clients()
    command_entered, command_release = threading.Event(), threading.Event()
    packing_entered, packing_release = asyncio.Event(), asyncio.Event()
    accepted, moving, completed = asyncio.Event(), asyncio.Event(), asyncio.Event()
    observed, published = [], []

    class Runtime:
        state = {"available": True, "execution": "idle", "operation_id": None}

        def ar_manipulation_snapshot(self):
            return dict(self.state)

        def ar_manipulation_command(self, client_id, body):
            command_entered.set()
            assert command_release.wait(2)
            self.state = {"available": True, "execution": "accepted", "operation_id": "move"}
            return {"status": "accepted", "operation_id": "move"}

        def ar_manipulation_revoke(self, *args):
            pass

    runtime = Runtime()

    async def pack(body):
        if body.get("type") == "manipulation_state" and body.get("execution") == "idle":
            packing_entered.set()
            await packing_release.wait()
        return body

    def on_snapshot(body):
        observed.append(body)
        module._on_manipulation_snapshot(body)
        if body["execution"] == "accepted":
            moving.set()
        elif body["execution"] == "completed":
            completed.set()

    def on_result(request, body):
        module._on_manipulation_result(request, body)
        accepted.set()

    service = ManipulationService(
        runtime,
        lambda *args: None,
        lambda text: published.append(json.loads(text)),
        on_snapshot=on_snapshot,
        on_result=on_result,
        prepare_outbound=pack,
    )
    module._manipulation_service = service
    service.connect("a")
    service.connect("b")
    _arm_grab(module, "a", planning=True)
    await asyncio.gather(*service._tasks)
    request = ManipulationRequest("execute", "execute", "arm", {})
    module._interaction.begin_manipulation_motion(request.request_id)
    module._interaction.set_motion_busy(True)
    try:
        if snapshot_during_command:
            service.submit(request, "a")
            assert await asyncio.to_thread(command_entered.wait, 1)
            service.start()
        else:
            service.start()
        await asyncio.wait_for(packing_entered.wait(), 1)
        if not snapshot_during_command:
            service.submit(request, "a")
            assert await asyncio.to_thread(command_entered.wait, 1)
        command_release.set()
        await asyncio.wait_for(accepted.wait(), 1)
        packing_release.set()
        await asyncio.wait_for(moving.wait(), 1)

        assert all(body["execution"] != "idle" for body in observed)
        assert all(body.get("execution") != "idle" for body in published)
        _release_arm_grab(module)
        _arm_grab(module, "b")
        assert module._interaction.authority is None
        assert module._interaction.motion_busy

        runtime.state = {"available": True, "execution": "completed", "operation_id": None}
        await asyncio.wait_for(completed.wait(), 1)
        assert not module._interaction.motion_busy
        _arm_grab(module, "b")
        assert module._interaction.authority.client_id == "b"
    finally:
        command_release.set()
        packing_release.set()
        service._quiescent = True
        await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["update", "evaluate", "plan", "gripper"])
async def test_continuous_input_does_not_starve_snapshot_publication(action):
    packing_entered, packing_release, published = (
        asyncio.Event(), asyncio.Event(), asyncio.Event()
    )
    observed = []

    class Runtime:
        def ar_manipulation_snapshot(self):
            return {"available": True, "sample": 1}

        def ar_manipulation_command(self, client_id, body):
            return {"status": "feasible"}

    async def pack(body):
        if body.get("type") == "manipulation_state":
            packing_entered.set()
            await packing_release.wait()
        return body

    def on_snapshot(body):
        observed.append(body)
        published.set()

    service = ManipulationService(
        Runtime(), lambda *args: None, lambda _: None,
        on_snapshot=on_snapshot, prepare_outbound=pack,
    )
    service.start()
    try:
        await asyncio.wait_for(packing_entered.wait(), 1)
        for sequence in range(3):
            await service._dispatch(
                ManipulationRequest(str(sequence), action, "arm", {"ts": 1, "sequence": sequence}),
                "a", 0,
            )
        packing_release.set()
        await asyncio.wait_for(published.wait(), 1)
        assert observed[0]["sample"] == 1
    finally:
        packing_release.set()
        service._quiescent = True
        await service.close()


@pytest.mark.asyncio
async def test_retired_optional_plan_preserves_fresh_feedback_and_availability():
    published, observed = [], []
    received = asyncio.Event()
    observation = {"arm": {"joints": {"joint": 0.2}, "measured_at": 123.0}}

    class Runtime:
        plan_revision = "retired"

        def ar_manipulation_snapshot(self):
            return {
                "available": True,
                "observations": observation,
                "plan_revision": self.plan_revision,
                "plan_metadata": {"plan_id": self.plan_revision},
            }

        def ar_manipulation_asset(self, kind, revision):
            assert kind == "plan"
            if revision == "retired":
                self.plan_revision = "replacement"
                return None
            return {"plan_id": revision, "trajectory": []}

    def broadcast(text):
        published.append(json.loads(text))
        if len(published) == 2:
            received.set()

    service = ManipulationService(
        Runtime(), lambda *args: None, broadcast, on_snapshot=observed.append,
    )
    service._assets["plan"] = ("older", {"plan_id": "older"})
    service.start()
    try:
        await asyncio.wait_for(received.wait(), 1)
        assert [body["available"] for body in published] == [True, True]
        assert [body["observations"] for body in published] == [observation, observation]
        assert published[0]["plan"] is None
        assert published[1]["plan"]["plan_id"] == "replacement"
        assert len(observed) == 2
        assert service._assets["plan"][0] == "replacement"
    finally:
        service._quiescent = True
        await service.close()


@pytest.mark.asyncio
async def test_missing_required_model_asset_remains_an_error():
    from unittest.mock import Mock

    runtime = Mock(spec=["ar_manipulation_asset"])
    runtime.ar_manipulation_asset.return_value = None
    service = ManipulationService(runtime, lambda *args: None, lambda _: None)
    try:
        with pytest.raises(ValueError, match="native model asset retired"):
            await service._materialize({"available": True, "model_revision": "missing"})
    finally:
        service._quiescent = True
        await service.close()


@pytest.mark.asyncio
async def test_duplicate_gripper_id_changes_hardware_only_once():
    calls = []

    class Runtime:
        def ar_manipulation_command(self, client, body):
            calls.append(body)
            return {"status": "completed"}

        def ar_manipulation_stop(self):
            pass

        def ar_manipulation_disconnect(self, client):
            pass

    replies = []
    service = ManipulationService(Runtime(), lambda _, message: replies.append(message), lambda _: None)
    service.connect("a")
    request = ManipulationRequest("squeeze-1", "gripper", "arm", {"value": 0})
    try:
        service.submit(request, "a")
        service.submit(request, "a")
        for _ in range(100):
            if replies:
                break
            await asyncio.sleep(0.01)
        assert len(calls) == 1
        service.submit(request, "a")
        assert len(calls) == 1
        assert len(replies) == 2
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_shared_following_renewals_refresh_native_input_with_new_sequences():
    calls = []

    class Runtime:
        def ar_manipulation_command(self, client, body):
            calls.append(body)
            return {"status": "following"}

        def ar_manipulation_evaluate_following(self, client, body):
            return {"status": "following"}

        def ar_manipulation_stop(self):
            pass

        def ar_manipulation_disconnect(self, client):
            pass

    service = ManipulationService(Runtime(), lambda *_: None, lambda _: None)
    service.connect("a")
    service._shared_tokens["a"] = ("lease", "token")
    body = {"authority_lease": "lease", "sequence": 1, "ts": 0}
    try:
        service.follow_shared("a", "arm", body)
        for _ in range(100):
            if calls and ("a", "update") not in service._pending:
                break
            await asyncio.sleep(0.01)
        service.follow_shared("a", "arm", body)
        for _ in range(100):
            if len(calls) == 2:
                break
            await asyncio.sleep(0.01)
        assert [body["sequence"] for body in calls] == [1, 2]
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_retired_shared_follow_token_is_reported_instead_of_silently_stalling():
    class Runtime:
        def ar_manipulation_command(self, client, body):
            return {"status": "following", "message": "Following retired"}

        def ar_manipulation_stop(self):
            pass

    replies = []
    service = ManipulationService(Runtime(), lambda _, message: replies.append(json.loads(message)), lambda _: None)
    service.connect("a")
    try:
        await service._dispatch(ManipulationRequest("shared-follow-expired-1", "update", "arm", {"sequence": 1, "ts": 0}), "a", 0)
        assert replies[0]["status"] == "rejected"
        assert replies[0]["code"] == "retired"
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_advisory_timing_counts_outcomes_timeouts_and_maximum_duration(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    now = [100.0]
    monkeypatch.setattr("dimos.ar.manipulation.service.time", SimpleNamespace(monotonic=lambda: now[0]))
    service = ManipulationService(object(), lambda *_: None, lambda _: None)
    timing = service._advisory_timing = Mock()
    outcomes = [
        {"status": "feasible"},
        {"status": "infeasible", "code": "ik_failed"},
        ValueError("collision"),
        TimeoutError("native IK timed out"),
    ]

    async def call(*_args, **_kwargs):
        now[0] += 0.25
        result = outcomes.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    service._rpc.call = call
    for i in range(4):
        await service._dispatch(ManipulationRequest(str(i), "evaluate", "arm", {}), "a", 0)
    counts = {}
    maxima = {}
    for record in timing.record.call_args_list:
        for key, count in record.kwargs["counts"].items():
            counts[key] = counts.get(key, 0) + count
        for key, value in record.kwargs["maxima"].items():
            maxima[key] = max(maxima.get(key, value), value)
    assert counts == {"requests": 4, "completions": 4, "failures": 3, "timeouts": 1}
    assert maxima["duration_max_ms"] == 250
    assert not service._advisory_started


@pytest.mark.asyncio
async def test_advisory_pending_age_preserves_equal_request_ids_from_different_clients(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    now = [100.0]
    monkeypatch.setattr("dimos.ar.manipulation.service.time", SimpleNamespace(monotonic=lambda: now[0]))
    service = ManipulationService(object(), lambda *_: None, lambda _: None)
    timing = service._advisory_timing = Mock()
    release = {client: asyncio.Event() for client in ("a", "b")}

    async def call(method, *args, **_kwargs):
        if method == "ar_manipulation_snapshot":
            service._closed = True
            return {"available": False}
        await release[args[0]].wait()
        return {"status": "feasible"}

    async def wait_readers():
        pass

    service._rpc.call = call
    service._rpc.wait_readers = wait_readers
    request = ManipulationRequest("same-id", "evaluate", "arm", {})
    first = asyncio.create_task(service._dispatch(request, "a", 0))
    await asyncio.sleep(0)
    now[0] += 1
    second = asyncio.create_task(service._dispatch(request, "b", 0))
    await asyncio.sleep(0)
    try:
        assert len(service._advisory_started) == 2
        release["b"].set()
        await second
        assert service._advisory_started == {("a", "same-id"): 100.0}
        now[0] += 2
        await service._poll_state()
        assert any(
            record.kwargs["maxima"].get("pending_age_max_ms") == 3000
            for record in timing.record.call_args_list
        )
    finally:
        release["a"].set()
        release["b"].set()
        await asyncio.gather(first, second)
    assert not service._advisory_started
