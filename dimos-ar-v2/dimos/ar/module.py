from __future__ import annotations

import asyncio
from typing import ClassVar, Literal

from dimos_lcm.std_msgs import Bool
from pydantic import BaseModel, Field
import websockets.asyncio.server as ws_server

from dimos.ar.localization.fiducial_marker.localizer import FiducialMarkerLocalizer
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.reply import encode_odom_localization_reply
from dimos.ar.localization.types import LocalizedPose, Localizer, Observation
from dimos.ar.navigation.nav_goals import NavGoalCoordinator
from dimos.ar.robot.go2 import (
    GO2_FIDUCIAL_DICTIONARY,
    GO2_FIDUCIAL_MARKER_MOUNTS,
    GO2_PROFILE,
)
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
    observation_from_localize,
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


class AlignmentProviderConfig(BaseModel):
    type: Literal["fiducial_marker", "vps"]


class AlignmentConfig(BaseModel):
    providers: list[AlignmentProviderConfig] = Field(default_factory=list)


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    port: int = 8787
    alignment: AlignmentConfig = Field(default_factory=AlignmentConfig)


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
    _localizers: list[Localizer]
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
        self._localizers = self._build_localizers()
        logger.info("ARModule build complete")

    def _build_localizers(self) -> list[Localizer]:
        localizers: list[Localizer] = []
        for provider in self.config.alignment.providers:
            if provider.type == "fiducial_marker":
                localizers.append(
                    FiducialMarkerLocalizer(
                        pose_buffer=self._pose_buffer,
                        marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
                        dictionary_name=GO2_FIDUCIAL_DICTIONARY,
                    )
                )
            elif provider.type == "vps":
                logger.warning("VPS alignment provider is configured but not wired yet")
        return localizers

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

    async def _on_localization_request(
        self,
        observations: tuple[LocalizeObservation, ...],
        websocket: ws_server.ServerConnection,
        time_sync: TimeSync,
    ) -> None:
        if not self._localizers:
            logger.warning(
                "localization_request received but alignment is not configured",
                observation_count=len(observations),
            )
            return

        domain_observations = self._observations_from_wire(observations, time_sync=time_sync)
        ts_server = max(observation.ts_server for observation in domain_observations)

        localized = await self._localize(domain_observations)
        if localized is None:
            return
        if localized.frame_id != "odom":
            logger.warning(
                "localization result is not in odom and OdomMap wiring is not implemented",
                frame_id=localized.frame_id,
            )
            return

        self._ws_server.schedule_send_to(
            websocket,
            encode_odom_localization_reply(
                localized,
                odom_correction_factor=GO2_PROFILE.odom_correction_factor,
                ts_server=ts_server,
            ),
        )

    def _observations_from_wire(
        self,
        observations: tuple[LocalizeObservation, ...],
        *,
        time_sync: TimeSync,
    ) -> list[Observation]:
        return [
            observation_from_localize(observation, time_sync=time_sync)
            for observation in observations
        ]

    async def _localize(self, observations: list[Observation]) -> LocalizedPose | None:
        for localizer in self._localizers:
            result = await asyncio.to_thread(localizer.localize, observations)
            if result is not None:
                return result
        return None

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
