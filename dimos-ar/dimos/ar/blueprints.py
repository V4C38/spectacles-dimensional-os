"""AR bridge blueprints — compositions only, no classes or logic.

ar_go2: Unitree Go2 smart stack + lightweight agent runtime + ARBridge
ar_g1:  Unitree G1 nav-simple stack + lightweight agent runtime + ARBridge

Full-agentic placeholders (ar_go2_full_agentic / ar_g1_full_agentic) fail clearly
until spatial memory / object detection stacks are composed.

Stream-name reconciliation (the Go2/G1 stacks publish lidar under various names
depending on the pipeline) is done here via .remappings([...]).

To run (once registered upstream):
  dimos run ar-go2
  dimos run ar-g1
"""

from __future__ import annotations

from typing import Any

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
    from dimos.robot.unitree.g1.blueprints.navigation.unitree_g1_nav_simple import (
        unitree_g1_nav_simple,
    )
except ModuleNotFoundError:
    unitree_g1_nav_simple = None

try:
    from dimos.agents.mcp.mcp_client import McpClient
    from dimos.agents.mcp.mcp_server import McpServer
    from dimos.ar.agent.skills import AR_AGENT_SYSTEM_PROMPT, ArNavigationSkillContainer

    _AGENT_MODULES: tuple[Any, ...] = (
        McpServer.blueprint(),
        McpClient.blueprint(system_prompt=AR_AGENT_SYSTEM_PROMPT),
        ArNavigationSkillContainer.blueprint(),
    )
except ModuleNotFoundError:
    _AGENT_MODULES = ()

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
        *_AGENT_MODULES,
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
        unitree_g1_nav_simple,
        G1RobotProfileModule.blueprint(),
        ARBridge.blueprint(),
        *_AGENT_MODULES,
    )
    .remappings(
        [
            # G1 nav-simple: lidar from onboard FastLio2
            (ARBridge, "ar_lidar", "lidar"),
            # G1 odom from FastLio2 Odometry (twist + production timestamp)
            (ARBridge, "ar_odometry", "odometry"),
            # Global costmap from CostMapper
            (ARBridge, "ar_global_costmap", "global_costmap"),
            # Active navigation path
            (ARBridge, "ar_path", "path"),
            # Goal-reached signal
            (ARBridge, "ar_goal_reached", "goal_reached"),
            # Navigation state string
            (ARBridge, "ar_navigation_state", "navigation_state"),
            # Hot AR control path: pose goals via ReplanningAStarPlanner
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
    if unitree_g1_nav_simple is not None
    else None
)

# Full-agentic placeholders — intended future composition:
# spatial memory, object detection, DimOS NavigationSkillContainer, etc.
# Invariant: all future navigation tools must submit through NavigateGoalHandler
# (via ARBridge.submit_relative_goal / cancel_navigation), never publish planner
# streams in parallel.


def __getattr__(name: str) -> Any:
    if name == "ar_go2_full_agentic":
        raise NotImplementedError(
            "ar_go2_full_agentic is not implemented yet — use ar_go2"
        )
    if name == "ar_g1_full_agentic":
        raise NotImplementedError(
            "ar_g1_full_agentic is not implemented yet — use ar_g1"
        )
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
