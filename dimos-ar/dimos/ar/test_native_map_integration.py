"""Native placement admission at the ARModule wiring boundary."""

import time
from unittest.mock import Mock

import numpy as np

from dimos.ar.localization.native import NativeMapSample
from dimos.ar.module import ARModule
from dimos.ar.robot.odometry import RobotOdometry
from dimos.ar.spatial import frozen_matrix
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def test_native_placement_waits_for_odometry_and_consumes_unchanged_fix() -> None:
    module = object.__new__(ARModule)
    module._odometry = RobotOdometry()
    module._requires_mapping_restart = False
    localization = Mock()
    localization.on_native_reference.return_value = False
    module._localization = localization
    sample = NativeMapSample(frozen_matrix(np.eye(4)), 10.0, "saved-map")

    assert module._accept_native_map(sample) is False
    localization.on_native_reference.assert_not_called()

    module._odometry.accept(PoseStamped(ts=time.time(), position=[0, 0, 0]))
    assert module._accept_native_map(sample) is True
    localization.on_native_reference.assert_called_once_with(
        sample.T_native_odom, ts_server=10.0, native_map_id="saved-map"
    )

    module._requires_mapping_restart = True
    assert module._accept_native_map(sample) is False
    assert localization.on_native_reference.call_count == 1
