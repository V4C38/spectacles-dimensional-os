"""XR bridge blueprints — compositions only, no classes or logic.

xr_go2: Unitree Go2 smart stack + Go2AdapterModule + XRBridge
xr_g1:  Unitree G1 nav-onboard stack + G1AdapterModule + XRBridge

Stream-name reconciliation (the Go2/G1 stacks publish lidar under various names
depending on the pipeline; the adapter modules expose unified xr_* streams to
XRBridge) is done here via .remappings([...]).

To run (once registered upstream):
  dimos run xr-go2
  dimos run xr-g1
"""

from __future__ import annotations

from dimos.core.coordination.blueprints import autoconnect
from dimos.protocol.service.system_configurator.clock_sync import ClockSyncConfigurator
from dimos.robot.unitree.g1.blueprints.navigation.unitree_g1_nav_onboard import (
    unitree_g1_nav_onboard,
)
from dimos.robot.unitree.go2.blueprints.smart.unitree_go2 import unitree_go2

from dimos_xr.adapters.g1 import G1AdapterModule
from dimos_xr.adapters.go2 import Go2AdapterModule
from dimos_xr.xr_bridge_module import XRBridge

xr_go2 = (
    autoconnect(
        unitree_go2,
        Go2AdapterModule.blueprint(),
        XRBridge.blueprint(),
    )
    .remappings(
        [
            # Go2 smart stack: lidar lives on "lidar" (VoxelGridMapper output)
            (Go2AdapterModule, "xr_lidar_in", "lidar"),
            # Go2 odom lives on "odom" (PoseStamped from basic stack)
            (Go2AdapterModule, "xr_odom_in", "odom"),
            # Global costmap from CostMapper
            (Go2AdapterModule, "xr_global_costmap_in", "global_costmap"),
            # Active navigation path
            (Go2AdapterModule, "xr_path_in", "path"),
            # Goal-reached signal
            (Go2AdapterModule, "xr_goal_reached_in", "goal_reached"),
            # Navigation state string
            (Go2AdapterModule, "xr_navigation_state_in", "navigation_state"),
        ]
    )
    .global_config(viewer="none")
    .configurators(ClockSyncConfigurator())
)

xr_g1 = (
    autoconnect(
        unitree_g1_nav_onboard,
        G1AdapterModule.blueprint(),
        XRBridge.blueprint(),
    )
    .remappings(
        [
            # G1 nav-onboard: registered_scan from FastLio2
            (G1AdapterModule, "xr_lidar_in", "registered_scan"),
            # G1 odom via Odometry → PoseStamped conversion is done in adapter
            (G1AdapterModule, "xr_odom_in", "odom"),
            # Global costmap
            (G1AdapterModule, "xr_global_costmap_in", "global_costmap"),
            # Active navigation path
            (G1AdapterModule, "xr_path_in", "path"),
            # Goal-reached signal
            (G1AdapterModule, "xr_goal_reached_in", "goal_reached"),
            # Navigation state string
            (G1AdapterModule, "xr_navigation_state_in", "navigation_state"),
            # cancel_goal routed through the nav-onboard cancel interface
            (G1AdapterModule, "cancel_goal_signal", "cancel_goal"),
        ]
    )
    .global_config(viewer="none")
    .configurators(ClockSyncConfigurator())
)
