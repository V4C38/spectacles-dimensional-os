"""Tests for Go2AdapterModule and G1AdapterModule per-robot adapters."""

from __future__ import annotations

import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from dimos_lcm.std_msgs import Bool

from dimos.ar.adapters.g1 import G1AdapterModule
from dimos.ar.adapters.base import (
    BaselineMotionRecipe,
    DEFAULT_BASELINE_MOTION_RECIPE,
    resolve_baseline_motion_recipe,
)
from dimos.ar.adapters.go2 import Go2AdapterModule
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.nav_msgs.Odometry import Odometry
from dimos.msgs.std_msgs.Bool import Bool as NavBool


class _FakeStream:
    def __init__(self, *, connected: bool) -> None:
        self.transport = object() if connected else None
        self.published: list[object] = []

    def publish(self, msg: object) -> None:
        self.published.append(msg)


def _make_go2_adapter() -> Go2AdapterModule:
    adapter = object.__new__(Go2AdapterModule)
    adapter._go2_connection = None
    adapter._joystick_lock = __import__("threading").Lock()
    adapter._joystick_thread = None
    adapter._joystick_target = (0.0, 0.0, 0.0)
    adapter.config = SimpleNamespace(robot_id="unitree_go2")
    adapter.goal_request = _FakeStream(connected=False)
    adapter.goal_req = _FakeStream(connected=False)
    adapter.clicked_point = _FakeStream(connected=False)
    adapter.stop_movement = _FakeStream(connected=False)
    adapter.cancel_goal_signal = _FakeStream(connected=False)
    adapter.cmd_vel = _FakeStream(connected=False)
    adapter.ar_lidar = _FakeStream(connected=True)
    adapter.ar_odom = _FakeStream(connected=True)
    adapter.ar_global_costmap = _FakeStream(connected=True)
    adapter.ar_path = _FakeStream(connected=True)
    adapter.ar_goal_reached = _FakeStream(connected=True)
    adapter.ar_navigation_state = _FakeStream(connected=True)
    adapter.ar_lidar_in = _FakeStream(connected=False)
    adapter.ar_odom_in = _FakeStream(connected=False)
    adapter.ar_global_costmap_in = _FakeStream(connected=False)
    adapter.ar_path_in = _FakeStream(connected=False)
    adapter.ar_goal_reached_in = _FakeStream(connected=False)
    adapter.ar_navigation_state_in = _FakeStream(connected=False)
    return adapter


def _make_g1_adapter() -> G1AdapterModule:
    adapter = object.__new__(G1AdapterModule)
    adapter._g1_connection = None
    adapter._g1_high_level = None
    adapter._joystick_lock = threading.Lock()
    adapter._joystick_thread = None
    adapter._joystick_target = (0.0, 0.0, 0.0)
    adapter.config = SimpleNamespace(robot_id="unitree_g1")
    adapter.goal_request = _FakeStream(connected=False)
    adapter.goal_req = _FakeStream(connected=False)
    adapter.clicked_point = _FakeStream(connected=False)
    adapter.stop_movement = _FakeStream(connected=False)
    adapter.cancel_goal_signal = _FakeStream(connected=False)
    adapter.cmd_vel = _FakeStream(connected=False)
    adapter.ar_lidar = _FakeStream(connected=True)
    adapter.ar_odom = _FakeStream(connected=True)
    adapter.ar_global_costmap = _FakeStream(connected=True)
    adapter.ar_path = _FakeStream(connected=True)
    adapter.ar_goal_reached = _FakeStream(connected=True)
    adapter.ar_navigation_state = _FakeStream(connected=True)
    adapter.ar_lidar_in = _FakeStream(connected=False)
    adapter.ar_odom_in = _FakeStream(connected=False)
    adapter.ar_global_costmap_in = _FakeStream(connected=False)
    adapter.ar_path_in = _FakeStream(connected=False)
    adapter.ar_goal_reached_in = _FakeStream(connected=False)
    adapter.ar_navigation_state_in = _FakeStream(connected=False)
    return adapter


def test_go2_send_nav_goal_uses_goal_req_when_present() -> None:
    adapter = _make_go2_adapter()
    adapter.goal_req = _FakeStream(connected=True)
    goal = PoseStamped(position=[1.0, 2.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0], ts=1.0)

    assert Go2AdapterModule.send_nav_goal(adapter, goal) is True
    assert adapter.goal_req.published == [goal]


def test_go2_cancel_nav_goal_uses_cancel_signal_when_present() -> None:
    adapter = _make_go2_adapter()
    adapter.cancel_goal_signal = _FakeStream(connected=True)

    assert Go2AdapterModule.cancel_nav_goal(adapter) is True
    cancel = adapter.cancel_goal_signal.published[0]
    assert isinstance(cancel, Bool)
    assert cancel.data is True


def test_go2_capabilities_disable_preview_without_costmap() -> None:
    adapter = _make_go2_adapter()

    capabilities = Go2AdapterModule.capabilities(adapter)

    assert capabilities["plan_preview"].available is False


def test_go2_robot_id_and_model() -> None:
    adapter = _make_go2_adapter()

    assert Go2AdapterModule.robot_id(adapter) == "unitree_go2"
    assert Go2AdapterModule.robot_model(adapter) == "unitree_go2"


def test_g1_send_nav_goal_uses_goal_request_when_present() -> None:
    adapter = _make_g1_adapter()
    adapter.goal_request = _FakeStream(connected=True)
    goal = PoseStamped(position=[1.0, 2.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0], ts=1.0)

    assert G1AdapterModule.send_nav_goal(adapter, goal) is True
    assert adapter.goal_request.published == [goal]


def test_g1_cancel_nav_goal_uses_stop_movement() -> None:
    adapter = _make_g1_adapter()
    adapter.stop_movement = _FakeStream(connected=True)

    assert G1AdapterModule.cancel_nav_goal(adapter) is True
    stop = adapter.stop_movement.published[0]
    assert isinstance(stop, Bool)
    assert stop.data is True


def test_g1_cancel_nav_goal_uses_cancel_goal_signal_when_present() -> None:
    adapter = _make_g1_adapter()
    adapter.cancel_goal_signal = _FakeStream(connected=True)

    assert G1AdapterModule.cancel_nav_goal(adapter) is True
    cancel = adapter.cancel_goal_signal.published[0]
    assert isinstance(cancel, NavBool)
    assert cancel.data is True


def test_g1_capabilities_report_emergency_stop_unavailable_without_hw() -> None:
    adapter = _make_g1_adapter()

    capabilities = G1AdapterModule.capabilities(adapter)

    assert capabilities["emergency_stop"].available is False
    assert capabilities["registration_april_odom_baseline"].available is False


def test_g1_robot_id_and_model() -> None:
    adapter = _make_g1_adapter()

    assert G1AdapterModule.robot_id(adapter) == "unitree_g1"
    assert G1AdapterModule.robot_model(adapter) == "unitree_g1"


def test_go2_baseline_motion_recipe_matches_teleop() -> None:
    adapter = _make_go2_adapter()

    assert Go2AdapterModule.baseline_motion_recipe(adapter) == DEFAULT_BASELINE_MOTION_RECIPE
    assert DEFAULT_BASELINE_MOTION_RECIPE.strafe_speed == pytest.approx(0.2)


def test_go2_send_joystick_command_passes_stick_through() -> None:
    adapter = _make_go2_adapter()
    adapter.cmd_vel = _FakeStream(connected=True)

    assert Go2AdapterModule.send_joystick_command(adapter, 0.0, 0.2, 0.0) is True
    for _ in range(100):
        if adapter.cmd_vel.published:
            break
        time.sleep(0.01)
    twist = adapter.cmd_vel.published[0]
    assert isinstance(twist, Twist)
    assert twist.linear.y == pytest.approx(0.2)


def test_g1_baseline_motion_available_and_capability_follow_cmd_vel_transport() -> None:
    adapter = _make_g1_adapter()
    adapter.cmd_vel = _FakeStream(connected=True)

    assert G1AdapterModule.baseline_motion_available(adapter) is True
    assert G1AdapterModule.baseline_motion_recipe(adapter) == DEFAULT_BASELINE_MOTION_RECIPE
    assert G1AdapterModule.capabilities(adapter)["registration_april_odom_baseline"].available is True


def test_g1_send_joystick_command_zero_publishes_stop_twist() -> None:
    adapter = _make_g1_adapter()
    adapter.cmd_vel = _FakeStream(connected=True)

    assert G1AdapterModule.send_joystick_command(adapter, 0.0, 0.0, 0.0) is True
    assert len(adapter.cmd_vel.published) == 1
    twist = adapter.cmd_vel.published[0]
    assert isinstance(twist, Twist)
    assert twist.linear.y == 0.0
    assert twist.angular.z == 0.0


def test_go2_runtime_tag_tracking_profile_defaults() -> None:
    adapter = _make_go2_adapter()
    profile = Go2AdapterModule.runtime_tag_tracking_profile(adapter)
    assert profile.runtime_static_speed_mps == 0.05
    assert profile.runtime_speed_horizon_s == 0.4


def test_g1_runtime_tag_tracking_profile_overrides() -> None:
    adapter = _make_g1_adapter()
    profile = G1AdapterModule.runtime_tag_tracking_profile(adapter)
    assert profile.runtime_static_speed_mps == 0.08
    assert profile.runtime_speed_horizon_s == 0.9


def test_g1_ar_odom_publishes_pose_stamped_with_twist_speed() -> None:
    adapter = _make_g1_adapter()
    from dimos.msgs.geometry_msgs.Pose import Pose
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

    asyncio.run(G1AdapterModule.handle_ar_odom_in(adapter, odom))

    assert len(adapter.ar_odom.published) == 1
    pose = adapter.ar_odom.published[0]
    assert isinstance(pose, PoseStamped)
    assert pose.x == 1.0
    assert pose.y == 2.0
    assert hasattr(pose, "vx") and pose.vx == 0.3  # type: ignore[attr-defined]
    assert hasattr(pose, "vy") and pose.vy == 0.4  # type: ignore[attr-defined]

    from dimos.ar.bridge.odom_buffer import OdomBuffer

    sample = OdomBuffer().sample_from_msg(pose)
    assert sample.measured_speed_mps == pytest.approx(0.5)


def test_resolve_baseline_motion_recipe_uses_adapter_value() -> None:
    recipe = BaselineMotionRecipe(
        strafe_speed=0.25,
        leg_duration_s=(2.0, 4.0, 2.0),
        leg_directions=(1.0, -1.0, 1.0),
        leg_distance_multipliers=(1.0, 2.0, 1.0),
    )
    adapter = MagicMock()
    adapter.baseline_motion_recipe.return_value = recipe
    assert resolve_baseline_motion_recipe(adapter) == recipe


def test_resolve_baseline_motion_recipe_defaults_on_failure() -> None:
    adapter = MagicMock()
    adapter.baseline_motion_recipe.side_effect = RuntimeError("rpc failed")
    assert resolve_baseline_motion_recipe(adapter) == DEFAULT_BASELINE_MOTION_RECIPE
