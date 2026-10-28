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
    assert set(events[:-1]) == {("disconnect", "owner"), ("disconnect", "observer")}
    assert events[-1] == ("stop", None)
