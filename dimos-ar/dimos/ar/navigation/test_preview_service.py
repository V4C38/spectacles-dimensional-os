from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

from dimos.ar.navigation.preview_service import NavigationPreviewService
from dimos.ar.navigation.types import NavGoalRequest


async def test_cancelled_preview_keeps_native_worker_admission_until_actual_completion():
    entered = threading.Event()
    release = threading.Event()
    calls = []
    replies = []

    def plan(_start, target):
        calls.append(target)
        if len(calls) == 1:
            entered.set()
            release.wait(2)
        return [(target[0], target[1], 0)]

    service = NavigationPreviewService(
        SimpleNamespace(plan=plan),
        factor=1,
        odometry=lambda: SimpleNamespace(position=(0, 0, 0)),
        send=lambda client, body: replies.append((client, body)),
    )
    try:
        service.request(NavGoalRequest((1, 0, 0), (0, 0, 0, 1), True, "first"), "a")
        assert await asyncio.to_thread(entered.wait, 1)
        service.cancel("a")
        service.request(NavGoalRequest((2, 0, 0), (0, 0, 0, 1), True, "second"), "b")
        await asyncio.sleep(0.03)
        assert calls == [(1.0, 0.0)]
        release.set()
        async with asyncio.timeout(1):
            while not replies:
                await asyncio.sleep(0.01)
        assert calls == [(1.0, 0.0), (2.0, 0.0)]
        assert len(replies) == 1 and replies[0][0] == "b"
    finally:
        release.set()
        await service.close()
