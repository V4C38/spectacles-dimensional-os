from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from dimos.ar.tag_tracking.solve import TagMount, build_camera_info
import dimos.ar.tag_tracking.tracker as tracker_module
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker, RobotAprilTagTrackerConfig
from dimos.ar.world_frame.transforms import OdomSample


def _synthetic_camera_info(width: int = 800, height: int = 800) -> object:
    return build_camera_info(
        width=width,
        height=height,
        k=(600.0, 0.0, width / 2, 0.0, 600.0, height / 2, 0.0, 0.0, 1.0),
        d=(),
    )


def _make_tracker() -> RobotAprilTagTracker:
    tracker = RobotAprilTagTracker(
        [TagMount(tag_id=0)],
        config=RobotAprilTagTrackerConfig(
            max_reprojection_error_px=8.0,
            max_pair_skew_s=0.15,
        ),
    )
    tracker.set_camera_info(_synthetic_camera_info())
    tracker._detector = SimpleNamespace(  # type: ignore[attr-defined]
        detectMarkers=lambda _gray: (
            [np.array([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]], dtype=np.float32)],
            np.array([[0]], dtype=np.int32),
            None,
        )
    )
    return tracker


def test_process_frame_rejects_excessive_pair_skew(monkeypatch) -> None:
    tracker = _make_tracker()
    monkeypatch.setattr(
        tracker_module.cv2,
        "imdecode",
        lambda *_args, **_kwargs: np.zeros((8, 8), dtype=np.uint8),
    )
    monkeypatch.setattr(
        tracker_module,
        "estimate_marker_pose",
        lambda *_args, **_kwargs: (
            np.zeros((3, 1), dtype=np.float64),
            np.array([[0.0], [0.0], [1.0]], dtype=np.float64),
            1.8,
        ),
    )
    monkeypatch.setattr(tracker_module, "reprojection_error_px", lambda *_args, **_kwargs: 0.5)
    header = {
        "type": "camera_frame",
        "seq": 1,
        "ts": 1.0,
        "send_ts": 1.05,
        "cam_pos": [0.0, 0.0, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
        "capture_ts_robot": 1.4,
    }
    odom = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )

    result = tracker.process_frame(header, b"jpeg", odom=odom, receive_mono=2.0)

    assert result.tag_detected is False
    assert result.rejections_skew == 1
    assert result.observations_added == 0


def test_process_frame_records_new_observation_fields(monkeypatch) -> None:
    tracker = _make_tracker()
    monkeypatch.setattr(
        tracker_module.cv2,
        "imdecode",
        lambda *_args, **_kwargs: np.zeros((8, 8), dtype=np.uint8),
    )
    monkeypatch.setattr(
        tracker_module,
        "estimate_marker_pose",
        lambda *_args, **_kwargs: (
            np.zeros((3, 1), dtype=np.float64),
            np.array([[0.0], [0.0], [1.0]], dtype=np.float64),
            1.8,
        ),
    )
    monkeypatch.setattr(tracker_module, "reprojection_error_px", lambda *_args, **_kwargs: 0.5)
    header = {
        "type": "camera_frame",
        "seq": 1,
        "ts": 1.0,
        "send_ts": 1.05,
        "cam_pos": [0.0, 0.0, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
        "capture_ts_robot": 1.05,
    }
    odom = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )

    result = tracker.process_frame(header, b"jpeg", odom=odom, receive_mono=2.0)
    observations = tracker.recent_observations(max_age_s=10.0)

    assert result.tag_detected is True
    assert result.observations_added == 1
    assert len(observations) == 1
    assert observations[0].ambiguity_ratio == 1.8
    assert observations[0].pair_skew_s == pytest.approx(0.05)
    assert observations[0].capture_ts_robot == 1.05
