"""AR bridge blueprints — compositions only, no classes or logic.

ar_go2: Unitree Go2 smart stack + Go2RobotProfileModule + ARBridge
ar_g1:  Unitree G1 nav-onboard stack + G1RobotProfileModule + ARBridge

Stream-name reconciliation (the Go2/G1 stacks publish lidar under various names
depending on the pipeline) is done here via .remappings([...]).

To run (once registered upstream):
  dimos run ar-go2
  dimos run ar-g1
"""

from __future__ import annotations

from dimos.ar.bridge.module import ARBridge
from dimos.ar.robot_profile.g1 import G1RobotProfileModule
from dimos.ar.robot_profile.go2 import Go2RobotProfileModule
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

try:
    from dimos.visualization.rerun.bridge import RerunBridgeModule
    from dimos.visualization.rerun.websocket_server import RerunWebSocketServer
    from dimos.web.websocket_vis.websocket_vis_module import WebsocketVisModule
except ModuleNotFoundError:
    RerunBridgeModule = None
    RerunWebSocketServer = None
    WebsocketVisModule = None

_VIS_MODULES = tuple(
    module
    for module in (RerunBridgeModule, RerunWebSocketServer, WebsocketVisModule)
    if module is not None
)

ar_go2 = (
    autoconnect(
        unitree_go2,
        Go2RobotProfileModule.blueprint(),
        ARBridge.blueprint(),
    )
    .remappings(
        [
            # Go2 smart stack: lidar lives on "lidar" (VoxelGridMapper output)
            (ARBridge, "ar_lidar", "lidar"),
            # Go2 odom lives on "odom" (PoseStamped from basic stack)
            (ARBridge, "ar_odom", "odom"),
            # Global costmap from CostMapper
            (ARBridge, "ar_global_costmap", "global_costmap"),
            # Active navigation path
            (ARBridge, "ar_path", "path"),
            # Goal-reached signal
            (ARBridge, "ar_goal_reached", "goal_reached"),
            # Navigation state string
            (ARBridge, "ar_navigation_state", "navigation_state"),
            # Hot AR control path: bridge publishes directly to robot command streams.
            (ARBridge, "cmd_vel", "cmd_vel"),
            (ARBridge, "goal_request", "goal_request"),
            (ARBridge, "stop_movement", "stop_movement"),
        ]
    )
    .global_config(viewer="none")
    # viewer="none" alone does not remove upstream viz modules because those are
    # selected at import time; disable them explicitly for AR runs.
    .disabled_modules(*_VIS_MODULES)
    .configurators(ClockSyncConfigurator())
    if unitree_go2 is not None
    else None
)

ar_g1 = (
    autoconnect(
        unitree_g1_nav_onboard,
        G1RobotProfileModule.blueprint(),
        ARBridge.blueprint(),
    )
    .remappings(
        [
            # G1 nav-onboard: registered_scan from FastLio2
            (ARBridge, "ar_lidar", "registered_scan"),
            # G1 odom from FastLio2 Odometry (twist + production timestamp)
            (ARBridge, "ar_odometry", "odometry"),
            # Active navigation path
            (ARBridge, "ar_path", "path"),
            # Goal-reached signal
            (ARBridge, "ar_goal_reached", "goal_reached"),
            # Motion: cmu_nav SimplePlanner takes PointStamped goals.
            (ARBridge, "cmd_vel", "cmd_vel"),
            (ARBridge, "goal_point_request", "goal"),
            (ARBridge, "cancel_goal_signal", "cancel_goal"),
        ]
    )
    .global_config(viewer="none")
    # viewer="none" alone does not remove upstream viz modules because those are
    # selected at import time; disable them explicitly for AR runs.
    .disabled_modules(*_VIS_MODULES)
    .configurators(ClockSyncConfigurator())
    if unitree_g1_nav_onboard is not None
    else None
)
