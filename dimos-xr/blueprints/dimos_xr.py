from __future__ import annotations

import importlib
import os
from typing import Any

from dimos.constants import DEFAULT_CAPACITY_COLOR_IMAGE
from dimos.core.coordination.blueprints import autoconnect
from dimos.core.transport import pSHMTransport
from dimos.msgs.sensor_msgs.Image import Image
from dimos.protocol.service.system_configurator.clock_sync import ClockSyncConfigurator

from dimos_xr.adapter_module import XRRobotAdapterModule
from dimos_xr.blueprints import dimos_xr
from dimos_xr.bridge_module import XRBridge

STACKS = {
    "unitree-go2": (
        "dimos.robot.unitree.go2.blueprints.smart.unitree_go2",
        "unitree_go2",
    ),
    "unitree-go2-basic": (
        "dimos.robot.unitree.go2.blueprints.basic.unitree_go2_basic",
        "unitree_go2_basic",
    ),
    "unitree-g1-nav-onboard": (
        "dimos.robot.unitree.g1.blueprints.navigation.unitree_g1_nav_onboard",
        "unitree_g1_nav_onboard",
    ),
    "unitree-g1": (
        "dimos.robot.unitree.g1.blueprints.perceptive.unitree_g1",
        "unitree_g1",
    ),
}


def _load_stack_blueprint(stack_name: str) -> Any:
    target = STACKS.get(stack_name)
    if target is None:
        raise SystemExit(
            f"Unknown DIMOS_XR_STACK {stack_name!r}. "
            f"Expected one of: {', '.join(sorted(STACKS))}"
        )
    module_name, blueprint_name = target
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        if stack_name == "unitree-g1-nav-onboard" and exc.name == "unitree_sdk2py":
            raise SystemExit(
                "DIMOS_XR_STACK='unitree-g1-nav-onboard' requires the "
                "'unitree_sdk2py' dependency in the DimOS .venv. "
                "Install the G1 onboard navigation runtime dependencies and retry."
            ) from exc
        raise
    return getattr(module, blueprint_name)


def _runtime_blueprint(stack_name: str | None = None) -> Any:
    selected_stack_name = stack_name or os.environ.get("DIMOS_XR_STACK", "unitree-go2")
    selected_stack = _load_stack_blueprint(selected_stack_name)
    blueprint = (
        autoconnect(
            selected_stack,
            dimos_xr,
        )
        .transports(
            {
                ("color_image", Image): pSHMTransport(
                    "color_image",
                    default_capacity=DEFAULT_CAPACITY_COLOR_IMAGE,
                ),
            }
        )
        .remappings(
            [
                (XRBridge, "xr_color_image", "color_image"),
            ]
        )
        .global_config(viewer="none")
        .configurators(ClockSyncConfigurator())
    )
    if selected_stack_name == "unitree-g1":
        blueprint = blueprint.remappings(
            [
                (XRRobotAdapterModule, "cancel_goal_signal", "cancel_goal"),
            ]
        )
    return blueprint


if __name__ == "__main__":
    from dimos.core.coordination.module_coordinator import ModuleCoordinator

    from dimos_xr.marker_server import start_marker_server

    start_marker_server()
    ModuleCoordinator.build(_runtime_blueprint()).loop()
