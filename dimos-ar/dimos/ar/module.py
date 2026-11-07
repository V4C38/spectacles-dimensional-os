from __future__ import annotations

import asyncio
import copy
from dataclasses import replace
import json
import math
import time
from typing import Any, ClassVar, Literal

from dimos_lcm.std_msgs import Bool, String
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
from dimos.ar.localization.map_localization import MapLocalization
from dimos.ar.localization.odom_map_transform import OdomMapTransform, OdomMapTransformConfig
from dimos.ar.localization.policy import EpisodeWork, LocalizationPolicy
from dimos.ar.localization.runner import EPISODE_TIMEOUT_S, RESULT_TIMEOUT_S, LocalizationRunner
from dimos.ar.localization.types import LocalizationProviderType, SnapshotLocalizer
from dimos.ar.localization.vps.admission import VpsAdmission
from dimos.ar.localization.vps.localizer import VpsLocalizer
from dimos.ar.localization.vps.multiset_client import MultisetVpsClient, MultisetVpsClientConfig
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.localization.worker import LocalizationWorker
from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.rpc import ManipulationRPC
from dimos.ar.manipulation.service import ManipulationService
from dimos.ar.manipulation.spec import ARManipulationSpec
from dimos.ar.navigation.control_service import NavigationControlService
from dimos.ar.navigation.control_spec import ARNavigationControlSpec
from dimos.ar.navigation.coordinator import NavGoalCoordinator
from dimos.ar.navigation.preview_planner import PreviewPlanner
from dimos.ar.navigation.preview_service import NavigationPreviewService
from dimos.ar.navigation.tele_cmd_vel import TeleCmdVelPublisher
from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest, NavJoystickRequest
from dimos.ar.replication.interaction import (
    InteractionCoordinator,
    InteractionKind,
    InteractionRequest,
    SharedTarget,
)
from dimos.ar.robot.agent_control import ARAgentControlSpec
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
    LocalizationCaptureProgress,
    LocalizationObservation,
    LocalizationObservationsRequest,
    LocalizationStartRequest,
    LocalizationTracking,
    StateRequest,
    StateSnapshot,
    TimeSync,
    UserMessageRequest,
    encode_localization_observations_request,
    encode_localization_result,
    encode_pose,
    encode_state,
    encode_text,
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
    travel_threshold_m: float = Field(default=0.75, gt=0, allow_inf_nan=False)
    heading_threshold_deg: float = Field(default=30.0, gt=0, le=180, allow_inf_nan=False)
    marker_preference_s: float = Field(default=1.5, ge=0, allow_inf_nan=False)
    headset_travel_threshold_m: float = Field(default=10.0, gt=0, allow_inf_nan=False)
    episode_timeout_s: float = Field(default=EPISODE_TIMEOUT_S, gt=0, allow_inf_nan=False)
    anchor_max_age_s: float = Field(default=60.0, gt=0, allow_inf_nan=False)
    robot_timing_uncertainty_s: float = Field(default=0.5, ge=0, allow_inf_nan=False)


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    robot_display_name: str | None = Field(default=None, min_length=1, max_length=80)
    object_detection: bool = False
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
    ar_navigation_status: In[String]
    color_image: In[Image]
    camera_info: In[CameraInfo]
    agent: In[BaseMessage]
    agent_idle: In[bool]

    goal_request: Out[PoseStamped]
    stop_movement: Out[Bool]
    human_input: Out[str]
    tele_cmd_vel: Out[Twist]

    config: ARModuleConfig

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
    _agent_control: ARAgentControlSpec | None = None
    _agent_mode_rpc: ManipulationRPC | None = None
    _navigation_control: ARNavigationControlSpec | None = None
    _navigation_service: NavigationControlService | None = None
    _mode_task: asyncio.Task[None] | None = None
    _manipulation: ARManipulationSpec | None = None
    _manipulation_service: ManipulationService | None = None
    _stationary_task: asyncio.Task[None] | None = None
    _interaction: InteractionCoordinator
    _interaction_task: asyncio.Task[None] | None = None
    _native_mode_uncertain: bool = False
    _interaction_sent_revision: int = -1
    _native_sequences: dict[str, int]

    @rpc
    def build(self) -> None:
        super().build()
        assert self._loop is not None
        self._profile = profile_for_config(self.config)
        self._interaction = InteractionCoordinator()
        self._interaction_task = None
        self._interaction_sent_revision = -1
        self._native_sequences = {}
        if self._navigation_control is not None:
            self._navigation_service = NavigationControlService(
                self._navigation_control,
                lambda: (self._interaction.epoch, self._interaction.revision),
                self._native_navigation_failed,
            )
        self._pending_arm_motion: set[str] = set()
        self._arm_uncertain = False
        self._arm_stop_pending = False
        self._arm_native_busy = False
        self._lidar_settings = DEFAULT_LIDAR_SETTINGS
        self._lidar_subscriptions: dict[str, LidarSettings] = {}
        self._localization_worker = LocalizationWorker()
        self._vps_admission = VpsAdmission()
        self._pairing_log_at = 0.0
        self._pairing_rejected = 0
        self._pairing_accepted = 0
        self._map_localization: MapLocalization | None = None
        self._replay_mode = (
            bool(getattr(global_config, "replay", False))
            or getattr(global_config, "unitree_connection_type", None) == "replay"
            or global_config.robot_ip in ("fake", "mock", "replay")
        )
        self._odometry = RobotOdometry(
            factor=self._profile.odom_scale_correction_factor, recording=self._replay_mode
        )
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
            on_localization_progress=self._on_localization_progress,
            on_nav_joystick_request=self._on_nav_joystick_request,
            on_disconnect=self._on_client_disconnect,
            on_interaction_request=self._on_interaction_request,
            on_manipulation_request=self._on_manipulation_request,
        )
        if self._manipulation is not None:
            self._manipulation_service = ManipulationService(
                self._manipulation,
                self._ws_server.schedule_send_to_client,
                self._ws_server.schedule_broadcast_text,
                on_ready=lambda: logger.info("Manipulation runtime ready"),
                on_snapshot=self._on_manipulation_snapshot,
                on_result=self._on_manipulation_result,
                control_state=lambda: (self._interaction.epoch, self._interaction.revision),
                prepare_outbound=self._ws_server.prepare_outbound_async,
            )
        self._nav_goal_coordinator = NavGoalCoordinator(
            odom_scale_correction_factor=self._profile.odom_scale_correction_factor,
        )
        self._previews = NavigationPreviewService(
            PreviewPlanner(global_config),
            factor=self._profile.odom_scale_correction_factor,
            odometry=self._odometry.latest,
            send=self._ws_server.schedule_send_to_client,
            on_preview=self._on_navigation_preview,
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
            subscriptions=lambda: dict(self._lidar_subscriptions),
        )
        self._policy = LocalizationPolicy(
            [provider.type for provider in self.config.localization.providers],
            travel=self._odometry.travel,
            travel_threshold_m=self.config.localization.travel_threshold_m,
            heading_threshold_deg=self.config.localization.heading_threshold_deg,
            heading=self._robot_heading,
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
            object_detection_available=self.config.object_detection,
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
        transforms = OdomMapTransform(
            config=OdomMapTransformConfig(max_age_s=self.config.localization.anchor_max_age_s)
        )
        self._coordinator = LocalizationCoordinator(
            policy=self._policy,
            odom_map_transform=transforms,
            robot_observations=self._robot_observations,
            marker=marker,
            vps=vps,
            map_code=map_code,
            worker=self._localization_worker,
            source_generation=lambda: self._odometry.generation,
        )
        if vps is not None and map_code is not None:
            self._map_localization = MapLocalization(
                odometry=self._odometry,
                transforms=transforms,
                robot_images=self._robot_observations,
                marker=marker,
                vps=vps,
                worker=self._localization_worker,
                admission=self._vps_admission,
                map_code=map_code,
                send=self._ws_server.schedule_send_to_client,
                travel_threshold_m=self.config.localization.travel_threshold_m,
                heading_threshold_deg=self.config.localization.heading_threshold_deg,
                marker_preference_s=self.config.localization.marker_preference_s,
                headset_travel_threshold_m=self.config.localization.headset_travel_threshold_m,
                timeout_s=self.config.localization.episode_timeout_s,
            )
        self._localization_runner = LocalizationRunner(
            coordinator=self._coordinator,
            policy=self._policy,
            map_localization=self._map_localization,
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
                        ),
                        admit=self._vps_admission.admit,
                    ),
                    worker=self._localization_worker,
                )
        return marker, vps, map_code

    @rpc
    def start(self) -> None:
        super().start()
        self._loop.call_soon_threadsafe(self._localization_runner.start)
        if self._navigation_service is not None:
            self._loop.call_soon_threadsafe(self._navigation_service.start)
        self._loop.call_soon_threadsafe(self._start_interaction_poll)
        if self._manipulation_service is not None:
            self._loop.call_soon_threadsafe(self._manipulation_service.start)
        if self.config.stationary_base is not None:
            self._loop.call_soon_threadsafe(self._start_stationary_base)
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
        if getattr(self, "_ar_stopping", False):
            return
        self._ar_stopping = True
        logger.info("ARModule stopping")
        self._cancel_tele_cmd_vel()
        if self._mode_task is not None:
            self._loop.call_soon_threadsafe(self._mode_task.cancel)
        if self._agent_mode_rpc is not None:
            self._loop.call_soon_threadsafe(self._agent_mode_rpc.close)
        if self._interaction_task is not None:
            self._loop.call_soon_threadsafe(self._interaction_task.cancel)
        if self._stationary_task is not None:
            self._loop.call_soon_threadsafe(self._stationary_task.cancel)
        for name, service in (
            ("navigation", getattr(self, "_navigation_service", None)),
            (
                "telemetry",
                getattr(self, "_state_publisher", None)
                if hasattr(getattr(self, "_state_publisher", None), "close")
                else None,
            ),
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
        snapshot = self._state_snapshot()
        subscriptions = getattr(self, "_lidar_subscriptions", {})
        if subscriptions:
            for client_id, settings in subscriptions.items():
                self._ws_server.schedule_send_to_client(
                    client_id, encode_state(replace(snapshot, lidar=settings))
                )
        else:
            self._ws_server.schedule_broadcast_text(encode_state(snapshot))

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
        self._interaction.connect(client_id)
        self._lidar_subscriptions[client_id] = DEFAULT_LIDAR_SETTINGS
        if self._manipulation_service is not None:
            self._manipulation_service.connect(client_id)
        self._ws_server.schedule_send_to_client(
            client_id, encode_text(self._interaction.snapshot())
        )
        for marker in self._agent_service.marker_snapshot():
            self._ws_server.schedule_send_to_client(client_id, marker)
        self._broadcast_state()
        if self._replay_mode or self.config.stationary_base is not None:
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
        if self._map_localization is not None:
            self._map_localization.connect(client_id)
            return
        requested_client_id = self._policy.on_hello(client_id)
        if requested_client_id is not None:
            self._send_observations_request(requested_client_id)

    def _on_client_disconnect(self, _websocket: ws_server.ServerConnection, client_id: str) -> None:
        self._previews.cancel(client_id)
        self._interaction.disconnect(client_id)
        self._lidar_subscriptions.pop(client_id, None)
        self._update_lidar_aggregate()
        if self._manipulation_service is not None:
            self._manipulation_service.disconnect(client_id)
        self._drain_interaction_retirements()
        self._agent_service.disconnect(client_id)
        self._broadcast_interaction()
        runner = getattr(self, "_localization_runner", None)
        if runner is not None:
            runner.cancel(client_id)
        if self._map_localization is not None:
            self._map_localization.disconnect(client_id)
        self._policy.on_disconnect(client_id)
        if self._ws_server.connection_count == 0:
            if self._manipulation_service is not None:
                self._arm_stop_pending = True
                self._interaction.set_motion_busy(True)
                self._manipulation_service.emergency_stop(
                    self._interaction.epoch, self._interaction.revision
                )
            self._cancel_tele_cmd_vel()
            self._safety.on_last_disconnect()
            self._agent_service.reset()
        self._broadcast_state()

    def _start_stationary_base(self) -> None:
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

    def _start_interaction_poll(self) -> None:
        self._interaction_task = asyncio.create_task(self._poll_interaction())

    async def _poll_interaction(self) -> None:
        while True:
            self._interaction.poll()
            self._drain_interaction_retirements()
            self._broadcast_interaction()
            await asyncio.sleep(0.05)

    def _broadcast_interaction(self, *, force: bool = False) -> None:
        if force or self._interaction_sent_revision != self._interaction.revision:
            self._interaction_sent_revision = self._interaction.revision
            self._ws_server.schedule_broadcast_text(encode_text(self._interaction.snapshot()))

    def _drain_interaction_retirements(self) -> None:
        for authority, reason in self._interaction.drain_retirements():
            self._previews.cancel(authority.client_id)
            self._native_sequences.pop(authority.lease_id, None)
            if (
                authority.kind.startswith("manipulation_")
                and self._manipulation_service is not None
            ):
                self._manipulation_service.revoke(
                    self._interaction.epoch, authority.lease_id, self._interaction.revision, reason
                )
            if authority.kind == "joystick":
                self._cancel_tele_cmd_vel()
            elif authority.kind == "live" and reason not in {"released", "confirmed"}:
                self._cancel_tele_cmd_vel()
                self._safety.on_estop_request()
                self._interaction.set_active_goal(None)
                self._broadcast_interaction(force=True)
                self._broadcast_state()

    def _on_interaction_request(self, request: InteractionRequest, client_id: str) -> None:
        self._interaction.poll()
        self._drain_interaction_retirements()
        if (
            request.action == "mode"
            and (request.mode != self._interaction.mode or self._native_mode_uncertain)
            and self._capabilities.supports(CapabilityName.AGENT)
        ):
            if (
                self._mode_task is not None
                or self._interaction.authority is not None
                or self._interaction.agent_busy
                or self._interaction.motion_busy
            ):
                self._interaction_reply(request, client_id, "busy", "robot_busy")
                return
            if self._agent_control is None:
                self._interaction_reply(
                    request, client_id, "rejected", "native_quiescence_unavailable"
                )
                return
            if request.mode == "agent":
                result = self._interaction.handle(client_id, request)
                if result.status != "accepted":
                    self._ws_server.schedule_send_to_client(client_id, encode_text(result.wire()))
                    return
                self._broadcast_interaction(force=True)
            self._interaction.agent_busy = True
            self._mode_task = asyncio.create_task(self._change_native_mode(request, client_id))
            return
        if (
            request.action == "mode"
            and request.mode == "agent"
            and not self._capabilities.supports(CapabilityName.AGENT)
        ):
            reply = {
                "type": "interaction_result",
                "request_id": request.request_id,
                "status": "rejected",
                "code": "agent_unavailable",
                "epoch": self._interaction.epoch,
                "revision": self._interaction.revision,
            }
        elif request.action == "acquire" and (
            not self._capabilities.supports(
                CapabilityName.MANIPULATION
                if request.kind is not None and request.kind.startswith("manipulation_")
                else CapabilityName.NAVIGATION
            )
            or getattr(self, "_requires_mapping_restart", False)
        ):
            reply = {
                "type": "interaction_result",
                "request_id": request.request_id,
                "status": "rejected",
                "code": "navigation_unavailable",
                "epoch": self._interaction.epoch,
                "revision": self._interaction.revision,
            }
        else:
            previous_target = self._interaction.target
            result = self._interaction.handle(client_id, request, commit=self._commit_shared_target)
            authority = self._interaction.authority
            if (
                self._manipulation_service is not None
                and authority is not None
                and authority.kind == "manipulation_planning"
                and self._interaction.target is not None
                and (
                    previous_target is None
                    or self._interaction.target.domain != previous_target.domain
                    or self._interaction.target.group_id != previous_target.group_id
                    or self._interaction.target.revision != previous_target.revision
                )
            ):
                self._manipulation_service.revoke(
                    self._interaction.epoch,
                    authority.lease_id,
                    # Retire work preceding this edit, not requests admitted for it.
                    self._interaction.revision - 1,
                    "target_changed",
                )
            if (
                request.action == "acquire"
                and result.status == "accepted"
                and result.code == "acquired"
                and self._manipulation_service is not None
            ):
                self._manipulation_service.revoke(
                    self._interaction.epoch,
                    result.lease_id or "",
                    self._interaction.revision - 1,
                    "superseded",
                )
            reply = result.wire()
        self._drain_interaction_retirements()
        self._ws_server.schedule_send_to_client(client_id, encode_text(reply))
        # High-rate target samples are coalesced by the 20Hz loop. Authority
        # transitions and their exact final poses are delivered immediately.
        if request.action != "update":
            self._broadcast_interaction(force=True)

    def _interaction_reply(
        self, request: InteractionRequest, client_id: str, status: str, code: str
    ) -> None:
        self._ws_server.schedule_send_to_client(
            client_id,
            encode_text(
                {
                    "type": "interaction_result",
                    "request_id": request.request_id,
                    "status": status,
                    "code": code,
                    "epoch": self._interaction.epoch,
                    "revision": self._interaction.revision,
                }
            ),
        )

    async def _change_native_mode(self, request: InteractionRequest, client_id: str) -> None:
        try:
            assert self._agent_control is not None
            if self._agent_mode_rpc is None:
                self._agent_mode_rpc = ManipulationRPC(self._agent_control)  # type: ignore[arg-type]
            accepted = await self._agent_mode_rpc.call(
                "ar_agent_set_manual",
                request.mode == "manual",
                timeout=2,
            )
            self._interaction.agent_busy = not self._agent_service.idle
            if request.epoch != self._interaction.epoch:
                self._interaction_reply(request, client_id, "stale", "epoch_changed")
            elif not accepted:
                self._native_mode_uncertain = False
                if request.mode == "agent":
                    # Native refused to resume, so manual is still its positive state.
                    self._interaction.mode = "manual"
                    self._interaction.revision += 1
                self._interaction_reply(request, client_id, "busy", "native_motion_active")
            elif request.mode == "manual":
                self._native_mode_uncertain = False
                result = self._interaction.handle(client_id, request)
                self._ws_server.schedule_send_to_client(client_id, encode_text(result.wire()))
            else:
                self._native_mode_uncertain = False
                self._interaction_reply(request, client_id, "accepted", "mode_changed")
            self._broadcast_interaction(force=True)
        except TimeoutError:
            self._native_mode_uncertain = True
            self._interaction_reply(request, client_id, "rejected", "native_mode_timeout")
        except Exception:
            self._native_mode_uncertain = True
            logger.exception("Native robot mode transition failed")
            self._interaction_reply(request, client_id, "rejected", "native_mode_failed")
        finally:
            self._interaction.agent_busy = not self._agent_service.idle
            self._mode_task = None

    def _commit_shared_target(self, target: SharedTarget, kind: InteractionKind) -> bool:
        if kind == "joystick":
            self._cancel_tele_cmd_vel()
            return True
        return self._submit_navigation_goal(NavGoalRequest(target.position, target.orientation))

    def _submit_navigation_goal(self, msg: NavGoalRequest) -> bool:
        service = self._navigation_service
        allow_fixture = getattr(self, "_allow_unfenced_navigation", False)
        if (service is None and not allow_fixture) or getattr(
            self, "_requires_mapping_restart", False
        ):
            return False
        if allow_fixture and self.goal_request.transport is None:
            return False
        goal = self._nav_goal_coordinator.submit_goal(msg)
        self._broadcast_state()
        if service is not None:
            if not service.submit(goal, self._interaction.epoch, self._interaction.revision):
                return False
        else:
            self.goal_request.publish(goal)
        yaw = PoseStamped(position=list(msg.position), orientation=list(msg.orientation)).yaw
        self._interaction.set_active_goal(
            {"type": "nav_goal", "pose": [*msg.position, yaw], "path_poses": [], "ts": time.time()}
        )
        return True

    def _native_navigation_failed(self, goal_ts: float) -> None:
        if self._nav_goal_coordinator.on_native_status(goal_ts, "failed"):
            self._interaction.set_active_goal(None)
            self._publish_stop()
            self._broadcast_interaction(force=True)
            self._broadcast_state()

    def _native_authorized(
        self, client_id: str, msg: NavGoalRequest | NavJoystickRequest, kind: InteractionKind
    ) -> bool:
        allowed = self._interaction.authorized(client_id, msg.epoch, msg.lease_id, kind=kind)
        self._drain_interaction_retirements()
        authority = self._interaction.authority
        if not allowed or authority is None or msg.sequence is None:
            return False
        if msg.sequence < authority.sequence or msg.sequence <= self._native_sequences.get(
            authority.lease_id, -1
        ):
            return False
        self._native_sequences[authority.lease_id] = msg.sequence
        return True

    def _on_nav_goal_request(
        self, msg: NavGoalRequest, _websocket: ws_server.ServerConnection, client_id: str
    ) -> None:
        if not self._capabilities.supports_navigation(NAV_GOAL) or getattr(
            self, "_requires_mapping_restart", False
        ):
            return
        if msg.preview:
            if not self._interaction.authorized(
                client_id, msg.epoch, msg.lease_id, kind="navigation_planning"
            ):
                self._drain_interaction_retirements()
                return
            target = self._interaction.target
            if target is None:
                return
            self._previews.request(
                replace(
                    msg,
                    position=target.position,
                    orientation=target.orientation,
                    target_revision=target.revision,
                ),
                client_id,
            )
            return
        if not self._native_authorized(client_id, msg, "live"):
            return
        target = self._interaction.target
        if target is not None and target.domain == "navigation":
            self._submit_navigation_goal(
                replace(msg, position=target.position, orientation=target.orientation)
            )

    async def _on_navigation_preview(
        self, client_id: str, request: NavGoalRequest, frame: object
    ) -> None:
        # The worker may complete after release, expiry, handover or aim changes.
        if not isinstance(frame, NavGoalFrame):
            return
        if request.epoch is None or request.lease_id is None or request.target_revision is None:
            return
        body = await self._ws_server.prepare_outbound_async(self._navigation_payload(frame))
        if self._interaction.set_preview(
            body,
            epoch=request.epoch,
            lease_id=request.lease_id,
            target_revision=request.target_revision,
            source_position=request.position,
            source_orientation=request.orientation,
        ):
            self._ws_server.schedule_send_to_client(client_id, encode_text(body))
            self._broadcast_interaction()

    def _on_manipulation_snapshot(self, snapshot: dict[str, Any]) -> None:
        if snapshot.get("available") is not True:
            return
        execution = snapshot.get("execution")
        self._interaction.set_following_tail(snapshot.get("following_tail"))
        self._arm_native_busy = (
            snapshot.get("operation_id") is not None
            or execution in {"accepted", "executing", "uncertain", "fault"}
        )
        # Live following is scoped to the editing lease; a normal release must
        # allow immediate takeover while native handoff finishes asynchronously.
        # Accepted execution/reset/parking and unresolved stop outcomes retain
        # their independent robot-wide busy guards.
        # A transport timeout can leave native work running. Only an explicit,
        # confirmed stop resolves that uncertainty; missing observations cannot.
        stopped = (
            snapshot.get("stopped") is True
            and snapshot.get("stop_confirmed") is True
            and snapshot.get("following") is not True
            and not self._arm_native_busy
            and execution in {"idle", "completed", "aborted", "rejected"}
        )
        if stopped:
            self._arm_uncertain = self._arm_stop_pending = False
        self._interaction.set_motion_busy(
            bool(self._pending_arm_motion)
            or self._arm_native_busy
            or self._arm_uncertain
            or self._arm_stop_pending
        )

    def _on_manipulation_result(self, request: ManipulationRequest, result: dict[str, Any]) -> None:
        if request.action in {"execute", "reset_joints", "prepare_shutdown"}:
            self._pending_arm_motion.discard(request.request_id)
            if result.get("status") in {"uncertain", "fault"}:
                self._arm_uncertain = True
            self._interaction.set_motion_busy(
                bool(self._pending_arm_motion)
                or self._arm_native_busy
                or self._arm_uncertain
                or self._arm_stop_pending
                or result.get("status") == "accepted"
            )

    def _on_manipulation_request(
        self, request: ManipulationRequest, client_id: str, clock_offset: float
    ) -> None:
        service = self._manipulation_service
        if service is None:
            return
        self._interaction.poll()
        self._drain_interaction_retirements()
        payload = request.payload
        authority = self._interaction.authority
        epoch = payload.get("epoch")
        lease_id = payload.get("lease_id")
        owns = (
            authority is not None
            and authority.client_id == client_id
            and authority.lease_id == lease_id
            and authority.kind.startswith("manipulation_")
            and authority.group_id == request.group_id
        )
        # Discrete commands can use a released shared target; they do not acquire
        # a persistent creator-client lock. Native operation admission stays atomic.
        target = next(
            (
                t
                for t in self._interaction.snapshot()["targets"]
                if t["domain"] == "manipulation" and t["group_id"] == request.group_id
            ),
            None,
        )
        valid_target = target is not None and payload.get("target_revision") == target["revision"]
        allowed = (
            epoch == self._interaction.epoch
            and self._interaction.mode == "manual"
            and (owns or authority is None)
        )
        if request.action in {"acquire", "update"}:
            allowed = (
                allowed
                and owns
                and authority is not None
                and authority.kind == "manipulation_following"
            )
        elif request.action in {"plan", "evaluate", "execute", "gripper"}:
            allowed = allowed and valid_target
        if not allowed:
            self._ws_server.schedule_send_to_client(
                client_id,
                encode_text(
                    {
                        "type": "manipulation_result",
                        "request_id": request.request_id,
                        "action": request.action,
                        "group_id": request.group_id,
                        "status": "rejected",
                        "code": "ownership",
                        "message": "Robot interaction is owned or target changed",
                    }
                ),
            )
            return
        if request.action in {"update", "plan", "evaluate"} and target is not None:
            payload = {
                **payload,
                "position": target["position"],
                "orientation": target["orientation"],
                "speed_scale": target["speed_scale"],
            }
            payload.pop("final_gripper", None)
            if request.action == "plan" and "gripper" in target:
                payload["final_gripper"] = target["gripper"]
        if request.action == "gripper" and target is not None:
            if "gripper" not in target:
                self._ws_server.schedule_send_to_client(
                    client_id,
                    encode_text(
                        {
                            "type": "manipulation_result",
                            "request_id": request.request_id,
                            "action": request.action,
                            "group_id": request.group_id,
                            "status": "rejected",
                            "code": "target_changed",
                        }
                    ),
                )
                return
            payload = {**payload, "value": target["gripper"]}
        trusted = {
            **payload,
            "authority_epoch": self._interaction.epoch,
            "authority_lease": authority.lease_id if owns and authority is not None else None,
            "authority_revision": self._interaction.revision,
            "authority_deadline": authority.expires_at
            if owns and authority is not None
            else time.monotonic() + 0.5,
            "target_revision": target["revision"] if target is not None else 0,
        }
        if request.action in {"execute", "reset_joints", "prepare_shutdown"}:
            if self._interaction.motion_busy:
                self._ws_server.schedule_send_to_client(
                    client_id,
                    encode_text(
                        {
                            "type": "manipulation_result",
                            "request_id": request.request_id,
                            "action": request.action,
                            "group_id": request.group_id,
                            "status": "rejected",
                            "code": "busy",
                        }
                    ),
                )
                return
            self._pending_arm_motion.add(request.request_id)
            self._interaction.set_motion_busy(True)
        service.submit(replace(request, payload=trusted), client_id, clock_offset)

    async def handle_global_costmap(self, msg: OccupancyGrid) -> None:
        await self._previews.update_costmap(msg)
        self._broadcast_state()

    def _on_estop_request(self, _msg: EstopRequest, _websocket: ws_server.ServerConnection) -> None:
        if not self._capabilities.supports(CapabilityName.ESTOP):
            return
        self._interaction.stop()
        if self._manipulation_service is not None:
            self._arm_stop_pending = True
            self._interaction.set_motion_busy(True)
            self._manipulation_service.emergency_stop(
                self._interaction.epoch, self._interaction.revision
            )
        self._drain_interaction_retirements()
        self._cancel_tele_cmd_vel()
        self._broadcast_interaction()
        self._safety.on_estop_request()
        # A goal can be accepted before native path following starts. Publish
        # the stop fact even when the legacy navigation phase was already idle.
        self._broadcast_state()

    def _update_lidar_aggregate(self) -> None:
        active = [settings for settings in self._lidar_subscriptions.values() if settings.enabled]
        self._lidar_settings = LidarSettings(
            enabled=bool(active),
            min_height_m=min((s.min_height_m for s in active), default=0.1),
            max_height_m=max((s.max_height_m for s in active), default=1.5),
            max_range_m=max((s.max_range_m for s in active), default=5.0),
        )

    def _on_lidar_settings_request(
        self,
        msg: LidarSettingsRequest,
        _websocket: ws_server.ServerConnection,
        client_id: str | None = None,
    ) -> None:
        if not self._capabilities.supports(CapabilityName.LIDAR):
            return
        settings = LidarSettings(msg.enabled, msg.min_height_m, msg.max_height_m, msg.max_range_m)
        if client_id is None:
            self._lidar_settings = settings
        elif client_id in self._lidar_subscriptions:
            self._lidar_subscriptions[client_id] = settings
            self._update_lidar_aggregate()
        self._broadcast_state()

    def _on_state_request(
        self,
        _msg: StateRequest,
        _websocket: ws_server.ServerConnection,
    ) -> None:
        self._broadcast_state()
        self._broadcast_interaction(force=True)

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
        if (
            self._mode_task is not None
            or self._native_mode_uncertain
            or self._interaction.mode != "agent"
            or self._interaction.authority is not None
        ):
            return
        if not self._agent_service.begin_turn(client_id):
            return
        self._interaction.agent_busy = True
        try:
            self.human_input.publish(msg.text)
        except Exception:
            self._agent_service.cancel_turn(client_id)
            self._interaction.agent_busy = False
            raise
        logger.info("human_input published", client_id=client_id, chars=len(msg.text))

    def _on_client_pose(
        self,
        msg: ClientPose,
        _websocket: ws_server.ServerConnection,
        _client_id: str,
    ) -> None:
        self._agent_service.set_pose(msg, client_id=_client_id)

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
        if not self._native_authorized(_client_id, msg, "joystick"):
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

    def _robot_heading(self) -> float:
        sample = self._odometry.history.latest()
        if sample is None:
            return 0.0
        x, y, z, w = sample.orientation
        return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))

    def _on_localization_progress(
        self,
        message: LocalizationTracking | LocalizationCaptureProgress,
        client_id: str,
        sync: TimeSync,
    ) -> None:
        if self._map_localization is not None:
            self._map_localization.progress(message, client_id, sync)

    def _on_localization_start_request(
        self, _msg: LocalizationStartRequest, client_id: str
    ) -> None:
        if self._map_localization is not None:
            self._map_localization.manual(client_id)
            return
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
        if self._map_localization is not None:
            self._map_localization.observations(domain, client_id)
            return
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
            capture_heading_rad=None
            if pose is None
            else math.atan2(
                2
                * (
                    pose.orientation[3] * pose.orientation[2]
                    + pose.orientation[0] * pose.orientation[1]
                ),
                1 - 2 * (pose.orientation[1] ** 2 + pose.orientation[2] ** 2),
            ),
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
        self._policy.on_success(
            work.client_id,
            capture_travel_m=work.capture_travel_m,
            capture_heading_rad=work.capture_heading_rad,
        )
        self._ws_server.schedule_send_to_client(
            work.client_id, encode_localization_result(outcome.result)
        )

    def _clear_navigation(self) -> bool:
        if self._navigation_service is not None:
            self._navigation_service.cancel()
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
        await self._state_publisher.publish_lidar_async(msg, lidar=self._lidar_settings)

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
        # Retire native work against the old reference before replacing its epoch.
        self._interaction.stop("reference_reset")
        self._drain_interaction_retirements()
        if self._manipulation_service is not None:
            self._arm_stop_pending = True
            self._interaction.set_motion_busy(True)
            self._manipulation_service.emergency_stop(
                self._interaction.epoch, self._interaction.revision
            )
        self._interaction.reset()
        self._broadcast_interaction()
        self._odometry.retire()
        publisher = getattr(self, "_state_publisher", None)
        if publisher is not None and hasattr(publisher, "invalidate_source"):
            publisher.invalidate_source()
        self._previews.cancel_all()
        self._requires_mapping_restart = True
        self._localization_runner.cancel_all()
        self._coordinator.invalidate_source()
        if self._map_localization is not None:
            self._map_localization.reset()
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
        # Receipt-time pairing remains approximate; require surrounding odometry
        # rather than guessing from the latest pose or requiring a stationary robot.
        deadline = time.monotonic() + 0.2
        while self._odometry.history.at_image_ts(timestamp) is None:
            if generation != self._odometry.generation or time.monotonic() >= deadline:
                self._pairing_rejected += 1
                self._log_camera_pairing()
                return
            await asyncio.sleep(0.01)
        poses = self._odometry.history.snapshot()
        pose = poses.at_image_ts(timestamp)
        if pose is None:
            return
        sample = await self._localization_worker.run_if_idle(
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
            self._pairing_accepted += 1
            self._log_camera_pairing()

    def _log_camera_pairing(self) -> None:
        if time.monotonic() < self._pairing_log_at:
            return
        self._pairing_log_at = time.monotonic() + 30.0
        logger.info(
            "robot camera pose pairing",
            accepted=self._pairing_accepted,
            rejected=self._pairing_rejected,
            max_bracket_ms=200,
            timestamp_kind="receipt",
            **self._odometry.history.timing_diagnostics(),
        )
        self._pairing_accepted = 0
        self._pairing_rejected = 0

    @staticmethod
    def _navigation_payload(frame: NavGoalFrame) -> dict[str, Any]:
        return {
            "type": "nav_goal",
            "ts": frame.ts,
            **({"pose": frame.pose} if frame.pose is not None else {}),
            "path_poses": frame.path_poses,
            **({"preview": True} if frame.preview else {}),
            **({"preview_id": frame.preview_id} if frame.preview_id is not None else {}),
        }

    async def handle_path(self, msg: Path) -> None:
        if not self._capabilities.supports(CapabilityName.NAVIGATION):
            return
        nav_goal_frame, state_changed = self._nav_goal_coordinator.on_path(msg)
        if nav_goal_frame is not None:
            epoch = self._interaction.epoch
            body = await self._ws_server.prepare_outbound_async(
                self._navigation_payload(nav_goal_frame)
            )
            if epoch != self._interaction.epoch or not self._nav_goal_coordinator.accepts_path(
                nav_goal_frame.ts
            ):
                return
            self._interaction.set_active_goal(body)
            self._ws_server.schedule_broadcast_text(encode_text(body))
            self._broadcast_interaction()
        if state_changed:
            self._broadcast_state()

    async def handle_goal_reached(self, msg: Bool) -> None:
        if not self._capabilities.supports(CapabilityName.NAVIGATION):
            return
        if not self._nav_goal_coordinator.on_goal_reached(msg):
            return
        self._finish_navigation(msg.data)

    async def handle_ar_navigation_status(self, msg: String) -> None:
        if not self._capabilities.supports(CapabilityName.NAVIGATION):
            return
        try:
            body = json.loads(msg.data)
        except (ValueError, TypeError):
            return
        if not isinstance(body, dict):
            return
        stamp, phase = body.get("goal_ts"), body.get("phase")
        if (
            isinstance(stamp, bool)
            or not isinstance(stamp, (int, float))
            or not math.isfinite(stamp)
            or not isinstance(phase, str)
            or phase not in {"accepted", "succeeded", "failed"}
        ):
            return
        if self._nav_goal_coordinator.on_native_status(float(stamp), phase):
            self._finish_navigation(phase == "succeeded")

    def _finish_navigation(self, succeeded: bool) -> None:
        self._interaction.set_active_goal(None)
        self._broadcast_interaction()
        self._broadcast_state()
        if succeeded:
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
        changed = self._agent_service.update_idle(bool(msg))
        self._interaction.agent_busy = not self._agent_service.idle
        if changed:
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
