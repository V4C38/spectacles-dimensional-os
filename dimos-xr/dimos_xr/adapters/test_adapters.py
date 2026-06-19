"""Tests for Go2AdapterModule and G1AdapterModule per-robot adapters."""

from __future__ import annotations

import threading
from types import SimpleNamespace

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos_lcm.std_msgs import Bool

from dimos_xr.adapters.g1 import G1AdapterModule
from dimos_xr.adapters.go2 import Go2AdapterModule


class _FakeStream:
    def __init__(self, *, connected: bool) -> None:
        self.transport = object() if connected else None
        self.published: list[object] = []

    def publish(self, msg: object) -> None:
        self.published.append(msg)


def _make_go2_adapter() -> Go2AdapterModule:
    adapter = object.__new__(Go2AdapterModule)
    adapter._go2_connection = None
    adapter._assist_vel_lock = __import__("threading").Lock()
    adapter._assist_vel_thread = None
    adapter._assist_vel_target = 0.0
    adapter.config = SimpleNamespace(robot_id="unitree_go2")
    adapter.goal_request = _FakeStream(connected=False)
    adapter.goal_req = _FakeStream(connected=False)
    adapter.clicked_point = _FakeStream(connected=False)
    adapter.stop_movement = _FakeStream(connected=False)
    adapter.cancel_goal_signal = _FakeStream(connected=False)
    adapter.cmd_vel = _FakeStream(connected=False)
    adapter.xr_lidar = _FakeStream(connected=True)
    adapter.xr_odom = _FakeStream(connected=True)
    adapter.xr_global_costmap = _FakeStream(connected=True)
    adapter.xr_path = _FakeStream(connected=True)
    adapter.xr_goal_reached = _FakeStream(connected=True)
    adapter.xr_navigation_state = _FakeStream(connected=True)
    adapter.xr_lidar_in = _FakeStream(connected=False)
    adapter.xr_odom_in = _FakeStream(connected=False)
    adapter.xr_global_costmap_in = _FakeStream(connected=False)
    adapter.xr_path_in = _FakeStream(connected=False)
    adapter.xr_goal_reached_in = _FakeStream(connected=False)
    adapter.xr_navigation_state_in = _FakeStream(connected=False)
    return adapter


def _make_g1_adapter() -> G1AdapterModule:
    adapter = object.__new__(G1AdapterModule)
    adapter._g1_connection = None
    adapter._g1_high_level = None
    adapter._assist_vel_lock = threading.Lock()
    adapter._assist_vel_thread = None
    adapter._assist_vel_target = 0.0
    adapter.config = SimpleNamespace(robot_id="unitree_g1")
    adapter.goal_request = _FakeStream(connected=False)
    adapter.goal_req = _FakeStream(connected=False)
    adapter.clicked_point = _FakeStream(connected=False)
    adapter.stop_movement = _FakeStream(connected=False)
    adapter.cancel_goal_signal = _FakeStream(connected=False)
    adapter.cmd_vel = _FakeStream(connected=False)
    adapter.xr_lidar = _FakeStream(connected=True)
    adapter.xr_odom = _FakeStream(connected=True)
    adapter.xr_global_costmap = _FakeStream(connected=True)
    adapter.xr_path = _FakeStream(connected=True)
    adapter.xr_goal_reached = _FakeStream(connected=True)
    adapter.xr_navigation_state = _FakeStream(connected=True)
    adapter.xr_lidar_in = _FakeStream(connected=False)
    adapter.xr_odom_in = _FakeStream(connected=False)
    adapter.xr_global_costmap_in = _FakeStream(connected=False)
    adapter.xr_path_in = _FakeStream(connected=False)
    adapter.xr_goal_reached_in = _FakeStream(connected=False)
    adapter.xr_navigation_state_in = _FakeStream(connected=False)
    return adapter


def test_go2_send_nav_goal_uses_goal_req_when_present() -> None:
    adapter = _make_go2_adapter()
    adapter.goal_req = _FakeStream(connected=True)
    goal = PoseStamped(position=[1.0, 2.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0], ts=1.0)

    assert Go2AdapterModule.send_nav_goal(adapter, goal) is True
    assert adapter.goal_req.published == [goal]


def test_go2_cancel_goal_uses_cancel_signal_when_present() -> None:
    adapter = _make_go2_adapter()
    adapter.cancel_goal_signal = _FakeStream(connected=True)

    assert Go2AdapterModule.cancel_goal(adapter) is True
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


def test_g1_cancel_goal_uses_stop_movement() -> None:
    adapter = _make_g1_adapter()
    adapter.stop_movement = _FakeStream(connected=True)

    assert G1AdapterModule.cancel_goal(adapter) is True
    stop = adapter.stop_movement.published[0]
    assert isinstance(stop, Bool)
    assert stop.data is True


def test_g1_capabilities_report_emergency_stop_unavailable_without_hw() -> None:
    adapter = _make_g1_adapter()

    capabilities = G1AdapterModule.capabilities(adapter)

    assert capabilities["emergency_stop"].available is False
    assert capabilities["align_assist"].available is False


def test_g1_robot_id_and_model() -> None:
    adapter = _make_g1_adapter()

    assert G1AdapterModule.robot_id(adapter) == "unitree_g1"
    assert G1AdapterModule.robot_model(adapter) == "unitree_g1"


def test_go2_assist_strafe_speed_matches_teleop() -> None:
    adapter = _make_go2_adapter()

    assert Go2AdapterModule.assist_strafe_speed(adapter) == 0.5


def test_g1_assist_motion_available_and_capability_follow_cmd_vel_transport() -> None:
    adapter = _make_g1_adapter()
    adapter.cmd_vel = _FakeStream(connected=True)

    assert G1AdapterModule.assist_motion_available(adapter) is True
    assert G1AdapterModule.assist_strafe_speed(adapter) == 0.3
    assert G1AdapterModule.capabilities(adapter)["align_assist"].available is True


def test_g1_assist_set_lateral_velocity_zero_publishes_stop_twist() -> None:
    adapter = _make_g1_adapter()
    adapter.cmd_vel = _FakeStream(connected=True)

    assert G1AdapterModule.assist_set_lateral_velocity(adapter, 0.0) is True
    assert len(adapter.cmd_vel.published) == 1
    twist = adapter.cmd_vel.published[0]
    assert isinstance(twist, Twist)
    assert twist.linear.y == 0.0
    assert twist.angular.z == 0.0


def test_go2_runtime_alignment_profile_defaults() -> None:
    adapter = _make_go2_adapter()
    profile = Go2AdapterModule.runtime_alignment_profile(adapter)
    assert profile.runtime_static_speed_mps == 0.05
    assert profile.runtime_speed_horizon_s == 0.4


def test_g1_runtime_alignment_profile_overrides() -> None:
    adapter = _make_g1_adapter()
    profile = G1AdapterModule.runtime_alignment_profile(adapter)
    assert profile.runtime_static_speed_mps == 0.08
    assert profile.runtime_speed_horizon_s == 0.9
