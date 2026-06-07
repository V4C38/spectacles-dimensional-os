from __future__ import annotations

import numpy as np

from dimos.core.global_config import GlobalConfig
from dimos.msgs.nav_msgs.OccupancyGrid import CostValues, OccupancyGrid

from dimos_xr.preview_planner import PreviewPlanner


def _empty_costmap(width: int = 40, height: int = 40, resolution: float = 0.1) -> OccupancyGrid:
    return OccupancyGrid(
        grid=np.full((height, width), CostValues.FREE, dtype=np.int8),
        resolution=resolution,
        frame_id="odom",
    )


def test_preview_planner_returns_path_for_clear_goal() -> None:
    planner = PreviewPlanner(GlobalConfig())
    planner.update_costmap(_empty_costmap())

    path = planner.plan((0.5, 0.5), (3.0, 3.0))

    assert path is not None
    assert len(path) >= 2
    assert path[0][2] == 0.0
    assert path[-1][2] == 0.0


def test_preview_planner_returns_none_when_goal_region_is_blocked() -> None:
    planner = PreviewPlanner(GlobalConfig())
    blocked = OccupancyGrid(
        grid=np.full((40, 40), CostValues.OCCUPIED, dtype=np.int8),
        resolution=0.1,
        frame_id="odom",
    )
    planner.update_costmap(blocked)

    path = planner.plan((0.5, 0.5), (3.0, 3.0))

    assert path is None
