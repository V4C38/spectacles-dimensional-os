from __future__ import annotations

import json

from dimos.ar.localization.reply import encode_odom_localization_reply
from dimos.ar.localization.types import LocalizedPose
from dimos.msgs.geometry_msgs.Pose import Pose


def test_encode_odom_localization_reply_applies_xy_correction() -> None:
    text = encode_odom_localization_reply(
        LocalizedPose(
            pose=Pose(1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0),
            frame_id="odom",
            confidence=0.8,
        ),
        odom_correction_factor=1.25,
        ts_server=100.0,
    )

    msg = json.loads(text.strip())
    assert msg["type"] == "localization"
    assert msg["position"] == [1.25, 2.5, 3.0]
    assert msg["confidence"] == 0.8
    assert msg["ts"] == 100.0


def test_encode_odom_localization_reply_rejects_non_odom_frame() -> None:
    try:
        encode_odom_localization_reply(
            LocalizedPose(
                pose=Pose(0.0, 0.0, 0.0),
                frame_id="map",
                confidence=1.0,
            ),
            odom_correction_factor=1.25,
            ts_server=1.0,
        )
    except ValueError as exc:
        assert "odom" in str(exc)
    else:
        raise AssertionError("expected ValueError")
