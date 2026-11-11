from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
import time
from typing import Protocol

from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest
from dimos.ar.robot.odometry import AcceptedOdometry
from dimos.ar.robot.odometry_correction import correct_odom_xy, uncorrect_odom_xy
from dimos.ar.worker import BoundedWorker
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class PreviewPlanningPort(Protocol):
    def update_costmap(self, grid: OccupancyGrid) -> None: ...

    def plan(
        self, start_xy: tuple[float, float], goal_xy: tuple[float, float]
    ) -> list[tuple[float, float, float]] | None: ...


class NavigationPreviewService:
    def __init__(
        self,
        planner: PreviewPlanningPort,
        *,
        factor: float,
        odometry: Callable[[], AcceptedOdometry | None],
        on_preview: Callable[[str, NavGoalRequest, NavGoalFrame], Awaitable[None]],
    ) -> None:
        self._closed = False
        self._planner = planner
        self._factor = factor
        self._odometry = odometry
        self._on_preview = on_preview
        self._worker = BoundedWorker("ar-preview")
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._busy_replies: dict[str, asyncio.Task[None]] = {}
        self._costmap_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ar-costmap")
        self._costmap_pending: OccupancyGrid | None = None
        self._costmap_task: asyncio.Task[None] | None = None
        self.costmap_ts: float | None = None

    def request(self, request: NavGoalRequest, client_id: str) -> None:
        if self._closed:
            return
        if client_id in self._tasks:
            if client_id not in self._busy_replies:
                self._busy_replies[client_id] = asyncio.create_task(
                    self._reply_busy(request, client_id)
                )
            return
        pose = self._odometry()
        self._tasks[client_id] = asyncio.create_task(self._run(request, client_id, pose))

    async def _reply_busy(self, request: NavGoalRequest, client_id: str) -> None:
        try:
            await self._on_preview(client_id, request, self._empty(request))
        finally:
            if self._busy_replies.get(client_id) is asyncio.current_task():
                self._busy_replies.pop(client_id, None)

    async def update_costmap(self, grid: OccupancyGrid) -> None:
        if self._closed:
            return
        self._costmap_pending = grid
        if self._costmap_task is None or self._costmap_task.done():
            self._costmap_task = asyncio.create_task(self._drain_costmaps())
        # Return after bounded admission. A newer costmap replaces the pending
        # sample; native work already running is never canceled or duplicated.
        await asyncio.sleep(0)

    async def _drain_costmaps(self) -> None:
        while self._costmap_pending is not None and not self._closed:
            grid = self._costmap_pending
            self._costmap_pending = None
            future = asyncio.get_running_loop().run_in_executor(
                self._costmap_executor, self._planner.update_costmap, grid
            )
            await asyncio.shield(future)
            if not self._closed:
                self.costmap_ts = grid.ts

    def cancel(self, client_id: str) -> None:
        task = self._tasks.pop(client_id, None)
        if task is not None:
            task.cancel()
        reply = self._busy_replies.pop(client_id, None)
        if reply is not None:
            reply.cancel()

    def cancel_all(self) -> None:
        for client_id in self._tasks.keys() | self._busy_replies.keys():
            self.cancel(client_id)

    async def close(self) -> None:
        self._closed = True
        self._costmap_pending = None
        tasks = (*self._tasks.values(), *self._busy_replies.values(),
                 *([self._costmap_task] if self._costmap_task else []))
        self.cancel_all()
        if self._costmap_task is not None:
            self._costmap_task.cancel()
        self._costmap_executor.shutdown(wait=False, cancel_futures=True)
        await asyncio.gather(*tasks, return_exceptions=True)
        self._worker.close()

    async def _run(
        self, request: NavGoalRequest, client_id: str, pose: AcceptedOdometry | None
    ) -> None:
        try:
            frame = await self._worker.run(lambda: self.compute(request, pose))
            busy = self._busy_replies.get(client_id)
            if busy is not None:
                busy.cancel()
                await asyncio.gather(busy, return_exceptions=True)
            await self._on_preview(client_id, request, frame)
        finally:
            if self._tasks.get(client_id) is asyncio.current_task():
                self._tasks.pop(client_id, None)

    def compute(self, request: NavGoalRequest, pose: AcceptedOdometry | None) -> NavGoalFrame:
        empty = self._empty(request)
        if pose is None:
            return empty
        try:
            path = self._planner.plan(
                pose.position[:2], uncorrect_odom_xy(*request.position[:2], factor=self._factor)
            )
            if not path:
                return empty
            yaw = PoseStamped(
                position=list(request.position), orientation=list(request.orientation)
            ).yaw
            poses = [
                (*correct_odom_xy(x, y, factor=self._factor), request.position[2], yaw)
                for x, y, _z in path
            ]
            return NavGoalFrame(
                pose=poses[-1],
                path_poses=poses,
                ts=time.time(),
                preview=True,
                preview_id=request.preview_id,
            )
        except Exception:
            logger.exception("preview planning failed")
            return empty

    @staticmethod
    def _empty(request: NavGoalRequest) -> NavGoalFrame:
        return NavGoalFrame(
            pose=None, path_poses=[], ts=time.time(), preview=True, preview_id=request.preview_id
        )
