"""Unit tests for get_user_pose and robot-relative annotation conversion on ARBridge."""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any
from unittest.mock import MagicMock

from dimos.ar.agent.skill_dispatcher import ArSkillError
from dimos.ar.agent.wire import ArSkillResultMessage
from dimos.ar.bridge.module import ARBridge


def _make_bridge_stub() -> ARBridge:
    """Minimal ARBridge with nav + dispatcher injected (no full build())."""
    bridge = ARBridge.__new__(ARBridge)
    bridge._nav = MagicMock()
    bridge._ar_skill_dispatcher = MagicMock()
    relay = MagicMock()
    relay.detail_phase.side_effect = lambda *_a, **_k: nullcontext()
    bridge._agent_relay = relay
    return bridge


def test_get_user_pose_formats_robot_relative() -> None:
    bridge = _make_bridge_stub()
    bridge._ar_skill_dispatcher.request.return_value = ArSkillResultMessage(
        ts=1.0,
        robot_id="go2",
        request_id="r1",
        ok=True,
        skill="get_user_hmd_transform",
        data={
            "position": [2.0, 1.0, 0.0],
            "orientation": [0.0, 0.0, 0.0, 1.0],
        },
    )
    bridge._nav.world_to_robot_relative.return_value = (2.1, 0.35, 0.8)
    bridge._nav.world_yaw_degrees_ccw_from_robot.return_value = 160.0

    result = bridge.get_user_pose()
    assert result == (
        "User is 2.10m ahead, 0.35m left, 0.80m up "
        "from the robot; facing 160.0 degrees CCW from robot heading"
    )
    bridge._nav.world_to_robot_relative.assert_called_once_with((2.0, 1.0, 0.0))


def test_get_user_pose_passes_dispatcher_error() -> None:
    bridge = _make_bridge_stub()
    bridge._ar_skill_dispatcher.request.side_effect = ArSkillError(
        "No AR client connected"
    )
    assert bridge.get_user_pose() == "No AR client connected"


def test_get_user_pose_passes_ok_false() -> None:
    bridge = _make_bridge_stub()
    bridge._ar_skill_dispatcher.request.return_value = ArSkillResultMessage(
        ts=1.0,
        robot_id="go2",
        request_id="r1",
        ok=False,
        skill="get_user_hmd_transform",
        error="camera transform unavailable",
    )
    assert bridge.get_user_pose() == "camera transform unavailable"


def test_get_user_pose_passes_nav_guard() -> None:
    bridge = _make_bridge_stub()
    bridge._ar_skill_dispatcher.request.return_value = ArSkillResultMessage(
        ts=1.0,
        robot_id="go2",
        request_id="r1",
        ok=True,
        skill="get_user_hmd_transform",
        data={
            "position": [1.0, 0.0, 0.0],
            "orientation": [0.0, 0.0, 0.0, 1.0],
        },
    )
    bridge._nav.world_to_robot_relative.return_value = "World frame is not committed"
    assert bridge.get_user_pose() == "World frame is not committed"


def test_draw_world_annotation_converts_relative_points() -> None:
    bridge = _make_bridge_stub()
    bridge._nav.robot_relative_to_world.side_effect = [
        (10.0, 0.5, 1.0),
        (11.0, 0.5, 2.0),
    ]
    bridge._ar_skill_dispatcher.request.return_value = ArSkillResultMessage(
        ts=1.0,
        robot_id="go2",
        request_id="r1",
        ok=True,
        skill="draw_world_annotation",
    )

    result = bridge.draw_world_annotation(
        annotation_id="line-1",
        kind="line",
        points=[[1.0, 0.0, 0.0], [2.0, 0.0, 0.5]],
        active=True,
    )
    assert "drawn" in result
    sent_args: dict[str, Any] = bridge._ar_skill_dispatcher.request.call_args.args[1]
    assert sent_args["points"] == [[10.0, 0.5, 1.0], [11.0, 0.5, 2.0]]
    assert bridge._nav.robot_relative_to_world.call_count == 2


def test_draw_world_annotation_guard_before_wire() -> None:
    bridge = _make_bridge_stub()
    bridge._nav.robot_relative_to_world.return_value = "No odometry available yet"

    result = bridge.draw_world_annotation(
        annotation_id="m1",
        kind="marker",
        points=[[1.0, 0.0, 0.0]],
        active=True,
    )
    assert result == "No odometry available yet"
    bridge._ar_skill_dispatcher.request.assert_not_called()


def test_draw_world_annotation_clear_skips_conversion() -> None:
    bridge = _make_bridge_stub()
    bridge._ar_skill_dispatcher.request.return_value = ArSkillResultMessage(
        ts=1.0,
        robot_id="go2",
        request_id="r1",
        ok=True,
        skill="draw_world_annotation",
    )
    result = bridge.draw_world_annotation(annotation_id="m1", active=False)
    assert "cleared" in result
    bridge._nav.robot_relative_to_world.assert_not_called()
    sent_args = bridge._ar_skill_dispatcher.request.call_args.args[1]
    assert sent_args["active"] is False
    assert "points" not in sent_args
