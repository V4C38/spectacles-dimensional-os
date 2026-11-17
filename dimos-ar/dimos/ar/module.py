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
from dimos.ar.async_execution import BoundedWorker
from dimos.ar.localization.coordinator import LocalizationCoordinator
from dimos.ar.localization.defaults import LOCALIZATION_POLICY_DEFAULTS
from dimos.ar.localization.fiducial_marker.localizer import FiducialMarkerLocalizer
from dimos.ar.localization.native import NativeMapAdapter, NativeMapSample
from dimos.ar.localization.types import AsyncLocalizer, LocalizationProviderType, SnapshotLocalizer
from dimos.ar.localization.vps.admission import VpsAdmission
from dimos.ar.localization.vps.localizer import VpsLocalizer
from dimos.ar.localization.vps.multiset_client import MultisetVpsClient, MultisetVpsClientConfig
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.manipulation.model import ReferencePose
from dimos.ar.manipulation.protocol import ARManipulationSpec, ManipulationRequest
from dimos.ar.manipulation.service import ManipulationService
from dimos.ar.navigation.control import (
    ARNavigationControlSpec,
    NavGoalCoordinator,
    NavigationControlService,
    TeleCmdVelPublisher,
)
from dimos.ar.navigation.preview import NavigationPreviewService, PreviewPlanner
from dimos.ar.navigation.types import NavGoalRequest, NavJoystickRequest, NavState
from dimos.ar.numeric import quaternion_yaw
from dimos.ar.replication.controller import InteractionController, InteractionPorts
from dimos.ar.replication.interaction import (
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
from dimos.ar.robot.emergency_stop import EmergencyStopController
from dimos.ar.robot.odometry import RobotOdometry, RobotSourceChangedError
from dimos.ar.robot.profiles.profile import (
    FiducialMarkerMount,
    RobotName,
    RobotProfile,
    get_profile,
)
from dimos.ar.robot.state_publisher import RobotStatePublisher
from dimos.ar.sensors.lidar_settings import DEFAULT_LIDAR_SETTINGS, LidarSettings
from dimos.ar.spatial import FrameSnapshot, transform_pose
from dimos.ar.websocket.protocol import (
    AgentState,
    ClientPose,
    EstopRequest,
    HelloBody,
    LidarSettingsRequest,
    LocalizationCaptureProgress,
    LocalizationObservation,
    LocalizationStartRequest,
    LocalizationTracking,
    ResumeOperationRequest,
    StateRequest,
    StateSnapshot,
    TimeSync,
    UserMessageRequest,
    encode_pose,
    encode_state,
    encode_text,
    navigation_payload,
    observation_from_localization,
)
from dimos.ar.websocket.server import WebSocketServer
from dimos.ar.websocket.server_discovery import DEFAULT_IP_RELAY_URL, server_info
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
EPISODE_TIMEOUT_S = 12.0


class LocalizationProviderConfig(BaseModel):
    type: Literal["fiducial_marker", "vps"]
    map_code: str | None = None


class LocalizationConfig(BaseModel):
    providers: list[LocalizationProviderConfig] = Field(default_factory=list)
    native_map_file: str | None = None
    travel_threshold_m: float = Field(
        default=LOCALIZATION_POLICY_DEFAULTS["travel_threshold_m"], gt=0, allow_inf_nan=False
    )
    heading_threshold_deg: float = Field(
        default=LOCALIZATION_POLICY_DEFAULTS["heading_threshold_deg"],
        gt=0,
        le=180,
        allow_inf_nan=False,
    )
    marker_preference_s: float = Field(
        default=LOCALIZATION_POLICY_DEFAULTS["marker_preference_s"], ge=0, allow_inf_nan=False
    )
    headset_travel_threshold_m: float = Field(
        default=LOCALIZATION_POLICY_DEFAULTS["headset_travel_threshold_m"],
        gt=0,
        allow_inf_nan=False,
    )
    episode_timeout_s: float = Field(default=EPISODE_TIMEOUT_S, gt=0, allow_inf_nan=False)


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
    _recording_source: ClassVar[bool] = False

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    global_costmap: In[OccupancyGrid]
    tf: In[TFMessage]
    path: In[Path]
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
    _localization: LocalizationCoordinator
    _robot_observations: RobotObservationBuffer
    _profile: RobotProfile
    _capabilities: CapabilitySet
    _safety: EmergencyStopController
    _tele_cmd_vel_publisher: TeleCmdVelPublisher | None
    _lidar_settings: LidarSettings
    _odometry: RobotOdometry
    _previews: NavigationPreviewService
    _agent_service: ARAgentService
    _agent_control: ARAgentControlSpec | None = None
    _navigation_control: ARNavigationControlSpec | None = None
    _navigation_service: NavigationControlService | None = None
    _manipulation: ARManipulationSpec | None = None
    _manipulation_service: ManipulationService | None = None
    _interaction_controller: InteractionController
    _stationary_task: asyncio.Task[None] | None = None
    _resume_task: asyncio.Task[None] | None = None

    @rpc
    def build(self) -> None:
        self._ar_built = False
        self._build_failure: BaseException | None = None
        try:
            super().build()
            assert self._loop is not None
            self._profile = profile_for_config(self.config)
            if self._navigation_control is not None:
                self._navigation_service = NavigationControlService(
                    self._navigation_control,
                    lambda: (
                        self._interaction_controller.state.epoch,
                        self._interaction_controller.state.revision,
                    ),
                    self._native_navigation_failed,
                    on_recovered=self._broadcast_state,
                )
            self._lidar_settings = DEFAULT_LIDAR_SETTINGS
            self._lidar_subscriptions: dict[str, LidarSettings] = {}
            self._localization_worker = BoundedWorker()
            self._vps_admission = VpsAdmission()
            self._pairing_log_at = 0.0
            self._pairing_rejected = 0
            self._pairing_accepted = 0
            self._navigation_projection_task: asyncio.Task[None] | None = None
            self._replay_mode = (
                self._recording_source
                or bool(getattr(global_config, "replay", False))
                or getattr(global_config, "unitree_connection_type", None) == "replay"
                or global_config.robot_ip in ("fake", "mock", "replay")
            )
            self._odometry = RobotOdometry(
                recording=self._replay_mode
            )
            self._requires_mapping_restart = False
            self._ws_server = WebSocketServer(
                port=self.config.port,
                relay_url=self.config.ip_relay_url,
                loop=self._loop,
                hello_supplier=self._hello_body,
                presence_context=self._spatial_context,
                on_connect=self._on_client_connect,
                on_nav_goal_request=self._on_nav_goal_request,
                on_estop_request=self._on_estop_request,
                on_resume_operation_request=self._on_resume_operation_request,
                on_lidar_settings_request=self._on_lidar_settings_request,
                on_state_request=self._on_state_request,
                on_localization_start_request=self._on_localization_start_request,
                on_localization_observations=self._on_localization_observations,
                on_user_message_request=self._on_user_message_request,
                on_client_pose=self._on_client_pose,
                on_localization_progress=self._on_localization_progress,
                on_nav_joystick_request=self._on_nav_joystick_request,
                on_disconnect=self._on_client_disconnect,
                on_suspend=self._on_client_suspend,
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
                    frames=lambda: self._localization.frames,
                    control_state=lambda: (
                        self._interaction_controller.state.epoch,
                        self._interaction_controller.state.revision,
                    ),
                    prepare_outbound=self._ws_server.prepare_outbound_async,
                )
            self._nav_goal_coordinator = NavGoalCoordinator(
                frames=lambda: self._localization.frames,
            )
            self._previews = NavigationPreviewService(
                PreviewPlanner(global_config),
                frames=lambda: self._localization.frames,
                odometry=self._odometry.latest,
                on_preview=self._on_navigation_preview,
            )
            self._agent_service = ARAgentService(
                frames=lambda: self._localization.frames,
                connection_count=lambda: self._ws_server.connection_count,
                broadcast=self._ws_server.schedule_broadcast_text,
            )
            self._state_publisher = RobotStatePublisher(
                self._ws_server,
                frames=lambda: self._localization.frames,
                robot_position=self._odometry.native_position,
                subscriptions=lambda: dict(self._lidar_subscriptions),
            )
            self._robot_observations = RobotObservationBuffer(
                pose_buffer=self._odometry.history,
                T_base_camera_optical=self._profile.T_base_camera_optical,
            )
            marker, vps, map_code = self._build_localizers()
            self._capabilities = CapabilitySet.from_supported(
                self._profile.supported_capabilities,
                localization_available=bool(self.config.localization.providers),
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
            self._safety = EmergencyStopController(
                estop_available=self._capabilities.supports(CapabilityName.ESTOP),
                effects=(self._clear_navigation, self._publish_stop),
                manipulation=self._manipulation_service is not None,
            )
            self._localization = LocalizationCoordinator(
                odometry=self._odometry,
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
                allow_latest_robot_pose=self._replay_mode,
                on_frame_change=self._on_frame_change,
            )
            self._native_map = (
                NativeMapAdapter(native_map_id=self.config.localization.native_map_file)
                if self.config.localization.native_map_file else None
            )
            self._interaction_controller = self._build_interaction_controller()
            logger.info("ARModule build complete")
            self._ar_built = True
        except BaseException as exc:
            self._build_failure = exc
            raise

    def _build_interaction_controller(self) -> InteractionController:
        return InteractionController(
            InteractionPorts(
                capabilities=lambda: self._capabilities,
                mapping_restart_required=lambda: getattr(self, "_requires_mapping_restart", False),
                manipulation=lambda: self._manipulation_service,
                agent_control=lambda: self._agent_control,
                agent_idle=lambda: self._agent_service.idle,
                previews=lambda: self._previews,
                commit_target=self._commit_shared_target,
                submit_goal=self._submit_navigation_goal,
                cancel_joystick=self._cancel_tele_cmd_vel,
                stop_navigation=lambda: self._safety.controlled_stop(),
                operation_stopped=lambda: self._safety.stopped,
                retire_navigation=lambda: self._nav_goal_coordinator.on_estop(),
                broadcast_state=self._broadcast_state,
                send=lambda client, text: self._ws_server.schedule_send_to_client(client, text),
                broadcast=lambda text: self._ws_server.schedule_broadcast_text(text),
                prepare_outbound=lambda body: self._ws_server.prepare_outbound_async(body),
            )
        )

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
        if not getattr(self, "_ar_built", False):
            failure = getattr(self, "_build_failure", None)
            raise RuntimeError(f"ARModule build did not complete: {failure}") from failure
        super().start()
        self._loop.call_soon_threadsafe(self._localization.start)
        self._loop.call_soon_threadsafe(self._start_native_map)
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
        projection = getattr(self, "_navigation_projection_task", None)
        if projection is not None:
            self._loop.call_soon_threadsafe(projection.cancel)
        if self._stationary_task is not None:
            self._loop.call_soon_threadsafe(self._stationary_task.cancel)
        if self._resume_task is not None:
            self._loop.call_soon_threadsafe(self._resume_task.cancel)
        for name, service in (
            ("interaction", getattr(self, "_interaction_controller", None)),
            ("navigation", getattr(self, "_navigation_service", None)),
            (
                "telemetry",
                getattr(self, "_state_publisher", None)
                if hasattr(getattr(self, "_state_publisher", None), "close")
                else None,
            ),
            ("manipulation", getattr(self, "_manipulation_service", None)),
            ("preview", getattr(self, "_previews", None)),
            ("localization", getattr(self, "_localization", None)),
            ("native map", getattr(self, "_native_map", None)),
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
        worker = getattr(self, "_localization_worker", None)
        if worker is not None:
            worker.close()
        ws_server_obj = getattr(self, "_ws_server", None)
        if ws_server_obj is not None:
            ws_server_obj.stop()
        super().stop()

    def _spatial_context(self) -> dict[str, str]:
        frames = self._localization.frames
        return {
            "shared_frame_id": frames.shared_frame_id,
            "odom_reference_id": frames.odom_reference_id,
        }

    def _start_native_map(self) -> None:
        if self._native_map is not None:
            self._native_map.start(self.tfbuffer, self._accept_native_map)

    def _accept_native_map(self, sample: NativeMapSample) -> bool:
        if self._odometry.latest() is None or self._requires_mapping_restart:
            return False
        self._localization.on_native_reference(
            sample.T_native_odom,
            ts_server=sample.ts_server,
            native_map_id=sample.native_map_id,
        )
        return True

    def _on_frame_change(self, frames: FrameSnapshot, rebase: Any | None) -> None:
        self._previews.cancel_all()
        self._state_publisher.invalidate_source()
        if self._manipulation_service is not None:
            self._manipulation_service.frame_changed()
        if rebase is not None:
            self._interaction_controller.rebase_shared_frame(
                rebase, shared_frame_id=frames.shared_frame_id
            )
            self._agent_service.rebase_shared_frame(rebase)
            self._ws_server.rebase_shared_frame(rebase, self._spatial_context())
        else:
            self._interaction_controller.frame_changed()
        if self._navigation_projection_task is not None:
            self._navigation_projection_task.cancel()
        active = self._nav_goal_coordinator.refresh_projection()
        if active is not None:
            self._interaction_controller.state.set_active_goal(None)
            self._navigation_projection_task = self._loop.create_task(
                self._publish_navigation_projection(active, frames)
            )
            self._navigation_projection_task.add_done_callback(self._navigation_projection_done)
        self._loop.call_soon(self._broadcast_interaction)

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
            localization={"providers": [LocalizationProviderType(p.type) for p in self.config.localization.providers]},
            shared_frame_id=self._localization.frames.shared_frame_id,
        )

    def _state_snapshot(self) -> StateSnapshot:
        idle = True
        if self._capabilities.supports(CapabilityName.AGENT):
            idle = self._agent_service.idle
        safety = self._safety.snapshot()
        if (
            self._interaction_controller.mode_task is not None
            or self._interaction_controller.native_mode_uncertain
            or (
                isinstance(self._navigation_service, NavigationControlService)
                and (self._navigation_service.faulted or self._navigation_service.stop_pending)
            )
        ):
            safety["can_resume"] = False
        return StateSnapshot(
            connected_clients=self._ws_server.connection_count,
            lidar=self._lidar_settings,
            nav=NavState("resolved", "failed")
            if isinstance(self._navigation_service, NavigationControlService)
            and self._navigation_service.faulted
            else self._nav_goal_coordinator.nav_state(),
            agent=AgentState(idle=idle),
            nav_preview_costmap_ts=self._previews.costmap_ts,
            safety=safety,
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

    def _on_client_connect(
        self,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        logger.info("AR client session ready", client_id=client_id)
        self._interaction_controller.state.connect(client_id)
        self._lidar_subscriptions.setdefault(client_id, DEFAULT_LIDAR_SETTINGS)
        if self._manipulation_service is not None:
            self._manipulation_service.connect(client_id)
        self._ws_server.schedule_send_to_client(
            client_id, encode_text(self._interaction_controller.state.snapshot())
        )
        for marker in self._agent_service.marker_snapshot():
            self._ws_server.schedule_send_to_client(client_id, marker)
        self._broadcast_state()
        if self._replay_mode or self.config.stationary_base is not None:
            pose = self._odometry.history.latest()
            if pose is not None:
                # Preserve the source timestamp while projecting into the current shared map.
                frames = self._localization.frames
                position, orientation = transform_pose(
                    frames.T_map_odom, pose.position, pose.orientation
                )
                self._ws_server.schedule_send_to_client(
                    client_id,
                    encode_pose(
                        position=position,
                        orientation=orientation,
                        ts=pose.ts_server,
                        shared_frame_id=frames.shared_frame_id,
                    ),
                )
        self._localization.connect(client_id)

    def _on_client_suspend(self, client_id: str, deadline: float) -> None:
        if (
            self._interaction_controller.state.suspend(client_id, deadline)
            and self._manipulation_service is not None
        ):
            self._manipulation_service.suspend(client_id, deadline)

    def _on_client_disconnect(self, _websocket: ws_server.ServerConnection, client_id: str) -> None:
        self._previews.cancel(client_id)
        self._interaction_controller.state.disconnect(client_id)
        self._lidar_subscriptions.pop(client_id, None)
        self._update_lidar_aggregate()
        if self._manipulation_service is not None:
            self._manipulation_service.disconnect(client_id)
        self._drain_interaction_retirements()
        self._agent_service.disconnect(client_id)
        self._broadcast_interaction()
        self._localization.disconnect(client_id)
        if self._ws_server.logical_session_count == 0:
            self._interaction_controller.state.stop("last_disconnect")
            self._interaction_controller.stop_agent()
            if self._manipulation_service is not None:
                state = self._interaction_controller.state
                request_id = f"disconnect-stop-{state.epoch}-{state.revision}"
                state.begin_manipulation_motion(request_id)
                self._manipulation_service.controlled_stop(
                    state.epoch,
                    state.revision,
                    request_id,
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
        self._interaction_controller.start()

    def _broadcast_interaction(self, *, force: bool = False) -> None:
        return self._interaction_controller.broadcast(force=force)

    def _drain_interaction_retirements(self) -> None:
        return self._interaction_controller.drain_retirements()

    def _on_interaction_request(self, request: InteractionRequest, client_id: str) -> None:
        return self._interaction_controller.handle_request(request, client_id)

    def _commit_shared_target(self, target: SharedTarget, kind: InteractionKind) -> bool:
        if kind == "joystick":
            self._cancel_tele_cmd_vel()
            return True
        return self._submit_navigation_goal(NavGoalRequest(target.position, target.orientation))

    def _submit_navigation_goal(self, msg: NavGoalRequest) -> bool:
        service = self._navigation_service
        if service is None or self._safety.stopped or getattr(self, "_requires_mapping_restart", False):
            return False
        if isinstance(service, NavigationControlService) and (service.stop_pending or service.faulted):
            return False
        goal = self._nav_goal_coordinator.submit_goal(msg)
        self._broadcast_state()
        if not service.submit(
            goal,
            self._interaction_controller.state.epoch,
            self._interaction_controller.state.revision,
        ):
            return False
        yaw = PoseStamped(position=list(msg.position), orientation=list(msg.orientation)).yaw
        self._interaction_controller.state.set_active_goal(
            {"type": "nav_goal", "shared_frame_id": self._localization.frames.shared_frame_id,
             "pose": [*msg.position, yaw], "path_poses": [], "ts": time.time()}
        )
        return True

    def _native_navigation_failed(self, goal_ts: float) -> None:
        if self._nav_goal_coordinator.on_native_status(goal_ts, "failed"):
            self._interaction_controller.state.set_active_goal(None)
            self._publish_stop()
            self._broadcast_interaction(force=True)
            self._broadcast_state()

    def _native_authorized(
        self, client_id: str, msg: NavGoalRequest | NavJoystickRequest, kind: InteractionKind
    ) -> bool:
        return self._interaction_controller.authorize_native(client_id, msg, kind)

    def _on_nav_goal_request(
        self, msg: NavGoalRequest, _websocket: ws_server.ServerConnection, client_id: str
    ) -> None:
        return self._interaction_controller.handle_navigation(msg, _websocket, client_id)

    async def _on_navigation_preview(
        self, client_id: str, request: NavGoalRequest, frame: object
    ) -> None:
        # The worker may complete after release, expiry, handover or aim changes.
        return await self._interaction_controller.observe_preview(client_id, request, frame)

    def _on_manipulation_snapshot(self, snapshot: dict[str, Any]) -> None:
        previous = self._safety.snapshot()
        self._safety.observe_manipulation(snapshot)
        self._interaction_controller.observe_manipulation_snapshot(snapshot)
        if previous != self._safety.snapshot():
            self._broadcast_state()

    def _on_manipulation_result(self, request: ManipulationRequest, result: dict[str, Any]) -> None:
        return self._interaction_controller.observe_manipulation_result(request, result)

    def _on_manipulation_request(
        self, request: ManipulationRequest, client_id: str, clock_offset: float
    ) -> None:
        return self._interaction_controller.handle_manipulation(request, client_id, clock_offset)

    async def handle_global_costmap(self, msg: OccupancyGrid) -> None:
        await self._previews.update_costmap(msg)
        self._broadcast_state()

    def _on_estop_request(self, _msg: EstopRequest, _websocket: ws_server.ServerConnection) -> None:
        if not self._capabilities.supports(CapabilityName.ESTOP):
            return
        self._interaction_controller.state.stop()
        if self._manipulation_service is not None:
            self._interaction_controller.state.request_manipulation_stop()
            self._manipulation_service.emergency_stop(
                self._interaction_controller.state.epoch,
                self._interaction_controller.state.revision,
            )
        self._drain_interaction_retirements()
        self._cancel_tele_cmd_vel()
        self._broadcast_interaction()
        self._safety.on_estop_request()
        self._interaction_controller.stop_agent()
        # A goal can be accepted before native path following starts. Publish
        # the stop fact even when the legacy navigation phase was already idle.
        self._broadcast_state()

    def _on_resume_operation_request(self, msg: ResumeOperationRequest, client_id: str) -> None:
        state = self._interaction_controller.state
        if (
            not self._capabilities.supports(CapabilityName.ESTOP)
            or msg.epoch != state.epoch
            or state.authority is not None
            or self._interaction_controller.mode_task is not None
            or self._interaction_controller.native_mode_uncertain
            or self._resume_task is not None
            or (
                isinstance(self._navigation_service, NavigationControlService)
                and (self._navigation_service.faulted or self._navigation_service.stop_pending)
            )
            or not self._safety.begin_resume(msg.stop_id)
        ):
            return
        if self._manipulation_service is None:
            self._safety.finish_resume(msg.stop_id, succeeded=True)
            self._broadcast_state()
            return
        self._broadcast_state()
        revision = state.reserve_manipulation_resume()
        self._resume_task = asyncio.create_task(
            self._resume_manipulation_operation(msg.stop_id, client_id, msg.epoch, revision)
        )

    async def _resume_manipulation_operation(
        self, stop_id: str, client_id: str, epoch: str, revision: int
    ) -> None:
        succeeded = False
        try:
            service = self._manipulation_service
            if service is not None:
                succeeded = await service.resume_operation(client_id, epoch, revision)
        except Exception:
            logger.exception("Resume operation failed")
        finally:
            self._safety.finish_resume(stop_id, succeeded=succeeded)
            self._resume_task = None
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
        if not self._interaction_controller.agent_input_available:
            return
        if not self._agent_service.begin_turn(client_id):
            return
        self._interaction_controller.state.set_agent_busy(True)
        try:
            self.human_input.publish(msg.text)
        except Exception:
            self._agent_service.cancel_turn(client_id)
            self._interaction_controller.state.set_agent_busy(False)
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
        ) or self._safety.stopped:
            return
        service = self._navigation_service
        if isinstance(service, NavigationControlService) and (service.stop_pending or service.faulted):
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
        return quaternion_yaw((x, y, z, w))

    def _on_localization_progress(
        self,
        message: LocalizationTracking | LocalizationCaptureProgress,
        client_id: str,
        sync: TimeSync,
    ) -> None:
        self._localization.progress(message, client_id, sync)

    def _on_localization_start_request(
        self, _msg: LocalizationStartRequest, client_id: str
    ) -> None:
        self._localization.manual(client_id)

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
        self._localization.observations(domain, client_id)

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
        self._state_publisher.publish_odom(accepted.sample)
        self._robot_observations.expire(self._odometry.travel())

    def _retire_robot_source(self) -> None:
        # Retire native work against the old reference before replacing its epoch.
        self._interaction_controller.state.stop("reference_reset")
        self._drain_interaction_retirements()
        if self._manipulation_service is not None:
            self._interaction_controller.state.request_manipulation_stop()
            self._manipulation_service.emergency_stop(
                self._interaction_controller.state.epoch,
                self._interaction_controller.state.revision,
            )
        self._interaction_controller.state.reset()
        self._broadcast_interaction()
        self._odometry.retire()
        publisher = getattr(self, "_state_publisher", None)
        if publisher is not None and hasattr(publisher, "invalidate_source"):
            publisher.invalidate_source()
        self._previews.cancel_all()
        self._requires_mapping_restart = True
        self._robot_observations.clear()
        self._localization.reset()
        if self._native_map is not None:
            self._native_map.reset()
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
            or not any(p.type == "vps" for p in self.config.localization.providers)
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
        frames = self._localization.frames
        sample = await self._localization_worker.run_if_idle(
            lambda: self._robot_observations.prepare_image(
                msg,
                ts_server=timestamp,
                travel_m=pose.travel_m,
                pose_buffer=poses,
                source_generation=generation,
                frames=frames,
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

    def _navigation_projection_done(self, task: asyncio.Task[None]) -> None:
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.error("Navigation projection failed", error=type(error).__name__)

    async def _publish_navigation_projection(
        self, nav_goal_frame: Any, frames: FrameSnapshot
    ) -> None:
        epoch = self._interaction_controller.state.epoch
        body = await self._ws_server.prepare_outbound_async(navigation_payload(nav_goal_frame))
        if (
            epoch != self._interaction_controller.state.epoch
            or frames.revision != self._localization.frames.revision
            or frames.shared_frame_id != self._localization.frames.shared_frame_id
            or not self._nav_goal_coordinator.accepts_path(nav_goal_frame.ts)
        ):
            return
        self._interaction_controller.state.set_active_goal(body)
        self._broadcast_interaction()

    async def handle_path(self, msg: Path) -> None:
        if not self._capabilities.supports(CapabilityName.NAVIGATION):
            return
        nav_goal_frame, state_changed = self._nav_goal_coordinator.on_path(msg)
        if nav_goal_frame is not None:
            await self._publish_navigation_projection(nav_goal_frame, self._localization.frames)
        if state_changed:
            self._broadcast_state()

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
        self._interaction_controller.state.set_active_goal(None)
        self._broadcast_interaction()
        self._broadcast_state()
        self._localization.on_goal_reached(succeeded=succeeded)

    async def handle_agent(self, msg: BaseMessage) -> None:
        if not self._capabilities.supports(CapabilityName.AGENT):
            return
        self._agent_service.forward(msg)

    async def handle_agent_idle(self, msg: bool) -> None:
        if not self._capabilities.supports(CapabilityName.AGENT):
            return
        changed = self._agent_service.update_idle(bool(msg))
        self._interaction_controller.state.set_agent_busy(
            self._interaction_controller.mode_task is not None or not self._agent_service.idle
        )
        if changed:
            self._broadcast_state()

    @skill
    def ar_place_marker(self, id: str, x: float, y: float, z: float, title: str = "") -> str:
        """Place or replace a marker in the AR client's world at an odom-frame point.

        Input uses native DimOS odometry, matching mapping and agent perception.
        ARModule projects the native point into the shared map at the wire boundary.
        `id` is the handle, not the label. An omitted or empty title leaves the
        marker unlabeled. The same id upserts.

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

        Position and viewing ray are projected from the shared map into native odometry.
        Position and orientation describe the physical optical frame in native odom.
        Uses the inbound client_pose buffer; missing or older than 2 s returns No client pose.
        Broadcasts nothing.
        """
        return self._agent_service.client_pose()
