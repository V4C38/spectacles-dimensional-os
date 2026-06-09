from __future__ import annotations

from dimos.core.transport import pSHMTransport
from dimos.msgs.sensor_msgs.Image import Image

from blueprints.dimos_xr import _runtime_blueprint
from dimos_xr.bridge_module import XRBridge


def test_runtime_blueprint_routes_color_image_over_pshm() -> None:
    blueprint = _runtime_blueprint("unitree-go2-basic")

    transport = blueprint.transport_map[("color_image", Image)]
    assert isinstance(transport, pSHMTransport)
    assert transport.topic == "color_image"


def test_runtime_blueprint_remaps_bridge_video_to_color_image() -> None:
    blueprint = _runtime_blueprint("unitree-go2-basic")

    assert blueprint.remapping_map[(XRBridge, "xr_color_image")] == "color_image"


def test_runtime_blueprint_g1_keeps_cancel_goal_remapping() -> None:
    blueprint = _runtime_blueprint("unitree-g1")

    from dimos_xr.adapter_module import XRRobotAdapterModule

    assert blueprint.remapping_map[(XRBridge, "xr_color_image")] == "color_image"
    assert (
        blueprint.remapping_map[(XRRobotAdapterModule, "cancel_goal_signal")]
        == "cancel_goal"
    )
