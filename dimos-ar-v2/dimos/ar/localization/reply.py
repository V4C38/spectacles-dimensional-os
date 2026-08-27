from __future__ import annotations

from dimos.ar.localization.types import LocalizedPose
from dimos.ar.robot.odom_correction import correct_odom_xy
from dimos.ar.websocket.protocol import encode_localization


def encode_odom_localization_reply(
    localized: LocalizedPose,
    *,
    odom_correction_factor: float,
    ts_server: float,
) -> str:
    if localized.frame_id != "odom":
        raise ValueError(
            f"encode_odom_localization_reply expects frame_id='odom', got {localized.frame_id!r}"
        )
    x, y = correct_odom_xy(
        localized.pose.x,
        localized.pose.y,
        factor=odom_correction_factor,
    )
    return encode_localization(
        position=(x, y, localized.pose.z),
        orientation=(
            localized.pose.orientation.x,
            localized.pose.orientation.y,
            localized.pose.orientation.z,
            localized.pose.orientation.w,
        ),
        confidence=localized.confidence,
        ts_server=ts_server,
    )
