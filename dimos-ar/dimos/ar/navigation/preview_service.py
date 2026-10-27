from __future__ import annotations

import asyncio
from collections.abc import Callable
import time
from typing import Protocol

from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest
from dimos.ar.robot.odometry import AcceptedOdometry
from dimos.ar.robot.odometry_correction import correct_odom_xy, uncorrect_odom_xy
from dimos.ar.websocket.protocol import encode_nav_goal
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
        send: Callable[[str, str], None],
    ) -> None:
        self._closed = False
        self._planner = planner
        self._factor = factor
        self._odometry = odometry
        self._send = send
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self.costmap_ts: float | None = None

    def request(self, request: NavGoalRequest, client_id: str) -> None:
        if self._closed:
            return
        if client_id in self._tasks:
            self._send(client_id, encode_nav_goal(self._empty(request)))
            return
        pose = self._odometry()
        self._tasks[client_id] = asyncio.create_task(self._run(request, client_id, pose))

    async def update_costmap(self, grid: OccupancyGrid) -> None:
        if self._closed:
            return
        await asyncio.to_thread(self._planner.update_costmap, grid)
        if not self._closed:
            self.costmap_ts = grid.ts

    def cancel(self, client_id: str) -> None:
        task = self._tasks.pop(client_id, None)
        if task is not None:
            task.cancel()

    def cancel_all(self) -> None:
        for client_id in tuple(self._tasks):
            self.cancel(client_id)

    async def close(self) -> None:
        self._closed = True
        tasks = tuple(self._tasks.values())
        self.cancel_all()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _run(
        self, request: NavGoalRequest, client_id: str, pose: AcceptedOdometry | None
    ) -> None:
        try:
            frame = await asyncio.to_thread(self.compute, request, pose)
            self._send(client_id, encode_nav_goal(frame))
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
