from __future__ import annotations

import asyncio
import math
import time
from typing import ClassVar, Literal

from dimos_lcm.std_msgs import Bool
from pydantic import BaseModel, Field
import websockets.asyncio.server as ws_server

from dimos.ar.localization.coordinator import LocalizationCoordinator, LocalizationOutcome
from dimos.ar.localization.fiducial_marker.localizer import FiducialMarkerLocalizer
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.policy import EpisodeWork, LocalizationPolicy
from dimos.ar.localization.robot_pose_buffer import RobotPoseBuffer
from dimos.ar.localization.types import Localizer
from dimos.ar.localization.vps.localizer import VpsLocalizer
from dimos.ar.localization.vps.multiset_client import MultisetVpsClient, MultisetVpsClientConfig
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.navigation.nav_goals import NavGoalCoordinator
from dimos.ar.robot.go2 import (
    GO2_FIDUCIAL_DICTIONARY,
    GO2_FIDUCIAL_MARKER_MOUNTS,
    GO2_PROFILE,
    GO2_T_BASE_CAMERA_OPTICAL,
)
from dimos.ar.robot.odom_correction import correct_odom_xy
from dimos.ar.robot.state_publisher import RobotStatePublisher
from dimos.ar.websocket.protocol import (
    DEFAULT_LIDAR_SETTINGS,
    Capability,
    CapabilityName,
    EstopRequest,
    HelloBody,
    LidarSettings,
    LidarSettingsRequest,
    LocalizationObservation,
    LocalizationObservationsRequest,
    LocalizationStartRequest,
    NavGoalRequest,
    RobotDescription,
    StateRequest,
    StateSnapshot,
    TimeSync,
    encode_localization_observations_request,
    encode_nav_goal,
    encode_state,
    observation_from_localization,
)
from dimos.ar.websocket.server import WebSocketServer
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class LocalizationProviderConfig(BaseModel):
    type: Literal["fiducial_marker", "vps"]
    map_code: str | None = None


class LocalizationConfig(BaseModel):
    providers: list[LocalizationProviderConfig] = Field(default_factory=list)


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    port: int = 8787
    localization: LocalizationConfig = Field(default_factory=LocalizationConfig)


class ARModule(Module):  # type: ignore[misc]
    dedicated_worker: ClassVar[bool] = True

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    path: In[Path]
    goal_reached: In[Bool]
    color_image: In[Image]
    camera_info: In[CameraInfo]

    goal_request: Out[PoseStamped]
    stop_movement: Out[Bool]

    config: ARModuleConfig

    _ws_server: WebSocketServer
    _state_publisher: RobotStatePublisher
    _nav_goal_coordinator: NavGoalCoordinator
    _robot_pose_buffer: RobotPoseBuffer
    _policy: LocalizationPolicy
    _coordinator: LocalizationCoordinator
    _robot_observations: RobotObservationBuffer
    _lidar: LidarSettings
    _speed_mps: float

    @rpc
    def build(self) -> None:
        super().build()
        assert self._loop is not None
        self._lidar = DEFAULT_LIDAR_SETTINGS
        self._speed_mps = 0.0
        self._last_corrected_xy: tuple[float, float, float] | None = None
        self._episode_tasks: set[asyncio.Task[None]] = set()
        self._ws_server = WebSocketServer(
            port=self.config.port,
            loop=self._loop,
            hello_supplier=self._hello_body,
            on_connect=self._on_client_connect,
            on_nav_goal_request=self._on_nav_goal_request,
            on_estop_request=self._on_estop_request,
            on_lidar_settings_request=self._on_lidar_settings_request,
            on_state_request=self._on_state_request,
            on_localization_start_request=self._on_localization_start_request,
            on_localization_observations=self._on_localization_observations,
            on_disconnect=self._on_client_disconnect,
        )
        self._nav_goal_coordinator = NavGoalCoordinator(
            odom_correction_factor=GO2_PROFILE.odom_correction_factor,
        )
        self._state_publisher = RobotStatePublisher(
            self._ws_server,
            odom_correction_factor=GO2_PROFILE.odom_correction_factor,
        )
        self._robot_pose_buffer = RobotPoseBuffer()
        self._policy = LocalizationPolicy(
            [provider.type for provider in self.config.localization.providers]
        )
        self._robot_observations = RobotObservationBuffer(
            robot_pose_buffer=self._robot_pose_buffer,
            T_base_camopt=GO2_T_BASE_CAMERA_OPTICAL,
        )
        marker, vps, map_code = self._build_localizers()
        self._coordinator = LocalizationCoordinator(
            policy=self._policy,
            odom_map_transform=OdomMapTransform(),
            robot_buffer=self._robot_observations,
            marker=marker,
            vps=vps,
            odom_correction_factor=GO2_PROFILE.odom_correction_factor,
            map_code=map_code,
        )
        logger.info("ARModule build complete")

    def _build_localizers(self) -> tuple[Localizer | None, Localizer | None, str | None]:
        marker: Localizer | None = None
        vps: Localizer | None = None
        map_code: str | None = None
        for provider in self.config.localization.providers:
            if provider.type == "fiducial_marker" and marker is None:
                marker = FiducialMarkerLocalizer(
                    robot_pose_buffer=self._robot_pose_buffer,
                    marker_mounts=GO2_FIDUCIAL_MARKER_MOUNTS,
                    dictionary_name=GO2_FIDUCIAL_DICTIONARY,
                )
            elif provider.type == "vps" and vps is None:
                if not provider.map_code:
                    raise ValueError("VPS localization provider requires map_code")
                map_code = provider.map_code
                vps = VpsLocalizer(
                    client=MultisetVpsClient.from_env(
                        MultisetVpsClientConfig(map_code=provider.map_code)
                    )
                )
        return marker, vps, map_code

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
        localization_available = bool(self._policy.providers)
        return HelloBody(
            robot=RobotDescription(
                display_name=GO2_PROFILE.display_name,
                body_bounds_m=GO2_PROFILE.body_bounds_m,
                footprint_m=GO2_PROFILE.footprint_m,
                base_height_m=GO2_PROFILE.base_height_m,
            ),
            capabilities={
                CapabilityName.LIDAR: Capability(available=True, reason=None),
                CapabilityName.NAVIGATION: Capability(available=True, reason=None),
                CapabilityName.LOCALIZATION: Capability(
                    available=localization_available,
                    reason=None if localization_available else "no localization provider configured",
                ),
                CapabilityName.ESTOP: Capability(available=True, reason=None),
            },
        )

    def _state_snapshot(self) -> StateSnapshot:
        return StateSnapshot(
            connected_clients=self._ws_server.connection_count,
            lidar=self._lidar,
            nav=self._nav_goal_coordinator.nav_state(),
        )

    def _broadcast_state(self) -> None:
        self._ws_server.schedule_broadcast_text(encode_state(self._state_snapshot()))

    def _send_observations_request(self, client_id: str) -> None:
        spec = self._policy.capture_spec
        if spec is None:
            return
        self._ws_server.schedule_send_to_client(
            client_id,
            encode_localization_observations_request(
                LocalizationObservationsRequest(
                    capture_policy=spec.capture_policy,
                    observation_count=spec.observation_count,
                    wait_timeout_s=spec.wait_timeout_s,
                )
            ),
        )

    def _flush_localization(
        self,
        client_ids: list[str],
        episodes: list[EpisodeWork],
    ) -> None:
        for client_id in client_ids:
            self._send_observations_request(client_id)
        for work in episodes:
            task = asyncio.create_task(self._run_episode(work))
            self._episode_tasks.add(task)
            task.add_done_callback(self._episode_tasks.discard)

    def _on_client_connect(
        self,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        logger.info("AR client session ready", client_id=client_id)
        self._broadcast_state()
        requested_client_id = self._policy.on_hello(client_id)
        if requested_client_id is not None:
            self._send_observations_request(requested_client_id)

    def _on_client_disconnect(
        self, _websocket: ws_server.ServerConnection, client_id: str
    ) -> None:
        self._policy.on_disconnect(client_id)
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
        msg: LidarSettingsRequest,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        self._lidar = LidarSettings(
            enabled=msg.enabled,
            min_height_m=msg.min_height_m,
            max_height_m=msg.max_height_m,
            max_range_m=msg.max_range_m,
        )
        self._broadcast_state()

    def _on_state_request(
        self,
        _msg: StateRequest,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        self._broadcast_state()

    def _on_localization_start_request(
        self, _msg: LocalizationStartRequest, client_id: str
    ) -> None:
        requested_client_id = self._policy.on_start_request(client_id)
        if requested_client_id is not None:
            self._send_observations_request(requested_client_id)

    async def _on_localization_observations(
        self,
        observations: tuple[LocalizationObservation, ...],
        client_id: str,
        time_sync: TimeSync,
    ) -> None:
        domain = [
            observation_from_localization(observation, time_sync=time_sync)
            for observation in observations
        ]
        work = self._policy.on_observations(client_id, domain)
        if work is None:
            logger.warning(
                "localization_observations ignored — no pending episode",
                client_id=client_id,
            )
            return
        await self._run_episode(work)

    async def _run_episode(self, work: EpisodeWork) -> None:
        outcome: LocalizationOutcome = await asyncio.to_thread(
            self._coordinator.run, work.observations
        )
        if outcome.defer_vps:
            self._policy.hold_for_client_vps(work.client_id, work.observations)
            return
        if outcome.payload is None:
            self._policy.on_failure(work.client_id)
            return
        self._policy.on_success(work.client_id)
        self._ws_server.schedule_send_to_client(work.client_id, outcome.payload)

    def _publish_stop(self) -> None:
        if self.stop_movement.transport is None:
            return
        self.stop_movement.publish(Bool(True))

    async def handle_lidar(self, msg: PointCloud2) -> None:
        self._state_publisher.publish_lidar(msg, lidar=self._lidar)

    async def handle_odom(self, msg: PoseStamped) -> None:
        ts_server = time.time()
        self._robot_pose_buffer.push(msg, ts_server=ts_server)
        self._state_publisher.publish_odom(msg)
        corrected_x, corrected_y = correct_odom_xy(
            msg.x, msg.y, factor=GO2_PROFILE.odom_correction_factor
        )
        last = self._last_corrected_xy
        if last is not None:
            last_x, last_y, last_ts = last
            dt = ts_server - last_ts
            if dt > 0.0:
                self._speed_mps = math.hypot(corrected_x - last_x, corrected_y - last_y) / dt
        self._last_corrected_xy = (corrected_x, corrected_y, ts_server)
        prompts, episodes = self._policy.on_odom(corrected_x, corrected_y)
        self._robot_observations.expire(self._policy.travel_m)
        self._flush_localization(prompts, episodes)

    async def handle_camera_info(self, msg: CameraInfo) -> None:
        self._robot_observations.set_camera_info(msg)

    async def handle_color_image(self, msg: Image) -> None:
        self._robot_observations.push_image(
            msg,
            ts_server=time.time(),
            speed_mps=self._speed_mps,
            travel_m=self._policy.travel_m,
        )

    async def handle_path(self, msg: Path) -> None:
        nav_goal_frame, state_changed = self._nav_goal_coordinator.on_path(msg)
        self._ws_server.schedule_broadcast_text(encode_nav_goal(nav_goal_frame))
        if state_changed:
            self._broadcast_state()

    async def handle_goal_reached(self, msg: Bool) -> None:
        self._nav_goal_coordinator.on_goal_reached(msg)
        self._broadcast_state()
        if msg.data:
            client_ids = self._policy.on_goal_reached(succeeded=True)
            for client_id in client_ids:
                self._send_observations_request(client_id)
