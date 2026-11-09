"""Latest-only native command admission remains independent of heartbeat RPCs."""

import asyncio
import threading
from unittest.mock import Mock

import pytest

from dimos.ar.navigation.control_service import NavigationControlService
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


@pytest.mark.asyncio
async def test_native_goal_backlog_is_bounded_and_cancel_retires_pending():
    entered, release = threading.Event(), threading.Event()
    goals, beats = [], []

    class Runtime:
        def ar_navigation_goal(self, goal, epoch, revision, deadline):
            goals.append(goal.ts)
            entered.set()
            assert release.wait(2)
            return True

        def ar_navigation_heartbeat(self, epoch, revision, deadline):
            beats.append(revision)
            return True

    failed = Mock()
    service = NavigationControlService(Runtime(), lambda: ("epoch", 1), failed)
    service.start()
    try:
        service.submit(PoseStamped(ts=1), "epoch", 1)
        assert await asyncio.to_thread(entered.wait, 1)
        for stamp in range(2, 20):
            service.submit(PoseStamped(ts=stamp), "epoch", stamp)
        await asyncio.sleep(0.12)
        assert len(beats) >= 1
        assert goals == [1]
        service.cancel()
        release.set()
        await service._worker
        assert goals == [1]
        failed.assert_not_called()
    finally:
        release.set()
        await service.close()
