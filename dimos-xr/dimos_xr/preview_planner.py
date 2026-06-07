from __future__ import annotations

import threading

from dimos.core.global_config import GlobalConfig
from dimos.mapping.occupancy.path_resampling import smooth_resample_path
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.nav_msgs.OccupancyGrid import CostValues, OccupancyGrid
from dimos.navigation.replanning_a_star.goal_validator import find_safe_goal
from dimos.navigation.replanning_a_star.min_cost_astar import min_cost_astar
from dimos.navigation.replanning_a_star.navigation_map import NavigationMap


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

    def has_costmap(self) -> bool:
        with self._lock:
            return self._binary_costmap is not None

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
        return [
            (pose.position.x, pose.position.y, 0.0)
            for pose in resampled.poses
        ]

    def _gradient_costmap_for_locked(self, binary_costmap: OccupancyGrid) -> OccupancyGrid:
        if (
            self._gradient_costmap is None
            or self._gradient_costmap_ts is None
            or self._gradient_costmap_ts != binary_costmap.ts
        ):
            self._gradient_costmap = self._navigation_map.make_gradient_costmap(1.1)
            self._gradient_costmap_ts = binary_costmap.ts
        return self._gradient_costmap
