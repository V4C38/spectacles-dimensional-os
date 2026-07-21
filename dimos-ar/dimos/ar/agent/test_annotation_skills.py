from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from dimos.ar.agent.skills import (
    ArAnnotationSkillContainer,
    ArNavigationSkillContainer,
)


def _make_annotation_container() -> tuple[ArAnnotationSkillContainer, MagicMock]:
    bridge = MagicMock()
    bridge.draw_world_annotation.side_effect = (
        lambda **kwargs: f"ok:{kwargs.get('annotation_id')}:{kwargs.get('active')}"
    )
    container = ArAnnotationSkillContainer()
    container._ar_annotation = bridge
    return container, bridge


def _make_nav_container() -> tuple[ArNavigationSkillContainer, MagicMock]:
    bridge = MagicMock()
    bridge.get_user_pose.return_value = "User is 1.00m ahead, 0.00m left, 0.00m up from the robot"
    container = ArNavigationSkillContainer()
    container._ar_navigation = bridge
    return container, bridge


def test_place_marker_robot_relative_payload() -> None:
    container, bridge = _make_annotation_container()
    result = container.place_marker(
        forward=1.0,
        left=0.5,
        up=0.2,
        label="Chair",
        annotation_id="chair-1",
        duration_s=30.0,
    )
    assert "chair-1" in result
    kwargs: dict[str, Any] = bridge.draw_world_annotation.call_args.kwargs
    assert kwargs["annotation_id"] == "chair-1"
    assert kwargs["kind"] == "marker"
    assert kwargs["points"] == [[1.0, 0.5, 0.2]]
    assert kwargs["label"] == "Chair"
    assert kwargs["active"] is True
    assert kwargs["duration_s"] == 30.0


def test_draw_line_robot_relative_payload_with_color() -> None:
    container, bridge = _make_annotation_container()
    container.draw_line(
        forward1=0.0,
        left1=0.0,
        up1=0.0,
        forward2=1.0,
        left2=0.0,
        up2=0.5,
        annotation_id="line-1",
        color_r=0.2,
        color_g=0.4,
        color_b=0.6,
    )
    kwargs = bridge.draw_world_annotation.call_args.kwargs
    assert kwargs["kind"] == "line"
    assert kwargs["points"] == [[0.0, 0.0, 0.0], [1.0, 0.0, 0.5]]
    assert kwargs["color"] == [0.2, 0.4, 0.6]
    assert kwargs["active"] is True


def test_clear_annotation_payload() -> None:
    container, bridge = _make_annotation_container()
    container.clear_annotation("marker-9")
    kwargs = bridge.draw_world_annotation.call_args.kwargs
    assert kwargs["annotation_id"] == "marker-9"
    assert kwargs["active"] is False


def test_get_user_pose_skill_delegates() -> None:
    container, bridge = _make_nav_container()
    result = container.get_user_pose()
    assert "1.00m ahead" in result
    bridge.get_user_pose.assert_called_once_with()
