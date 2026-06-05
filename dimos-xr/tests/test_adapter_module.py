from __future__ import annotations

import asyncio
from types import SimpleNamespace

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Odometry import Odometry
from dimos_lcm.std_msgs import Bool

from dimos_xr.adapter_module import XRRobotAdapterModule


class _FakeStream:
    def __init__(self, *, connected: bool) -> None:
        self.transport = object() if connected else None
        self.published: list[object] = []

    def publish(self, msg: object) -> None:
        self.published.append(msg)


def _make_adapter() -> XRRobotAdapterModule:
    adapter = object.__new__(XRRobotAdapterModule)
    adapter._navigation = None
    adapter._go2_connection = None
    adapter._g1_connection = None
    adapter._g1_high_level = None
    adapter.config = SimpleNamespace(robot_id="robot", robot_model_override=None)
    adapter.goal_request = _FakeStream(connected=False)
    adapter.goal_req = _FakeStream(connected=False)
    adapter.clicked_point = _FakeStream(connected=False)
    adapter.stop_movement = _FakeStream(connected=False)
    adapter.cancel_goal_signal = _FakeStream(connected=False)
    adapter.xr_odom = _FakeStream(connected=True)
    adapter.path = _FakeStream(connected=False)
    adapter.path_active = _FakeStream(connected=False)
    adapter.lidar = _FakeStream(connected=False)
    adapter.pointcloud = _FakeStream(connected=False)
    adapter.registered_scan = _FakeStream(connected=False)
    adapter.odom = _FakeStream(connected=False)
    adapter.odometry = _FakeStream(connected=False)
    adapter.color_image = _FakeStream(connected=False)
    adapter.camera_info = _FakeStream(connected=False)
    return adapter


def test_send_nav_goal_uses_goal_req_when_present() -> None:
    adapter = _make_adapter()
    adapter.goal_req = _FakeStream(connected=True)

    goal = PoseStamped(
        position=[1.0, 2.0, 0.0],
        orientation=[0.0, 0.0, 0.0, 1.0],
        ts=1.0,
        frame_id="odom",
    )

    assert XRRobotAdapterModule.send_nav_goal(adapter, goal) is True
    assert adapter.goal_req.published == [goal]


def test_cancel_goal_uses_legacy_cancel_signal_when_present() -> None:
    adapter = _make_adapter()
    adapter.cancel_goal_signal = _FakeStream(connected=True)

    assert XRRobotAdapterModule.cancel_goal(adapter) is True
    assert len(adapter.cancel_goal_signal.published) == 1
    cancel = adapter.cancel_goal_signal.published[0]
    assert isinstance(cancel, Bool)
    assert cancel.data is True


def test_handle_odometry_converts_to_pose_stamped() -> None:
    adapter = _make_adapter()
    odom = Odometry(ts=2.0, frame_id="odom")
    odom.pose.position.x = 1.25
    odom.pose.position.y = -0.5
    odom.pose.position.z = 0.75
    odom.pose.orientation.x = 0.0
    odom.pose.orientation.y = 0.0
    odom.pose.orientation.z = 0.2
    odom.pose.orientation.w = 0.98

    asyncio.run(XRRobotAdapterModule.handle_odometry(adapter, odom))

    assert len(adapter.xr_odom.published) == 1
    pose = adapter.xr_odom.published[0]
    assert isinstance(pose, PoseStamped)
    assert (pose.x, pose.y, pose.z) == (1.25, -0.5, 0.75)
    assert (
        pose.orientation.x,
        pose.orientation.y,
        pose.orientation.z,
        pose.orientation.w,
    ) == (0.0, 0.0, 0.2, 0.98)
    assert pose.frame_id == "odom"
