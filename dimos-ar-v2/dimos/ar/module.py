from __future__ import annotations

from typing import ClassVar

from dimos_lcm.std_msgs import Bool
import websockets.asyncio.server as ws_server

from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.navigation.nav_goals import NavGoalCoordinator
from dimos.ar.robot.go2 import GO2_PROFILE
from dimos.ar.robot.state_publisher import RobotStatePublisher
from dimos.ar.websocket.protocol import (
    DEFAULT_LIDAR_SETTINGS,
    Capability,
    EstopRequest,
    HelloBody,
    LidarSettings,
    LocalizeObservation,
    NavGoalRequest,
    RobotDescription,
    StateRequest,
    StateSnapshot,
    TimeSync,
    encode_nav_goal,
    encode_state,
)
from dimos.ar.websocket.server import WebSocketServer
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    port: int = 8787


class ARModule(Module):  # type: ignore[misc]
    dedicated_worker: ClassVar[bool] = True

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    path: In[Path]
    goal_reached: In[Bool]

    goal_request: Out[PoseStamped]
    stop_movement: Out[Bool]

    config: ARModuleConfig

    _ws_server: WebSocketServer
    _state_publisher: RobotStatePublisher
    _nav_goal_coordinator: NavGoalCoordinator
    _pose_buffer: PoseBuffer
    _lidar: LidarSettings

    @rpc
    def build(self) -> None:
        super().build()
        assert self._loop is not None
        self._lidar = DEFAULT_LIDAR_SETTINGS
        self._ws_server = WebSocketServer(
            port=self.config.port,
            loop=self._loop,
            hello_supplier=self._hello_body,
            on_connect=self._on_client_connect,
            on_nav_goal_request=self._on_nav_goal_request,
            on_estop_request=self._on_estop_request,
            on_lidar_settings_request=self._on_lidar_settings_request,
            on_state_request=self._on_state_request,
            on_localization_request=self._on_localization_request,
            on_disconnect=self._on_client_disconnect,
        )
        self._nav_goal_coordinator = NavGoalCoordinator(
            odom_correction_factor=GO2_PROFILE.odom_correction_factor,
        )
        self._state_publisher = RobotStatePublisher(
            self._ws_server,
            odom_correction_factor=GO2_PROFILE.odom_correction_factor,
        )
        self._pose_buffer = PoseBuffer()
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

    def _hello_body(self, _client_id: str) -> HelloBody:
        return HelloBody(
            robot=RobotDescription(
                display_name=GO2_PROFILE.display_name,
                body_bounds_m=GO2_PROFILE.body_bounds_m,
                footprint_m=GO2_PROFILE.footprint_m,
                base_height_m=GO2_PROFILE.base_height_m,
            ),
            requires_robot_in_view=False,
            capabilities={
                "lidar": Capability(available=True, reason=None),
                "navigation": Capability(available=True, reason=None),
                "estop": Capability(available=True, reason=None),
            },
        )

    def _state_snapshot(self) -> StateSnapshot:
        return StateSnapshot(
            connected_clients=self._ws_server.connection_count,
            lidar=self._lidar,
            nav=self._nav_goal_coordinator.nav_state(),
            alignment_stale=False,
        )

    def _broadcast_state(self) -> None:
        self._ws_server.schedule_broadcast_text(encode_state(self._state_snapshot()))

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

    def _on_nav_goal_request(
        self,
        msg: NavGoalRequest,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        goal = self._nav_goal_coordinator.submit_goal(msg)
        if self.goal_request.transport is None:
            logger.warning("nav_goal_request ignored — goal_request transport is not wired")
            return
        self.goal_request.publish(goal)
        logger.info("nav_goal_request published", client_id=client_id, position=msg.position)
        self._broadcast_state()

    def _on_estop_request(self, _msg: EstopRequest, _websocket: ws_server.ServerConnection) -> None:
        if self._nav_goal_coordinator.on_estop():
            self._broadcast_state()
        self._publish_stop()

    def _on_lidar_settings_request(
        self,
        msg: LidarSettings,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        self._lidar = msg
        self._broadcast_state()

    def _on_state_request(
        self,
        _msg: StateRequest,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        self._broadcast_state()

    def _on_localization_request(
        self,
        observations: tuple[LocalizeObservation, ...],
        _websocket: ws_server.ServerConnection,
        _time_sync: TimeSync,
    ) -> None:
        logger.warning(
            "localization_request received but alignment is not configured",
            observation_count=len(observations),
        )

    def _publish_stop(self) -> None:
        if self.stop_movement.transport is None:
            return
        self.stop_movement.publish(Bool(True))

    async def handle_lidar(self, msg: PointCloud2) -> None:
        self._state_publisher.publish_lidar(msg, lidar=self._lidar)

    async def handle_odom(self, msg: PoseStamped) -> None:
        self._pose_buffer.push(msg)
        self._state_publisher.publish_odom(msg)

    async def handle_path(self, msg: Path) -> None:
        nav_goal_frame, state_changed = self._nav_goal_coordinator.on_path(msg)
        self._ws_server.schedule_broadcast_text(encode_nav_goal(nav_goal_frame))
        if state_changed:
            self._broadcast_state()

    async def handle_goal_reached(self, msg: Bool) -> None:
        self._nav_goal_coordinator.on_goal_reached(msg)
        self._broadcast_state()
