from __future__ import annotations

from dimos.ar.module import ARModule
from dimos.ar.robot.capabilities import blueprint_has_object_detection
from dimos.ar.robot.profiles.profile import RobotName
from dimos.core.coordination.blueprints import autoconnect
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

# One worker per active module so ARModule is not GIL-starved by the sensor pipeline.
# Overrides upstream unitree_go2 n_workers=10.
_unitree_go2_ar_base = (
    autoconnect(
        unitree_go2,
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

_unitree_go2_ar_agentic_base = (
    autoconnect(
        unitree_go2_agentic,
        ARModule.blueprint(
            robot=RobotName.UNITREE_GO2,
            agent=True,
            object_detection=blueprint_has_object_detection(unitree_go2_agentic),
        ),
    )
    if unitree_go2_agentic is not None
    else None
)

unitree_go2_ar_agentic = (
    _unitree_go2_ar_agentic_base.global_config(
        n_workers=len(_unitree_go2_ar_agentic_base.active_blueprints),
    ).configurators(ClockSyncConfigurator())
    if _unitree_go2_ar_agentic_base is not None
    else None
)
