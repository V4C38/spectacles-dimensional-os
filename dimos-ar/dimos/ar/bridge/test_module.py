from __future__ import annotations

import pytest

from dimos.ar.bridge.module import _pose_stamped_from_odometry
from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.msgs.nav_msgs.Odometry import Odometry


def test_pose_stamped_from_odometry_preserves_twist_speed() -> None:
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

    pose = _pose_stamped_from_odometry(odom)

    assert pose.ts == 1.5
    assert pose.frame_id == "base_link"
    assert pose.x == 1.0
    assert pose.y == 2.0
    assert hasattr(pose, "vx") and pose.vx == 0.3  # type: ignore[attr-defined]
    assert hasattr(pose, "vy") and pose.vy == 0.4  # type: ignore[attr-defined]
    assert OdomBuffer().sample_from_msg(pose).measured_speed_mps == pytest.approx(0.5)
