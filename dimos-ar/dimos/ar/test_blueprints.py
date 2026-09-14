from __future__ import annotations

import pytest

from dimos.ar.blueprints import unitree_go2_ar, unitree_go2_ar_agentic
from dimos.ar.module import ARModule
from dimos.ar.robot.profiles import RobotName


def test_unitree_go2_ar_selects_robot_explicitly() -> None:
    if unitree_go2_ar is None:
        pytest.skip("unitree_go2 blueprint is not installed")
    atoms = [atom for atom in unitree_go2_ar.active_blueprints if atom.module is ARModule]
    assert len(atoms) == 1
    assert atoms[0].kwargs["robot"] is RobotName.UNITREE_GO2
    assert atoms[0].kwargs.get("agent", False) is False
    ports = {stream.name for stream in atoms[0].streams}
    assert {"odom", "lidar", "path", "goal_reached", "goal_request", "stop_movement"} <= ports
    assert {"human_input", "agent", "agent_idle", "tele_cmd_vel"} <= ports


def test_unitree_go2_ar_agentic_wires_agent_ports() -> None:
    if unitree_go2_ar_agentic is None:
        pytest.skip("unitree_go2_agentic blueprint is not installed")
    atoms = [atom for atom in unitree_go2_ar_agentic.active_blueprints if atom.module is ARModule]
    assert len(atoms) == 1
    assert atoms[0].kwargs["robot"] is RobotName.UNITREE_GO2
    assert atoms[0].kwargs["agent"] is True
    ports = {stream.name for stream in atoms[0].streams}
    assert {"human_input", "agent", "agent_idle"} <= ports
    names = {atom.module.__name__ for atom in unitree_go2_ar_agentic.active_blueprints}
    assert "McpClient" in names
    assert "McpServer" in names
