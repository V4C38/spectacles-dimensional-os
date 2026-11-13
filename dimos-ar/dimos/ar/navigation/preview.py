"""Preview planning and bounded request scheduling."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
import threading
import time
from typing import TYPE_CHECKING, Protocol

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest
from dimos.ar.robot.odometry import AcceptedOdometry
from dimos.ar.robot.odometry_correction import correct_odom_xy, uncorrect_odom_xy
from dimos.mapping.occupancy.path_resampling import smooth_resample_path
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.nav_msgs.OccupancyGrid import CostValues, OccupancyGrid
from dimos.navigation.go2.replanning_a_star.goal_validator import find_safe_goal
from dimos.navigation.go2.replanning_a_star.min_cost_astar import min_cost_astar
from dimos.navigation.go2.replanning_a_star.navigation_map import NavigationMap
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.core.global_config import GlobalConfig


class PreviewPlanner:
    """Compute preview-only paths using the DimOS global planning primitives."""

    def __init__(self, global_config: GlobalConfig) -> None:
        self._global_config = global_config
        self._navigation_map = NavigationMap(global_config, "gradient")
        self._lock = threading.Lock()
        self._binary_costmap: OccupancyGrid | None = None
        self._gradient_costmap: OccupancyGrid | None = None
        self._gradient_costmap_ts: float | None = None

    def update_costmap(self, grid: OccupancyGrid) -> None:
        with self._lock:
            self._binary_costmap = grid
            self._navigation_map.update(grid)
            self._gradient_costmap = None
            self._gradient_costmap_ts = None

    def plan(
        self,
        start_xy: tuple[float, float],
        goal_xy: tuple[float, float],
    ) -> list[tuple[float, float, float]] | None:
        with self._lock:
            binary_costmap = self._binary_costmap
            if binary_costmap is None:
                return None
            gradient_costmap = self._gradient_costmap_for_locked(binary_costmap)

        safe_goal = find_safe_goal(
            binary_costmap,
            goal_xy,
            algorithm="bfs_contiguous",
            cost_threshold=CostValues.OCCUPIED,
            min_clearance=self._global_config.robot_rotation_diameter / 2,
            max_search_distance=4.0,
        )
        if safe_goal is None:
            return None

        path = min_cost_astar(gradient_costmap, safe_goal, start_xy)
        if path is None:
            return None

        goal_pose = PoseStamped(
            frame_id=path.frame_id,
            position=[safe_goal.x, safe_goal.y, 0.0],
            orientation=Quaternion(0.0, 0.0, 0.0, 1.0),
        )
        resampled = smooth_resample_path(path, goal_pose, 0.1)
        return [(pose.position.x, pose.position.y, 0.0) for pose in resampled.poses]

    def _gradient_costmap_for_locked(self, binary_costmap: OccupancyGrid) -> OccupancyGrid:
        if (
            self._gradient_costmap is None
            or self._gradient_costmap_ts is None
            or self._gradient_costmap_ts != binary_costmap.ts
        ):
            self._gradient_costmap = self._navigation_map.make_gradient_costmap(1.1)
            self._gradient_costmap_ts = binary_costmap.ts
        return self._gradient_costmap


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
        tasks = (
            *self._tasks.values(),
            *self._busy_replies.values(),
            *([self._costmap_task] if self._costmap_task else []),
        )
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
