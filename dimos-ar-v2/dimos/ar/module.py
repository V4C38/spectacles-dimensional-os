from __future__ import annotations

from typing import ClassVar

from dimos_lcm.std_msgs import Bool, String
import websockets.asyncio.server as ws_server

from dimos.ar.network.protocol import (
    CapabilityWire,
    EstopMessage,
    GetStateMessage,
    HelloRobotWire,
    HelloWire,
    LidarData,
    LocalizeObservation,
    NavGoalMessage,
    StateNavWire,
    StateWire,
    encode_state,
)
from dimos.ar.network.server import WebSocketServer
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

_DEFAULT_LIDAR = LidarData(
    enabled=False,
    min_height_m=0.1,
    max_height_m=1.5,
    max_range_m=5.0,
)


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    port: int = 8787


class ARModule(Module):  # type: ignore[misc]
    dedicated_worker: ClassVar[bool] = True

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    path: In[Path]
    goal_reached: In[Bool]
    navigation_state: In[String]

    goal_request: Out[PoseStamped]
    stop_movement: Out[Bool]

    config: ARModuleConfig

    _ws_server: WebSocketServer
    _lidar: LidarData

    @rpc
    def build(self) -> None:
        super().build()
        assert self._loop is not None
        self._lidar = _DEFAULT_LIDAR
        self._ws_server = WebSocketServer(
            port=self.config.port,
            loop=self._loop,
            hello_supplier=self._hello_for_client,
            on_connect=self._on_client_connect,
            on_nav_goal=self._on_nav_goal,
            on_estop=self._on_estop,
            on_set_lidar=self._on_set_lidar,
            on_get_state=self._on_get_state,
            on_localize=self._on_localize,
            on_disconnect=self._on_client_disconnect,
        )
        logger.info("ARModule build complete")

    @rpc
    def start(self) -> None:
        super().start()
        self._ws_server.start()
        host = global_config.listen_host
        logger.info("ARModule started", websocket=f"ws://{host}:{self.config.port}")

    @rpc
    def stop(self) -> None:
        logger.info("ARModule stopping")
        ws_server_obj = getattr(self, "_ws_server", None)
        if ws_server_obj is not None:
            ws_server_obj.stop()
        super().stop()

    def _hello_for_client(self, client_id: str) -> HelloWire:
        return HelloWire(
            client_id=client_id,
            robot=HelloRobotWire(
                display_name="Unitree Go2",
                body_bounds_m=(0.70, 0.50, 0.55),
                footprint_m=(0.70, 0.50),
                base_height_m=0.33,
            ),
            requires_robot_in_view=False,
            capabilities={
                "lidar": CapabilityWire(available=True, reason=None),
                "navigation": CapabilityWire(available=True, reason=None),
                "estop": CapabilityWire(available=True, reason=None),
            },
        )

    def _state_wire(self) -> StateWire:
        return StateWire(
            connected_clients=self._ws_server.connection_count,
            lidar=self._lidar,
            nav=StateNavWire(state="idle", outcome=None, goal=None),
            alignment_stale=False,
        )

    def _broadcast_state(self) -> None:
        self._ws_server.schedule_broadcast_text(encode_state(self._state_wire()))

    def _on_client_connect(
        self,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        logger.info("AR client session ready", client_id=client_id)
        self._broadcast_state()

    def _on_client_disconnect(self, _websocket: ws_server.ServerConnection) -> None:
        self._broadcast_state()
        if self._ws_server.connection_count == 0:
            self._publish_stop()

    def _on_nav_goal(
        self,
        msg: NavGoalMessage,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        logger.info("nav_goal received", position=msg.position)

    def _on_estop(self, _msg: EstopMessage, _websocket: ws_server.ServerConnection) -> None:
        self._publish_stop()

    def _on_set_lidar(
        self,
        msg: LidarData,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        self._lidar = msg
        self._broadcast_state()

    def _on_get_state(
        self,
        _msg: GetStateMessage,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        self._broadcast_state()

    def _on_localize(
        self,
        observations: tuple[LocalizeObservation, ...],
        _websocket: ws_server.ServerConnection,
    ) -> None:
        logger.warning(
            "localize received but alignment is not configured",
            observation_count=len(observations),
        )

    def _publish_stop(self) -> None:
        if self.stop_movement.transport is None:
            return
        self.stop_movement.publish(Bool(True))

    async def handle_lidar(self, msg: PointCloud2) -> None:
        del msg

    async def handle_odom(self, msg: PoseStamped) -> None:
        del msg

    async def handle_path(self, msg: Path) -> None:
        del msg

    async def handle_goal_reached(self, msg: Bool) -> None:
        del msg

    async def handle_navigation_state(self, msg: String) -> None:
        del msg
