"""AR bridge blueprints — compositions only, no classes or logic.

ar_go2: Unitree Go2 smart stack + Go2AdapterModule + ARBridge
ar_g1:  Unitree G1 nav-onboard stack + G1AdapterModule + ARBridge

Stream-name reconciliation (the Go2/G1 stacks publish lidar under various names
depending on the pipeline; the adapter modules expose unified ar_* streams to
ARBridge) is done here via .remappings([...]).

To run (once registered upstream):
  dimos run ar-go2
  dimos run ar-g1
"""

from __future__ import annotations

from dimos.ar.adapters.g1 import G1AdapterModule
from dimos.ar.adapters.go2 import Go2AdapterModule
from dimos.ar.bridge.module import ARBridge
from dimos.core.coordination.blueprints import autoconnect
from dimos.protocol.service.system_configurator.clock_sync import ClockSyncConfigurator

try:
    from dimos.robot.unitree.go2.blueprints.smart.unitree_go2 import unitree_go2
except ModuleNotFoundError:
    unitree_go2 = None

try:
    from dimos.robot.unitree.g1.blueprints.navigation.unitree_g1_nav_onboard import (
        unitree_g1_nav_onboard,
    )
except ModuleNotFoundError:
    unitree_g1_nav_onboard = None

ar_go2 = (
    autoconnect(
        unitree_go2,
        Go2AdapterModule.blueprint(),
        ARBridge.blueprint(),
    )
    .remappings(
        [
            # Go2 smart stack: lidar lives on "lidar" (VoxelGridMapper output)
            (Go2AdapterModule, "ar_lidar_in", "lidar"),
            # Go2 odom lives on "odom" (PoseStamped from basic stack)
            (Go2AdapterModule, "ar_odom_in", "odom"),
            # Global costmap from CostMapper
            (Go2AdapterModule, "ar_global_costmap_in", "global_costmap"),
            # Active navigation path
            (Go2AdapterModule, "ar_path_in", "path"),
            # Goal-reached signal
            (Go2AdapterModule, "ar_goal_reached_in", "goal_reached"),
            # Navigation state string
            (Go2AdapterModule, "ar_navigation_state_in", "navigation_state"),
        ]
    )
    .global_config(viewer="none")
    .configurators(ClockSyncConfigurator())
    if unitree_go2 is not None
    else None
)

ar_g1 = (
    autoconnect(
        unitree_g1_nav_onboard,
        G1AdapterModule.blueprint(),
        ARBridge.blueprint(),
    )
    .remappings(
        [
            # G1 nav-onboard: registered_scan from FastLio2
            (G1AdapterModule, "ar_lidar_in", "registered_scan"),
            # G1 odom from FastLio2 Odometry (twist + production timestamp)
            (G1AdapterModule, "ar_odom_in", "odometry"),
            # Global costmap
            (G1AdapterModule, "ar_global_costmap_in", "global_costmap"),
            # Active navigation path
            (G1AdapterModule, "ar_path_in", "path"),
            # Goal-reached signal
            (G1AdapterModule, "ar_goal_reached_in", "goal_reached"),
            # Navigation state string
            (G1AdapterModule, "ar_navigation_state_in", "navigation_state"),
            # cancel_goal routed through the nav-onboard cancel interface
            (G1AdapterModule, "cancel_goal_signal", "cancel_goal"),
        ]
    )
    .global_config(viewer="none")
    .configurators(ClockSyncConfigurator())
    if unitree_g1_nav_onboard is not None
    else None
)
