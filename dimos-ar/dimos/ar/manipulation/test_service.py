import asyncio
import threading

import pytest

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.service import ManipulationService


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
async def test_cancelled_rpc_unsubscribes_callback_and_ignores_late_reply():
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
    unsubscribe.assert_called_once()
    callbacks[0]({"available": True})
    await asyncio.sleep(0)


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
