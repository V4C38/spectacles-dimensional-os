from __future__ import annotations

import asyncio
from dataclasses import replace
import math
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest

from dimos.ar.navigation.preview import NavigationPreviewService
from dimos.ar.navigation.types import NavGoalRequest
from dimos.ar.spatial import FrameSnapshot


def _frames() -> FrameSnapshot:
    return FrameSnapshot.initial("odom")


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
        frames=_frames,
        odometry=lambda: SimpleNamespace(position=(0, 0, 0)),
        on_preview=AsyncMock(side_effect=lambda client, _request, frame: replies.append((client, frame))),
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


async def test_costmap_burst_keeps_one_worker_and_only_latest_pending():
    entered, release = threading.Event(), threading.Event()
    calls = []

    def update(grid):
        calls.append(grid.ts)
        if len(calls) == 1:
            entered.set()
            assert release.wait(2)

    service = NavigationPreviewService(
        SimpleNamespace(update_costmap=update),
        frames=_frames,
        odometry=lambda: None,
        on_preview=AsyncMock(),
    )
    try:
        await service.update_costmap(SimpleNamespace(ts=1))
        assert await asyncio.to_thread(entered.wait, 1)
        for stamp in range(2, 20):
            await service.update_costmap(SimpleNamespace(ts=stamp))
        assert calls == [1]
        release.set()
        async with asyncio.timeout(1):
            while service.costmap_ts != 19:
                await asyncio.sleep(0.01)
        assert calls == [1, 19]
    finally:
        release.set()
        await service.close()


async def test_busy_preview_delivery_is_bounded_and_cannot_overwrite_completed_route():
    release = threading.Event()
    busy_started, busy_retired = asyncio.Event(), asyncio.Event()
    replies = []

    def plan(_start, target):
        assert release.wait(2)
        return [(target[0], target[1], 0)]

    async def publish(_client, _request, frame):
        if not frame.path_poses:
            busy_started.set()
            try:
                await asyncio.Future()
            finally:
                busy_retired.set()
        else:
            replies.append(frame)

    service = NavigationPreviewService(
        SimpleNamespace(plan=plan), frames=_frames,
        odometry=lambda: SimpleNamespace(position=(0, 0, 0)), on_preview=publish,
    )
    request = NavGoalRequest((1, 0, 0), (0, 0, 0, 1), True, "preview")
    try:
        service.request(request, "a")
        service.request(request, "a")
        await asyncio.wait_for(busy_started.wait(), 1)
        for _ in range(5):
            service.request(request, "a")
        assert len(service._busy_replies) == 1
        release.set()
        await service._tasks["a"]
        assert busy_retired.is_set() and not service._busy_replies
        assert len(replies) == 1 and replies[0].path_poses
    finally:
        release.set()
        await service.close()


async def test_preview_plans_in_native_coordinates_and_projects_back_to_map():
    matrix = np.array([[0, -1, 0, 10], [1, 0, 0, -3], [0, 0, 1, 2], [0, 0, 0, 1]], dtype=float)
    snapshot = replace(_frames(), T_map_odom=matrix)
    calls = []

    def plan(start, target):
        calls.append((start, target))
        return [(start[0], start[1], 0), (target[0], target[1], 0)]

    service = NavigationPreviewService(
        SimpleNamespace(plan=plan), frames=lambda: snapshot,
        odometry=lambda: None, on_preview=AsyncMock(),
    )
    try:
        half = math.sqrt(0.5)
        request = NavGoalRequest((8, 1, 2.33), (0, 0, half, half), True, "route")
        frame = service.compute(request, SimpleNamespace(position=(1, 2, 0.33)), snapshot)
        assert calls == [((1, 2), (4, 2))]
        assert frame.path_poses[0] == pytest.approx((8, -2, 2.33, math.pi / 2))
        assert frame.pose == pytest.approx((8, 1, 2.33, math.pi / 2))
    finally:
        await service.close()


@pytest.mark.parametrize("change", ["adoption", "correction", "odometry_reset"])
async def test_preview_completion_from_old_frame_is_discarded(change):
    entered, release = threading.Event(), threading.Event()
    snapshot = _frames()
    replies = AsyncMock()

    def plan(_start, target):
        entered.set()
        assert release.wait(2)
        return [(target[0], target[1], 0)]

    service = NavigationPreviewService(
        SimpleNamespace(plan=plan), frames=lambda: snapshot,
        odometry=lambda: SimpleNamespace(position=(0, 0, 0)), on_preview=replies,
    )
    try:
        service.request(NavGoalRequest((1, 0, 0), (0, 0, 0, 1), True, "route"), "client")
        task = service._tasks["client"]
        assert await asyncio.to_thread(entered.wait, 1)
        changes = {
            "adoption": {"shared_frame_id": "vps"},
            "correction": {"revision": 1},
            "odometry_reset": {"odom_reference_id": "new-odom"},
        }
        snapshot = replace(snapshot, **changes[change])
        release.set()
        await task
        replies.assert_not_awaited()
    finally:
        release.set()
        await service.close()
