from __future__ import annotations

import pytest

from dimos.ar.blueprints import unitree_go2_ar
from dimos.ar.module import ARModule
from dimos.ar.robot.profiles import RobotName


def test_unitree_go2_ar_selects_robot_explicitly() -> None:
    if unitree_go2_ar is None:
        pytest.skip("unitree_go2 blueprint is not installed")
    atoms = [atom for atom in unitree_go2_ar.active_blueprints if atom.module is ARModule]
    assert len(atoms) == 1
    assert atoms[0].kwargs["robot"] is RobotName.UNITREE_GO2
    ports = {stream.name for stream in atoms[0].streams}
    assert {"odom", "lidar", "path", "goal_reached", "goal_request", "stop_movement"} <= ports
