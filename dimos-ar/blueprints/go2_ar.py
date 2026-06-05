
from dimos.core.global_config import global_config
from dimos_ar.bridge_status import set_bridge_status_tracker, tracker_from_bootstrap
from dimos_ar.robot_bootstrap import LiveRobot, bootstrap_for_blueprint

global_config.update(viewer="none")

_bootstrap = bootstrap_for_blueprint()
set_bridge_status_tracker(
    tracker_from_bootstrap(_bootstrap, robot_model="unitree_go2"),
)

from dimos.core.coordination.blueprints import autoconnect
from dimos.protocol.service.system_configurator.clock_sync import ClockSyncConfigurator
from dimos.robot.unitree.go2.blueprints.smart.unitree_go2 import unitree_go2

from dimos_ar.bridge_module import ARBridge

if isinstance(_bootstrap, LiveRobot):
    _robot_id = _bootstrap.serial
else:
    _robot_id = _bootstrap.robot_id

go2_ar = (
    autoconnect(
        unitree_go2,
        ARBridge.blueprint(robot_id=_robot_id),
    )
    .global_config(n_workers=9, robot_model="unitree_go2", viewer="none")
    .configurators(ClockSyncConfigurator())
)

if __name__ == "__main__":
    from dimos_ar.marker_server import start_marker_server

    start_marker_server()

    from dimos.core.coordination.module_coordinator import ModuleCoordinator

    ModuleCoordinator.build(go2_ar).loop()
