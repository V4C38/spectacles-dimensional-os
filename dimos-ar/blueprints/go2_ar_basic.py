# Robot discovery and global_config must run before DimOS blueprint imports.
# Env: ROBOT_SERIAL (optional), FORCE_REPLAY=1, DISCOVER_TIMEOUT, CI=1
import multiprocessing

from dimos_ar.bridge_status import set_bridge_status_tracker, tracker_from_bootstrap
from dimos_ar.robot_bootstrap import LiveRobot, bootstrap_for_blueprint

_bootstrap = bootstrap_for_blueprint()
set_bridge_status_tracker(
    tracker_from_bootstrap(_bootstrap, robot_model="unitree_go2"),
)

import platform

from dimos.constants import DEFAULT_CAPACITY_COLOR_IMAGE
from dimos.core.coordination.blueprints import autoconnect
from dimos.core.global_config import global_config
from dimos.core.transport import pSHMTransport
from dimos.msgs.sensor_msgs.Image import Image
from dimos.protocol.service.system_configurator.clock_sync import ClockSyncConfigurator

from dimos_ar.bridge_module import ARBridge
from dimos_ar.go2_connection import ARGO2Connection

global_config.update(viewer="none")

_mac_transports: dict[tuple[str, type], pSHMTransport[Image]] = {
    ("color_image", Image): pSHMTransport(
        "color_image", default_capacity=DEFAULT_CAPACITY_COLOR_IMAGE
    ),
}

_transports = (
    autoconnect() if platform.system() == "Linux" else autoconnect().transports(_mac_transports)
)

if isinstance(_bootstrap, LiveRobot):
    _robot_id = _bootstrap.serial
    _connection_bp = ARGO2Connection.blueprint(target_serial=_bootstrap.serial)
else:
    _robot_id = _bootstrap.robot_id
    _connection_bp = ARGO2Connection.blueprint()

go2_ar_basic = (
    autoconnect(
        _transports,
        _connection_bp,
        ARBridge.blueprint(robot_id=_robot_id),
    )
    .global_config(n_workers=4, robot_model="unitree_go2")
    .configurators(ClockSyncConfigurator())
)

if __name__ == "__main__":
    # Start marker web server + print QR code (main process only).
    from dimos_ar.marker_server import start_marker_server

    start_marker_server()

    from dimos.core.coordination.module_coordinator import ModuleCoordinator

    ModuleCoordinator.build(go2_ar_basic).loop()
