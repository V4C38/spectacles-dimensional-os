"""Tests for Go2RobotProfileModule and G1RobotProfileModule."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from dimos_lcm.std_msgs import Bool
import pytest

from dimos.ar.robot_profile.base import (
    DEFAULT_BASELINE_MOTION_RECIPE,
    BaselineMotionRecipe,
    resolve_baseline_motion_recipe,
)
from dimos.ar.robot_profile.g1 import G1RobotProfileModule
from dimos.ar.robot_profile.go2 import Go2RobotProfileModule
from dimos.msgs.nav_msgs.Odometry import Odometry


class _FakeStream:
    def __init__(self, *, connected: bool) -> None:
        self.transport = object() if connected else None
        self.published: list[object] = []

    def publish(self, msg: object) -> None:
        self.published.append(msg)


def _make_go2_profile() -> Go2RobotProfileModule:
    profile = object.__new__(Go2RobotProfileModule)
    profile._go2_connection = None
    profile.config = SimpleNamespace(robot_id="unitree_go2")
    profile.goal_request = _FakeStream(connected=False)
    profile.goal_req = _FakeStream(connected=False)
    profile.clicked_point = _FakeStream(connected=False)
    profile.stop_movement = _FakeStream(connected=False)
    profile.cancel_goal_signal = _FakeStream(connected=False)
    profile.cmd_vel = _FakeStream(connected=False)
    profile.ar_lidar = _FakeStream(connected=True)
    profile.ar_odom = _FakeStream(connected=True)
    profile.ar_global_costmap = _FakeStream(connected=True)
    profile.ar_path = _FakeStream(connected=True)
    profile.ar_goal_reached = _FakeStream(connected=True)
    profile.ar_navigation_state = _FakeStream(connected=True)
    profile.ar_lidar_in = _FakeStream(connected=False)
    profile.ar_odom_in = _FakeStream(connected=False)
    profile.ar_global_costmap_in = _FakeStream(connected=False)
    profile.ar_path_in = _FakeStream(connected=False)
    profile.ar_goal_reached_in = _FakeStream(connected=False)
    profile.ar_navigation_state_in = _FakeStream(connected=False)
    return profile


def _make_g1_profile() -> G1RobotProfileModule:
    profile = object.__new__(G1RobotProfileModule)
    profile._g1_connection = None
    profile._g1_high_level = None
    profile.config = SimpleNamespace(robot_id="unitree_g1")
    profile.goal_request = _FakeStream(connected=False)
    profile.goal_req = _FakeStream(connected=False)
    profile.clicked_point = _FakeStream(connected=False)
    profile.stop_movement = _FakeStream(connected=False)
    profile.cancel_goal_signal = _FakeStream(connected=False)
    profile.cmd_vel = _FakeStream(connected=False)
    profile.ar_lidar = _FakeStream(connected=True)
    profile.ar_odom = _FakeStream(connected=True)
    profile.ar_global_costmap = _FakeStream(connected=True)
    profile.ar_path = _FakeStream(connected=True)
    profile.ar_goal_reached = _FakeStream(connected=True)
    profile.ar_navigation_state = _FakeStream(connected=True)
    profile.ar_lidar_in = _FakeStream(connected=False)
    profile.ar_odom_in = _FakeStream(connected=False)
    profile.ar_global_costmap_in = _FakeStream(connected=False)
    profile.ar_path_in = _FakeStream(connected=False)
    profile.ar_goal_reached_in = _FakeStream(connected=False)
    profile.ar_navigation_state_in = _FakeStream(connected=False)
    return profile


def test_go2_capabilities_disable_preview_without_costmap() -> None:
    profile = _make_go2_profile()

    capabilities = Go2RobotProfileModule.capabilities(profile)

    assert capabilities["plan_preview"].available is False


def test_go2_robot_id_and_model() -> None:
    profile = _make_go2_profile()

    assert Go2RobotProfileModule.robot_id(profile) == "unitree_go2"
    assert Go2RobotProfileModule.robot_model(profile) == "unitree_go2"


def test_g1_capabilities_report_emergency_stop_unavailable_without_hw() -> None:
    profile = _make_g1_profile()

    capabilities = G1RobotProfileModule.capabilities(profile)

    assert capabilities["emergency_stop"].available is False
    assert capabilities["registration_april_odom_baseline"].available is False


def test_g1_robot_id_and_model() -> None:
    profile = _make_g1_profile()

    assert G1RobotProfileModule.robot_id(profile) == "unitree_g1"
    assert G1RobotProfileModule.robot_model(profile) == "unitree_g1"


def test_go2_baseline_motion_recipe_matches_teleop() -> None:
    profile = _make_go2_profile()

    assert Go2RobotProfileModule.baseline_motion_recipe(profile) == DEFAULT_BASELINE_MOTION_RECIPE
    assert DEFAULT_BASELINE_MOTION_RECIPE.strafe_speed == pytest.approx(0.4)


def test_g1_baseline_motion_available_and_capability_follow_cmd_vel_transport() -> None:
    profile = _make_g1_profile()
    profile.cmd_vel = _FakeStream(connected=True)

    assert G1RobotProfileModule.baseline_motion_available(profile) is True
    assert G1RobotProfileModule.baseline_motion_recipe(profile) == DEFAULT_BASELINE_MOTION_RECIPE
    assert (
        G1RobotProfileModule.capabilities(profile)["registration_april_odom_baseline"].available
        is True
    )


def test_go2_runtime_tag_tracking_profile_defaults() -> None:
    profile = _make_go2_profile()
    runtime = Go2RobotProfileModule.runtime_tag_tracking_profile(profile)
    assert runtime.runtime_static_speed_mps == 0.05
    assert runtime.runtime_speed_horizon_s == 0.4


def test_g1_runtime_tag_tracking_profile_overrides() -> None:
    profile = _make_g1_profile()
    runtime = G1RobotProfileModule.runtime_tag_tracking_profile(profile)
    assert runtime.runtime_static_speed_mps == 0.08
    assert runtime.runtime_speed_horizon_s == 0.9


def test_g1_ar_odom_publishes_pose_stamped_with_twist_speed() -> None:
    profile = _make_g1_profile()
    from dimos.msgs.geometry_msgs.Pose import Pose
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.msgs.geometry_msgs.Quaternion import Quaternion
    from dimos.msgs.geometry_msgs.Twist import Twist
    from dimos.msgs.geometry_msgs.Vector3 import Vector3

    odom = Odometry(
        ts=1.5,
        frame_id="odom",
        child_frame_id="base_link",
        pose=Pose(
            position=Vector3(1.0, 2.0, 0.0),
            orientation=Quaternion(0.0, 0.0, 0.0, 1.0),
        ),
        twist=Twist(linear=Vector3(0.3, 0.4, 0.0), angular=Vector3(0.0, 0.0, 0.0)),
    )

    import asyncio

    asyncio.run(G1RobotProfileModule.handle_ar_odom_in(profile, odom))

    assert len(profile.ar_odom.published) == 1
    pose = profile.ar_odom.published[0]
    assert isinstance(pose, PoseStamped)
    assert pose.x == 1.0
    assert pose.y == 2.0
    assert hasattr(pose, "vx") and pose.vx == 0.3  # type: ignore[attr-defined]
    assert hasattr(pose, "vy") and pose.vy == 0.4  # type: ignore[attr-defined]

    from dimos.ar.bridge.odom_buffer import OdomBuffer

    sample = OdomBuffer().sample_from_msg(pose)
    assert sample.measured_speed_mps == pytest.approx(0.5)


def test_resolve_baseline_motion_recipe_uses_profile_value() -> None:
    recipe = BaselineMotionRecipe(
        strafe_speed=0.25,
        leg_duration_s=(2.0, 4.0, 2.0),
        leg_directions=(1.0, -1.0, 1.0),
        leg_distance_multipliers=(1.0, 2.0, 1.0),
    )
    profile = MagicMock()
    profile.baseline_motion_recipe.return_value = recipe
    assert resolve_baseline_motion_recipe(profile) == recipe


def test_resolve_baseline_motion_recipe_defaults_on_failure() -> None:
    profile = MagicMock()
    profile.baseline_motion_recipe.side_effect = RuntimeError("rpc failed")
    assert resolve_baseline_motion_recipe(profile) == DEFAULT_BASELINE_MOTION_RECIPE
