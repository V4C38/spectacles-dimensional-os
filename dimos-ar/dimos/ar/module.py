from __future__ import annotations

import asyncio
import copy
from dataclasses import replace
import math
import time
from typing import ClassVar, Literal

from dimos_lcm.std_msgs import Bool
from langchain_core.messages.base import BaseMessage
from pydantic import BaseModel, Field, field_validator
import websockets.asyncio.server as ws_server

from dimos.agents.annotation import skill
from dimos.ar.localization.coordinator import (
    AsyncLocalizer,
    LocalizationCoordinator,
    LocalizationOutcome,
)
from dimos.ar.localization.fiducial_marker.localizer import FiducialMarkerLocalizer
from dimos.ar.localization.odom_map_transform import OdomMapTransform, OdomMapTransformConfig
from dimos.ar.localization.policy import EpisodeWork, LocalizationPolicy
from dimos.ar.localization.runner import EPISODE_TIMEOUT_S, RESULT_TIMEOUT_S, LocalizationRunner
from dimos.ar.localization.types import LocalizationProviderType, SnapshotLocalizer
from dimos.ar.localization.vps.localizer import VpsLocalizer
from dimos.ar.localization.vps.multiset_client import MultisetVpsClient, MultisetVpsClientConfig
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.localization.worker import LocalizationWorker
from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.service import ManipulationService
from dimos.ar.manipulation.spec import ARManipulationSpec
from dimos.ar.navigation.coordinator import NavGoalCoordinator
from dimos.ar.navigation.preview_planner import PreviewPlanner
from dimos.ar.navigation.preview_service import NavigationPreviewService
from dimos.ar.navigation.tele_cmd_vel import TeleCmdVelPublisher
from dimos.ar.navigation.types import NavGoalRequest, NavJoystickRequest
from dimos.ar.robot.agent_service import ARAgentService
from dimos.ar.robot.capabilities import (
    NAV_GOAL,
    NAV_JOYSTICK,
    Capability,
    CapabilityName,
    CapabilitySet,
)
from dimos.ar.robot.odometry import RobotOdometry, RobotSourceChangedError
from dimos.ar.robot.profiles.profile import (
    FiducialMarkerMount,
    RobotName,
    RobotProfile,
    get_profile,
)
from dimos.ar.robot.safety import Safety
from dimos.ar.robot.state_publisher import RobotStatePublisher
from dimos.ar.sensors.lidar_settings import DEFAULT_LIDAR_SETTINGS, LidarSettings
from dimos.ar.websocket.ip_relay import DEFAULT_IP_RELAY_URL
from dimos.ar.websocket.protocol import (
    AgentState,
    ClientPose,
    EstopRequest,
    HelloBody,
    LidarSettingsRequest,
    LocalizationObservation,
    LocalizationObservationsRequest,
    LocalizationStartRequest,
    StateRequest,
    StateSnapshot,
    TimeSync,
    UserMessageRequest,
    encode_localization_observations_request,
    encode_localization_result,
    encode_nav_goal,
    encode_pose,
    encode_state,
    observation_from_localization,
)
from dimos.ar.websocket.server import WebSocketServer
from dimos.ar.websocket.server_info import server_info
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.msgs.tf2_msgs.TFMessage import TFMessage
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class LocalizationProviderConfig(BaseModel):
    type: Literal["fiducial_marker", "vps"]
    map_code: str | None = None


class LocalizationConfig(BaseModel):
    providers: list[LocalizationProviderConfig] = Field(default_factory=list)
    episode_timeout_s: float = Field(default=EPISODE_TIMEOUT_S, gt=0, allow_inf_nan=False)
    anchor_max_age_s: float = Field(default=60.0, gt=0, allow_inf_nan=False)
    robot_timing_uncertainty_s: float = Field(default=0.5, ge=0, allow_inf_nan=False)


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    robot_display_name: str | None = Field(default=None, min_length=1, max_length=80)
    stationary_base: ReferencePose | None = None
    robot: RobotName = RobotName.UNITREE_GO2
    port: int = 8787
    ip_relay_url: str | None = Field(default=DEFAULT_IP_RELAY_URL, pattern=r"^https?://[^/]+")
    localization: LocalizationConfig = Field(default_factory=LocalizationConfig)
    agent: bool = False
    fiducial_marker_mounts: list[FiducialMarkerMount] | None = None
    odom_scale_correction_factor: float | None = Field(default=None, gt=0, allow_inf_nan=False)

    @field_validator("fiducial_marker_mounts", mode="before")
    @classmethod
    def _coerce_fiducial_marker_mounts(cls, value: object) -> object:
        if value is None or (isinstance(value, list) and not value):
            return value
        if not isinstance(value, list):
            raise TypeError("fiducial_marker_mounts must be a list or null")
        mounts: list[FiducialMarkerMount] = []
        for item in value:
            if isinstance(item, FiducialMarkerMount):
                mounts.append(item)
                continue
            if not isinstance(item, dict):
                raise TypeError("fiducial_marker_mounts items must be objects")
            try:
                position = item["position"]
                orientation = item["orientation"]
                mounts.append(
                    FiducialMarkerMount(
                        marker_id=int(item["marker_id"]),
                        size_m=float(item["size_m"]),
                        position=(float(position[0]), float(position[1]), float(position[2])),
                        orientation=(
                            float(orientation[0]),
                            float(orientation[1]),
                            float(orientation[2]),
                            float(orientation[3]),
                        ),
                    )
                )
            except (KeyError, TypeError, ValueError, IndexError) as exc:
                raise ValueError(
                    "fiducial_marker_mounts items must match FiducialMarkerMount"
                ) from exc
        return mounts


def profile_for_config(config: ARModuleConfig) -> RobotProfile:
    profile = get_profile(config.robot)
    if config.robot_display_name is not None:
        profile = replace(profile, display_name=config.robot_display_name)
    if config.odom_scale_correction_factor is not None:
        profile = replace(profile, odom_scale_correction_factor=config.odom_scale_correction_factor)
    mounts = config.fiducial_marker_mounts
    if mounts is None:
        return profile
    if not mounts:
        raise ValueError("fiducial_marker_mounts must not be empty")
    return replace(
        profile,
        fiducial_marker_mounts=tuple(mounts),
        fiducial_dictionary=profile.fiducial_dictionary or "DICT_APRILTAG_36h11",
    )


class ARModule(Module):  # type: ignore[misc]
    dedicated_worker: ClassVar[bool] = True

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    global_costmap: In[OccupancyGrid]
    tf: In[TFMessage]
    path: In[Path]
    goal_reached: In[Bool]
    color_image: In[Image]
    camera_info: In[CameraInfo]
    agent: In[BaseMessage]
    agent_idle: In[bool]

    goal_request: Out[PoseStamped]
    stop_movement: Out[Bool]
    human_input: Out[str]
    tele_cmd_vel: Out[Twist]

    config: ARModuleConfig
    _manipulation: ARManipulationSpec | None = None
    _manipulation_service: ManipulationService | None = None
    _stationary_task: asyncio.Task[None] | None = None
    _stop_task: asyncio.Task[None] | None = None
    _stationary_reference = False

    _ws_server: WebSocketServer
    _state_publisher: RobotStatePublisher
    _nav_goal_coordinator: NavGoalCoordinator
    _policy: LocalizationPolicy
    _coordinator: LocalizationCoordinator
    _robot_observations: RobotObservationBuffer
    _profile: RobotProfile
    _capabilities: CapabilitySet
    _safety: Safety
    _tele_cmd_vel_publisher: TeleCmdVelPublisher | None
    _lidar_settings: LidarSettings
    _odometry: RobotOdometry
    _previews: NavigationPreviewService
    _agent_service: ARAgentService

    @rpc
    def build(self) -> None:
        super().build()
        assert self._loop is not None
        self._profile = profile_for_config(self.config)
        self._lidar_settings = DEFAULT_LIDAR_SETTINGS
        self._localization_worker = LocalizationWorker()
        self._replay_mode = (
            bool(getattr(global_config, "replay", False))
            or getattr(global_config, "unitree_connection_type", None) == "replay"
            or global_config.robot_ip in ("fake", "mock", "replay")
        )
        self._odometry = RobotOdometry(
            factor=self._profile.odom_scale_correction_factor, recording=self._replay_mode
        )
        self._stationary_reference = self.config.stationary_base is not None
        self._requires_mapping_restart = False
        self._ws_server = WebSocketServer(
            port=self.config.port,
            relay_url=self.config.ip_relay_url,
            loop=self._loop,
            hello_supplier=self._hello_body,
            on_connect=self._on_client_connect,
            on_nav_goal_request=self._on_nav_goal_request,
            on_estop_request=self._on_estop_request,
            on_lidar_settings_request=self._on_lidar_settings_request,
            on_state_request=self._on_state_request,
            on_localization_start_request=self._on_localization_start_request,
            on_localization_observations=self._on_localization_observations,
            on_user_message_request=self._on_user_message_request,
            on_client_pose=self._on_client_pose,
            on_nav_joystick_request=self._on_nav_joystick_request,
            on_disconnect=self._on_client_disconnect,
            on_manipulation_request=self._on_manipulation_request,
        )
        if self._manipulation is not None:
            self._manipulation_service = ManipulationService(
                self._manipulation,
                self._ws_server.schedule_send_to_client,
                self._ws_server.schedule_broadcast_text,
            )
        self._nav_goal_coordinator = NavGoalCoordinator(
            odom_scale_correction_factor=self._profile.odom_scale_correction_factor,
        )
        self._previews = NavigationPreviewService(
            PreviewPlanner(global_config),
            factor=self._profile.odom_scale_correction_factor,
            odometry=self._odometry.latest,
            send=self._ws_server.schedule_send_to_client,
        )
        self._agent_service = ARAgentService(
            factor=self._profile.odom_scale_correction_factor,
            connection_count=lambda: self._ws_server.connection_count,
            broadcast=self._ws_server.schedule_broadcast_text,
        )
        self._state_publisher = RobotStatePublisher(
            self._ws_server,
            odom_scale_correction_factor=self._profile.odom_scale_correction_factor,
            robot_position=self._odometry.native_position,
        )
        self._policy = LocalizationPolicy(
            [provider.type for provider in self.config.localization.providers],
            travel=self._odometry.travel,
        )
        self._robot_observations = RobotObservationBuffer(
            pose_buffer=self._odometry.history,
            T_base_camera_optical=self._profile.T_base_camera_optical,
            timing_uncertainty_s=self.config.localization.robot_timing_uncertainty_s,
        )
        marker, vps, map_code = self._build_localizers()
        self._capabilities = CapabilitySet.from_supported(
            self._profile.supported_capabilities,
            localization_available=bool(self._policy.providers),
            agent_available=self.config.agent,
            manipulation_available=self._manipulation is not None,
            supported_navigation_inputs=self._profile.supported_navigation_inputs,
        )
        self._tele_cmd_vel_publisher = None
        if self._capabilities.supports_navigation(NAV_JOYSTICK):
            if self._profile.max_linear_mps is None or self._profile.max_angular_rps is None:
                raise ValueError("nav_joystick requires max_linear_mps and max_angular_rps")
            self._tele_cmd_vel_publisher = TeleCmdVelPublisher(
                publish=self._publish_tele_cmd_vel,
                max_linear_mps=self._profile.max_linear_mps,
                max_angular_rps=self._profile.max_angular_rps,
                loop=self._loop,
            )
        self._safety = Safety(
            estop_available=self._capabilities.supports(CapabilityName.ESTOP),
            effects=(self._clear_navigation, self._publish_stop),
        )
        self._coordinator = LocalizationCoordinator(
            policy=self._policy,
            odom_map_transform=OdomMapTransform(
                config=OdomMapTransformConfig(
                    max_age_s=self.config.localization.anchor_max_age_s,
                )
            ),
            robot_observations=self._robot_observations,
            marker=marker,
            vps=vps,
            map_code=map_code,
            worker=self._localization_worker,
            source_generation=lambda: self._odometry.generation,
        )
        self._localization_runner = LocalizationRunner(
            coordinator=self._coordinator,
            policy=self._policy,
            on_outcome=self._complete_localization,
            on_prompt=self._send_observations_request,
            timeout_s=self.config.localization.episode_timeout_s,
        )
        logger.info("ARModule build complete")

    def _build_localizers(
        self,
    ) -> tuple[SnapshotLocalizer | None, AsyncLocalizer | None, str | None]:
        marker: SnapshotLocalizer | None = None
        vps: AsyncLocalizer | None = None
        map_code: str | None = None
        for provider in self.config.localization.providers:
            if provider.type == "fiducial_marker" and marker is None:
                if (
                    not self._profile.fiducial_dictionary
                    or not self._profile.fiducial_marker_mounts
                ):
                    raise ValueError(
                        "fiducial_marker provider requires fiducial dictionary and mounts"
                    )
                marker = FiducialMarkerLocalizer(
                    pose_buffer=self._odometry.history,
                    marker_mounts=self._profile.fiducial_marker_mounts,
                    dictionary_name=self._profile.fiducial_dictionary,
                    allow_latest_robot_pose=self._replay_mode
                    or self.config.stationary_base is not None,
                )
            elif provider.type == "vps" and vps is None:
                if not provider.map_code:
                    raise ValueError("VPS localization provider requires map_code")
                if self._profile.T_base_camera_optical is None:
                    raise ValueError("VPS localization provider requires T_base_camera_optical")
                map_code = provider.map_code
                vps = VpsLocalizer(
                    client=MultisetVpsClient.from_env(
                        MultisetVpsClientConfig(
                            map_code=provider.map_code,
                            timeout_s=self.config.localization.episode_timeout_s,
                        )
                    ),
                    worker=self._localization_worker,
                )
        return marker, vps, map_code

    @rpc
    def start(self) -> None:
        super().start()
        self._loop.call_soon_threadsafe(self._localization_runner.start)
        if self._manipulation_service is not None:
            self._loop.call_soon_threadsafe(self._manipulation_service.start)
        if self.config.stationary_base is not None:
            self._loop.call_soon_threadsafe(self._start_stationary_reference)
        try:
            self._ws_server.start()
        except Exception:
            try:
                self.stop()
            except Exception:
                logger.exception("ARModule startup cleanup failed")
            raise
        host = global_config.listen_host
        logger.info("ARModule started", websocket=f"ws://{host}:{self.config.port}")

    @rpc
    def stop(self) -> None:
        logger.info("ARModule stopping")
        self._cancel_tele_cmd_vel()
        if self._stationary_task is not None:
            self._loop.call_soon_threadsafe(self._stationary_task.cancel)
        for name, service in (
            ("manipulation", getattr(self, "_manipulation_service", None)),
            ("preview", getattr(self, "_previews", None)),
            ("localization", getattr(self, "_localization_runner", None)),
        ):
            if service is None or self._loop is None:
                continue
            future = asyncio.run_coroutine_threadsafe(service.close(), self._loop)
            try:
                future.result(timeout=2.0)
            except TimeoutError:
                logger.warning("AR service shutdown timed out", service=name)
            except Exception as exc:
                logger.exception(
                    "AR service shutdown failed", service=name, error=type(exc).__name__
                )
        ws_server_obj = getattr(self, "_ws_server", None)
        if ws_server_obj is not None:
            ws_server_obj.stop()
        super().stop()

    def _hello_body(self, _client_id: str) -> HelloBody:
        capabilities = self._capabilities.as_mapping()
        navigation_inputs = self._capabilities.navigation_as_mapping()
        if getattr(self, "_requires_mapping_restart", False):
            unavailable = Capability(False, "robot odometry reset; restart DimOS mapping")
            capabilities[CapabilityName.NAVIGATION] = unavailable
            navigation_inputs = dict.fromkeys(navigation_inputs, unavailable)
        return HelloBody(
            robot=self._profile.description,
            capabilities=capabilities,
            navigation_inputs=navigation_inputs,
            nav_goal_preview=(
                self._capabilities.supports_navigation(NAV_GOAL)
                and not getattr(self, "_requires_mapping_restart", False)
            ),
            server_info=server_info(),
            odom_reference_id=self._odometry.reference_id,
        )

    def _state_snapshot(self) -> StateSnapshot:
        idle = True
        if self._capabilities.supports(CapabilityName.AGENT):
            idle = self._agent_service.idle
        return StateSnapshot(
            connected_clients=self._ws_server.connection_count,
            lidar=self._lidar_settings,
            nav=self._nav_goal_coordinator.nav_state(),
            agent=AgentState(idle=idle),
            nav_preview_costmap_ts=self._previews.costmap_ts,
        )

    def _broadcast_state(self) -> None:
        self._ws_server.schedule_broadcast_text(encode_state(self._state_snapshot()))

    def _send_observations_request(self, client_id: str) -> None:
        spec = self._policy.capture_spec
        if spec is None:
            return
        logger.info(
            "localization capture requested",
            client_id=client_id,
            capture_policy=spec.capture_policy.value,
            travel_m=round(self._policy.travel_m, 3),
        )
        self._ws_server.schedule_send_to_client(
            client_id,
            encode_localization_observations_request(
                LocalizationObservationsRequest(
                    capture_policy=spec.capture_policy,
                    observation_count=spec.observation_count,
                    wait_timeout_s=spec.wait_timeout_s,
                    result_timeout_s=(
                        self.config.localization.episode_timeout_s + 3.0
                        if hasattr(self, "config")
                        else RESULT_TIMEOUT_S
                    ),
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
            self._localization_runner.submit(work)

    def _on_client_connect(
        self,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        logger.info("AR client session ready", client_id=client_id)
        self._broadcast_state()
        if self._manipulation_service is not None:
            self._manipulation_service.connect(client_id)
        if self._replay_mode or self._stationary_reference:
            pose = self._odometry.history.latest()
            if pose is not None:
                # History already uses corrected AR coordinates. Preserve its
                # timestamp instead of presenting the replay pose as fresh odom.
                self._ws_server.schedule_send_to_client(
                    client_id,
                    encode_pose(
                        position=pose.position,
                        orientation=pose.orientation,
                        ts=pose.ts_server,
                    ),
                )
        requested_client_id = self._policy.on_hello(client_id)
        if requested_client_id is not None:
            self._send_observations_request(requested_client_id)

    def _on_client_disconnect(self, _websocket: ws_server.ServerConnection, client_id: str) -> None:
        if self._manipulation_service is not None:
            self._manipulation_service.disconnect(client_id)
        self._previews.cancel(client_id)
        runner = getattr(self, "_localization_runner", None)
        if runner is not None:
            runner.cancel(client_id)
        self._policy.on_disconnect(client_id)
        if self._ws_server.connection_count == 0:
            self._cancel_tele_cmd_vel()
            self._safety.on_last_disconnect()
            self._agent_service.reset()
        self._broadcast_state()

    def _on_manipulation_request(
        self, request: ManipulationRequest, client_id: str, clock_offset: float
    ) -> None:
        if self._manipulation_service is not None:
            self._manipulation_service.submit(request, client_id, clock_offset)

    def _start_stationary_reference(self) -> None:
        self._stationary_task = asyncio.create_task(self._publish_stationary_base())

    async def _publish_stationary_base(self) -> None:
        mount = self.config.stationary_base
        if mount is None:
            return
        while True:
            await self.handle_odom(
                PoseStamped(
                    ts=time.time(),
                    frame_id="odom",
                    position=list(mount.position),
                    orientation=list(mount.orientation),
                )
            )
            await asyncio.sleep(0.1)

    def _on_nav_goal_request(
        self,
        msg: NavGoalRequest,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if not self._capabilities.supports_navigation(NAV_GOAL) or getattr(
            self, "_requires_mapping_restart", False
        ):
            return
        if msg.preview:
            self._previews.request(msg, client_id)
            return
        if self.goal_request.transport is None:
            logger.warning("nav_goal_request ignored — goal_request transport is not wired")
            return
        goal = self._nav_goal_coordinator.submit_goal(msg)
        # Publish the new execution's cleared state before planner callbacks can
        # produce a terminal result (including an immediately reached goal).
        self._broadcast_state()
        self.goal_request.publish(goal)
        logger.info("nav_goal_request published", client_id=client_id, position=msg.position)

    async def handle_global_costmap(self, msg: OccupancyGrid) -> None:
        await self._previews.update_costmap(msg)
        self._broadcast_state()

    def _on_estop_request(self, _msg: EstopRequest, _websocket: ws_server.ServerConnection) -> None:
        self._cancel_tele_cmd_vel()
        if self._manipulation is not None:
            self._stop_task = asyncio.create_task(
                asyncio.to_thread(self._manipulation.ar_manipulation_stop)
            )
        if self._safety.on_estop_request():
            self._broadcast_state()

    def _on_lidar_settings_request(
        self,
        msg: LidarSettingsRequest,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        if not self._capabilities.supports(CapabilityName.LIDAR):
            return
        self._lidar_settings = LidarSettings(
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

    def _on_user_message_request(
        self,
        msg: UserMessageRequest,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if not self._capabilities.supports(CapabilityName.AGENT):
            return
        if self.human_input.transport is None:
            logger.warning("user_message_request ignored — human_input transport is not wired")
            return
        self.human_input.publish(msg.text)
        logger.info("human_input published", client_id=client_id, chars=len(msg.text))

    def _on_client_pose(
        self,
        msg: ClientPose,
        _websocket: ws_server.ServerConnection,
        _client_id: str,
    ) -> None:
        self._agent_service.set_pose(msg)

    def _on_nav_joystick_request(
        self,
        msg: NavJoystickRequest,
        _websocket: ws_server.ServerConnection,
        _client_id: str,
    ) -> None:
        if not self._capabilities.supports_navigation(NAV_JOYSTICK) or getattr(
            self, "_requires_mapping_restart", False
        ):
            return
        if self.tele_cmd_vel.transport is None:
            logger.warning("nav_joystick_request ignored — tele_cmd_vel transport is not wired")
            return
        publisher = self._tele_cmd_vel_publisher
        if publisher is None:
            raise RuntimeError("nav_joystick requires TeleCmdVelPublisher")
        publisher.handle(msg)

    def _publish_tele_cmd_vel(self, twist: Twist) -> None:
        self.tele_cmd_vel.publish(twist)

    def _cancel_tele_cmd_vel(self) -> None:
        publisher = getattr(self, "_tele_cmd_vel_publisher", None)
        if publisher is not None:
            publisher.cancel()

    def _on_localization_start_request(
        self, _msg: LocalizationStartRequest, client_id: str
    ) -> None:
        self._localization_runner.cancel(client_id)
        requested_client_id = self._policy.on_start_request(client_id)
        if requested_client_id is not None:
            self._send_observations_request(requested_client_id)

    def _on_localization_observations(
        self,
        observations: tuple[LocalizationObservation, ...],
        client_id: str,
        time_sync: TimeSync,
    ) -> None:
        logger.info(
            "localization_observations received",
            client_id=client_id,
            count=len(observations),
        )
        domain = [
            observation_from_localization(observation, time_sync=time_sync)
            for observation in observations
        ]
        newest = max(domain, key=lambda observation: observation.ts_server)
        logger.info(
            "localization capture admitted for validation",
            client_id=client_id,
            newest_capture_age_s=round(time.time() - newest.ts_server, 3),
            jpeg_bytes=sum(len(observation.jpeg) for observation in observations),
        )
        pose = self._odometry.history.at_server_ts(
            newest.ts_server,
            fallback_to_latest=(
                LocalizationProviderType.FIDUCIAL_MARKER in self._policy.providers
                and self._replay_mode
            ),
        )
        work = self._policy.on_observations(
            client_id,
            domain,
            capture_travel_m=None if pose is None else pose.travel_m,
        )
        if work is None:
            logger.warning(
                "localization_observations ignored — no pending episode",
                client_id=client_id,
            )
            return
        self._localization_runner.submit(work)

    def _complete_localization(self, work: EpisodeWork, outcome: LocalizationOutcome) -> None:
        if outcome.defer_vps:
            self._policy.defer_vps(work.client_id)
            return
        if outcome.result is None:
            logger.warning(
                "localization episode produced no result",
                client_id=work.client_id,
                observations=len(work.observations),
            )
            # Keep scanning after a miss instead of leaving the client waiting
            # for its result timeout. Reuse the existing capture request; VPS
            # cooldowns still decide when another batch may be requested.
            requested_client_id = self._policy.retry_failed_episode(work.client_id, backoff_s=2.0)
            if requested_client_id is not None:
                self._send_observations_request(requested_client_id)
            return
        self._policy.on_success(work.client_id, capture_travel_m=work.capture_travel_m)
        self._ws_server.schedule_send_to_client(
            work.client_id, encode_localization_result(outcome.result)
        )

    def _clear_navigation(self) -> bool:
        return self._nav_goal_coordinator.on_estop()

    def _publish_stop(self) -> bool:
        if self.stop_movement.transport is None:
            return False
        self.stop_movement.publish(Bool(True))
        return True

    async def handle_lidar(self, msg: PointCloud2) -> None:
        if not self._capabilities.supports(CapabilityName.LIDAR):
            return
        clock = self._odometry.clock
        if clock is not None:
            timestamp = clock.to_server(float(msg.ts))
            if timestamp is None:
                return
            msg = copy.copy(msg)
            msg.ts = timestamp
        self._state_publisher.publish_lidar(msg, lidar=self._lidar_settings)

    async def handle_odom(self, msg: PoseStamped) -> None:
        try:
            accepted = self._odometry.accept(msg)
        except RobotSourceChangedError:
            self._retire_robot_source()
            return
        if accepted is None:
            return
        self._state_publisher.publish_odom(accepted.native_pose())
        prompts, episodes = self._policy.on_odom()
        self._robot_observations.expire(self._policy.travel_m)
        self._flush_localization(prompts, episodes)

    def _retire_robot_source(self) -> None:
        self._odometry.retire()
        self._previews.cancel_all()
        self._requires_mapping_restart = True
        self._localization_runner.cancel_all()
        self._coordinator.invalidate_source()
        self._policy.reset_source()
        self._cancel_tele_cmd_vel()
        self._safety.on_estop_request()
        self._ws_server.schedule_disconnect_all("robot odometry reset; restart mapping")
        logger.warning("robot odometry source changed; restart DimOS mapping")

    async def handle_camera_info(self, msg: CameraInfo) -> None:
        if self._profile.T_base_camera_optical is None:
            return
        self._robot_observations.set_camera_info(msg)

    async def handle_color_image(self, msg: Image) -> None:
        if (
            self._profile.T_base_camera_optical is None
            or LocalizationProviderType.VPS not in self._policy.providers
        ):
            return
        clock = self._odometry.clock
        timestamp = float(msg.ts) if clock is None else clock.to_server(float(msg.ts))
        if (
            timestamp is None
            or not math.isfinite(timestamp)
            or not -0.25 <= time.time() - timestamp <= 2.0
        ):
            return
        generation = self._odometry.generation
        # WebRTC timestamps describe decode/receipt. Wait for the positive half
        # of the conservative stillness window; other input handlers keep running.
        target = timestamp + self._robot_observations.timing_uncertainty_s
        deadline = time.monotonic() + self._robot_observations.timing_uncertainty_s + 0.25
        while True:
            if generation != self._odometry.generation or time.monotonic() >= deadline:
                return
            latest = self._odometry.history.latest()
            if latest is not None and latest.ts_server >= target:
                break
            await asyncio.sleep(0.02)
        poses = self._odometry.history.snapshot()
        pose = poses.at_server_ts(timestamp)
        if pose is None:
            return
        sample = await self._localization_worker.run(
            lambda: self._robot_observations.prepare_image(
                msg,
                ts_server=timestamp,
                travel_m=pose.travel_m,
                pose_buffer=poses,
                source_generation=generation,
            )
        )
        if sample is not None and generation == self._odometry.generation:
            self._robot_observations.add_sample(sample)

    async def handle_path(self, msg: Path) -> None:
        if not self._capabilities.supports(CapabilityName.NAVIGATION):
            return
        nav_goal_frame, state_changed = self._nav_goal_coordinator.on_path(msg)
        if nav_goal_frame is not None:
            self._ws_server.schedule_broadcast_text(encode_nav_goal(nav_goal_frame))
        if state_changed:
            self._broadcast_state()

    async def handle_goal_reached(self, msg: Bool) -> None:
        if not self._capabilities.supports(CapabilityName.NAVIGATION):
            return
        self._nav_goal_coordinator.on_goal_reached(msg)
        self._broadcast_state()
        if msg.data:
            client_ids = self._policy.on_goal_reached(succeeded=True)
            for client_id in client_ids:
                self._send_observations_request(client_id)

    async def handle_agent(self, msg: BaseMessage) -> None:
        if not self._capabilities.supports(CapabilityName.AGENT):
            return
        self._agent_service.forward(msg)

    async def handle_agent_idle(self, msg: bool) -> None:
        if not self._capabilities.supports(CapabilityName.AGENT):
            return
        if self._agent_service.update_idle(bool(msg)):
            self._broadcast_state()

    @skill
    def ar_place_marker(self, id: str, x: float, y: float, z: float, title: str = "") -> str:
        """Place or replace a marker in the AR client's world at an odom-frame point.

        Input uses native DimOS odometry, matching mapping and agent perception.
        ARModule applies the configured XY heuristic at the wire boundary. `id` is the handle, not the label. An omitted or empty
        title leaves the marker unlabeled. The same id upserts.

        Args:
            id: Marker handle. Non-blank, max 64 characters.
            x: Odom-frame X in meters.
            y: Odom-frame Y in meters.
            z: Odom-frame Z in meters.
            title: Optional label on the marker.
        """
        return self._agent_service.place(id, x, y, z, title)

    @skill
    def ar_remove_marker(self, id: str) -> str:
        """Remove a previously placed AR marker by id.

        Args:
            id: Marker handle from ar_place_marker.
        """
        return self._agent_service.remove(id)

    @skill
    def ar_get_client_pose(self) -> str:
        """Return the latest wearer pose in native DimOS odom, including look direction.

        Position and viewing ray invert the XY heuristic for native mapping.
        Orientation retains the physical optical quaternion. Uses the inbound
        client_pose buffer; missing or older than 2 s returns No client pose.
        Broadcasts nothing.
        """
        return self._agent_service.client_pose()
