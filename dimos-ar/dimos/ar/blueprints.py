from __future__ import annotations

from dimos.ar.module import ARModule
from dimos.ar.navigation.native_planner import ARReplanningAStarPlanner
from dimos.ar.robot.capabilities import blueprint_has_object_detection
from dimos.ar.robot.profiles.profile import RobotName
from dimos.core.coordination.blueprints import Blueprint, autoconnect
from dimos.navigation.go2.replanning_a_star.module import ReplanningAStarPlanner
from dimos.protocol.service.system_configurator.clock_sync import ClockSyncConfigurator

try:
    from dimos.robot.unitree.go2.blueprints.smart.unitree_go2 import unitree_go2
except ModuleNotFoundError:
    unitree_go2 = None

try:
    from dimos.robot.unitree.go2.blueprints.agentic.unitree_go2_agentic import (
        unitree_go2_agentic,
    )
except ModuleNotFoundError:
    unitree_go2_agentic = None


def _correlated_navigation(blueprint: Blueprint) -> Blueprint:
    original = next(
        item for item in blueprint.active_blueprints if item.module is ReplanningAStarPlanner
    )
    return autoconnect(
        blueprint.disabled_modules(ReplanningAStarPlanner),
        ARReplanningAStarPlanner.blueprint(**original.kwargs),
    )


# One worker per active module so ARModule is not GIL-starved by the sensor pipeline.
# Overrides upstream unitree_go2 n_workers=10.
_unitree_go2_ar_base = (
    autoconnect(
        _correlated_navigation(unitree_go2),
        ARModule.blueprint(
            robot=RobotName.UNITREE_GO2,
            object_detection=blueprint_has_object_detection(unitree_go2),
        ),
    )
    if unitree_go2 is not None
    else None
)

unitree_go2_ar = (
    _unitree_go2_ar_base.global_config(
        n_workers=len(_unitree_go2_ar_base.active_blueprints),
    ).configurators(ClockSyncConfigurator())
    if _unitree_go2_ar_base is not None
    else None
)

if unitree_go2_agentic is not None:
    from dimos.agents.mcp.mcp_client import McpClient
    from dimos.agents.skills.person_follow import PersonFollowSkillContainer
    from dimos.ar.robot.guarded_agent import ARGuardedMcpClient, ARPersonFollowSkillContainer

    _native_agent = next(
        item for item in unitree_go2_agentic.active_blueprints if item.module is McpClient
    )
    _native_following = next(
        item
        for item in unitree_go2_agentic.active_blueprints
        if item.module is PersonFollowSkillContainer
    )
    _guarded_agentic = autoconnect(
        unitree_go2_agentic.disabled_modules(McpClient, PersonFollowSkillContainer),
        ARGuardedMcpClient.blueprint(**_native_agent.kwargs),
        ARPersonFollowSkillContainer.blueprint(**_native_following.kwargs),
    )
else:
    _guarded_agentic = None

_unitree_go2_ar_agentic_base = (
    autoconnect(
        _correlated_navigation(_guarded_agentic),
        ARModule.blueprint(
            robot=RobotName.UNITREE_GO2,
            agent=True,
            object_detection=blueprint_has_object_detection(unitree_go2_agentic),
        ),
    )
    if _guarded_agentic is not None
    else None
)

unitree_go2_ar_agentic = (
    _unitree_go2_ar_agentic_base.global_config(
        n_workers=len(_unitree_go2_ar_agentic_base.active_blueprints),
    ).configurators(ClockSyncConfigurator())
    if _unitree_go2_ar_agentic_base is not None
    else None
)
