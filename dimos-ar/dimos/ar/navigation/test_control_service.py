"""Latest-only native command admission remains independent of heartbeat RPCs."""

import asyncio
import threading
from unittest.mock import Mock

import pytest

from dimos.ar.navigation.control import NavigationControlService
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

        def ar_navigation_recover(self, epoch, revision, deadline):
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


@pytest.mark.asyncio
async def test_explicit_stop_recovers_only_after_native_stop_is_confirmed():
    runtime = Mock()
    runtime.ar_navigation_goal.side_effect = TimeoutError("unknown outcome")
    runtime.ar_navigation_recover.return_value = False
    service = NavigationControlService(runtime, lambda: ("epoch", 3), Mock())
    try:
        service.submit(PoseStamped(ts=1), "epoch", 1)
        await service._worker
        assert service.faulted
        assert not service.submit(PoseStamped(ts=2), "epoch", 2)
        service.cancel()
        await asyncio.sleep(0.02)
        assert service.faulted
        assert service.stop_pending
        runtime.ar_navigation_recover.return_value = True
        await asyncio.wait_for(service._recovery, 1)
        assert not service.faulted
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_recovery_cannot_overtake_an_actual_timed_out_native_goal():
    entered, release = threading.Event(), threading.Event()
    runtime = Mock()

    def goal(*args):
        entered.set()
        assert release.wait(3)
        return True

    runtime.ar_navigation_goal.side_effect = goal
    runtime.ar_navigation_recover.return_value = True
    service = NavigationControlService(runtime, lambda: ("epoch", 3), Mock())
    call = service._rpc.call

    async def short_call(method, *args, **kwargs):
        if method == "ar_navigation_goal":
            kwargs["timeout"] = 0.02
        return await call(method, *args, **kwargs)

    service._rpc.call = short_call
    try:
        service.submit(PoseStamped(ts=1), "epoch", 1)
        assert await asyncio.to_thread(entered.wait, 1)
        await service._worker
        service.cancel()
        await asyncio.sleep(0.05)
        assert service.faulted
        runtime.ar_navigation_recover.assert_not_called()
        release.set()
        await service._recovery
        assert not service.faulted
    finally:
        release.set()
        await service.close()


@pytest.mark.asyncio
async def test_normal_stop_waits_for_ack_without_publishing_a_navigation_fault():
    entered, release = threading.Event(), threading.Event()
    runtime = Mock()

    def stop(*args):
        entered.set()
        assert release.wait(2)
        return True

    runtime.ar_navigation_recover.side_effect = stop
    recovered = Mock()
    service = NavigationControlService(runtime, lambda: ("epoch", 1), Mock(), recovered)
    try:
        service.cancel()
        assert service.stop_pending
        assert not service.faulted
        assert not service.submit(PoseStamped(ts=1), "epoch", 1)
        assert await asyncio.to_thread(entered.wait, 1)
        release.set()
        await asyncio.wait_for(service._recovery, 1)
        assert not service.stop_pending
        assert not service.faulted
        recovered.assert_called_once()
    finally:
        release.set()
        await service.close()
