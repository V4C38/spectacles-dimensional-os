from __future__ import annotations

import asyncio
import math
import time
from typing import ClassVar, Literal

from dimos_lcm.std_msgs import Bool
from langchain_core.messages import AIMessage
from langchain_core.messages.base import BaseMessage
from pydantic import BaseModel, Field
import websockets.asyncio.server as ws_server

from dimos.agents.annotation import skill
from dimos.ar.localization.coordinator import LocalizationCoordinator, LocalizationOutcome
from dimos.ar.localization.fiducial_marker.localizer import FiducialMarkerLocalizer
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.policy import EpisodeWork, LocalizationPolicy
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.types import Localizer
from dimos.ar.localization.vps.localizer import VpsLocalizer
from dimos.ar.localization.vps.multiset_client import MultisetVpsClient, MultisetVpsClientConfig
from dimos.ar.localization.vps.robot_observation_buffer import RobotObservationBuffer
from dimos.ar.navigation.coordinator import NavGoalCoordinator
from dimos.ar.navigation.tele_cmd_vel import TeleCmdVelPublisher
from dimos.ar.navigation.types import NavGoalRequest, NavJoystickRequest
from dimos.ar.robot.capabilities import NAV_GOAL, NAV_JOYSTICK, CapabilityName, CapabilitySet
from dimos.ar.robot.odometry_correction import correct_odom_xy
from dimos.ar.robot.profiles import RobotName, RobotProfile, get_profile
from dimos.ar.robot.safety import Safety
from dimos.ar.robot.state_publisher import RobotStatePublisher
from dimos.ar.sensors.lidar_settings import DEFAULT_LIDAR_SETTINGS, LidarSettings
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
    encode_agent_message,
    encode_agent_skill,
    encode_localization_observations_request,
    encode_localization_result,
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
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

CLIENT_POSE_STALE_S = 2.0
MARKER_ID_MAX_LEN = 64


def _textual_ai_message(msg: BaseMessage) -> str | None:
    if not isinstance(msg, AIMessage):
        return None
    content = msg.content
    if isinstance(content, str):
        text = content.strip()
        return text or None
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str) and block.strip():
                parts.append(block.strip())
            elif isinstance(block, dict) and block.get("type") == "text":
                text = str(block.get("text", "")).strip()
                if text:
                    parts.append(text)
        joined = "\n".join(parts).strip()
        return joined or None
    return None


class LocalizationProviderConfig(BaseModel):
    type: Literal["fiducial_marker", "vps"]
    map_code: str | None = None


class LocalizationConfig(BaseModel):
    providers: list[LocalizationProviderConfig] = Field(default_factory=list)


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    robot: RobotName = RobotName.UNITREE_GO2
    port: int = 8787
    localization: LocalizationConfig = Field(default_factory=LocalizationConfig)
    agent: bool = False


class ARModule(Module):  # type: ignore[misc]
    dedicated_worker: ClassVar[bool] = True

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
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

    _ws_server: WebSocketServer
    _state_publisher: RobotStatePublisher
    _nav_goal_coordinator: NavGoalCoordinator
    _pose_buffer: PoseBuffer
    _policy: LocalizationPolicy
    _coordinator: LocalizationCoordinator
    _robot_observations: RobotObservationBuffer
    _profile: RobotProfile
    _capabilities: CapabilitySet
    _safety: Safety
    _tele_cmd_vel_publisher: TeleCmdVelPublisher | None
    _lidar_settings: LidarSettings
    _speed_mps: float
    _agent_idle: bool
    _client_pose: ClientPose | None
    _client_pose_received_at: float | None
    _ar_marker_ids: set[str]

    @rpc
    def build(self) -> None:
        super().build()
        assert self._loop is not None
        self._profile = get_profile(self.config.robot)
        self._lidar_settings = DEFAULT_LIDAR_SETTINGS
        self._speed_mps = 0.0
        self._last_corrected_xy: tuple[float, float, float] | None = None
        self._last_relocalization_transform_poll_at = 0.0
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
            on_user_message_request=self._on_user_message_request,
            on_client_pose=self._on_client_pose,
            on_nav_joystick_request=self._on_nav_joystick_request,
            on_disconnect=self._on_client_disconnect,
        )
        self._nav_goal_coordinator = NavGoalCoordinator(
            odom_scale_correction_factor=self._profile.odom_scale_correction_factor,
        )
        self._state_publisher = RobotStatePublisher(
            self._ws_server,
            odom_scale_correction_factor=self._profile.odom_scale_correction_factor,
        )
        self._pose_buffer = PoseBuffer()
        self._policy = LocalizationPolicy(
            [provider.type for provider in self.config.localization.providers]
        )
        self._robot_observations = RobotObservationBuffer(
            pose_buffer=self._pose_buffer,
            T_base_camera_optical=self._profile.T_base_camera_optical,
        )
        marker, vps, map_code = self._build_localizers()
        self._agent_idle = True
        self._client_pose = None
        self._client_pose_received_at = None
        self._ar_marker_ids = set()
        self._capabilities = CapabilitySet.from_supported(
            self._profile.supported_capabilities,
            localization_available=bool(self._policy.providers),
            agent_available=self.config.agent,
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
            odom_map_transform=OdomMapTransform(),
            robot_observations=self._robot_observations,
            marker=marker,
            vps=vps,
            odom_scale_correction_factor=self._profile.odom_scale_correction_factor,
            map_code=map_code,
        )
        logger.info("ARModule build complete")

    def _build_localizers(self) -> tuple[Localizer | None, Localizer | None, str | None]:
        marker: Localizer | None = None
        vps: Localizer | None = None
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
                    pose_buffer=self._pose_buffer,
                    marker_mounts=self._profile.fiducial_marker_mounts,
                    dictionary_name=self._profile.fiducial_dictionary,
                )
            elif provider.type == "vps" and vps is None:
                if not provider.map_code:
                    raise ValueError("VPS localization provider requires map_code")
                if self._profile.T_base_camera_optical is None:
                    raise ValueError("VPS localization provider requires T_base_camera_optical")
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
        self._cancel_tele_cmd_vel()
        ws_server_obj = getattr(self, "_ws_server", None)
        if ws_server_obj is not None:
            ws_server_obj.stop()
        super().stop()

    def _hello_body(self, _client_id: str) -> HelloBody:
        return HelloBody(
            robot=self._profile.description,
            capabilities=self._capabilities.as_mapping(),
            navigation_inputs=self._capabilities.navigation_as_mapping(),
        )

    def _state_snapshot(self) -> StateSnapshot:
        idle = True
        if self._capabilities.supports(CapabilityName.AGENT):
            idle = self._agent_idle
        return StateSnapshot(
            connected_clients=self._ws_server.connection_count,
            lidar=self._lidar_settings,
            nav=self._nav_goal_coordinator.nav_state(),
            agent=AgentState(idle=idle),
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

    def _on_client_disconnect(self, _websocket: ws_server.ServerConnection, client_id: str) -> None:
        self._policy.on_disconnect(client_id)
        if self._ws_server.connection_count == 0:
            self._cancel_tele_cmd_vel()
            self._safety.on_last_disconnect()
            self._client_pose = None
            self._client_pose_received_at = None
            self._ar_marker_ids.clear()
        self._broadcast_state()

    def _on_nav_goal_request(
        self,
        msg: NavGoalRequest,
        _websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if not self._capabilities.supports_navigation(NAV_GOAL):
            return
        goal = self._nav_goal_coordinator.submit_goal(msg)
        if self.goal_request.transport is None:
            logger.warning("nav_goal_request ignored — goal_request transport is not wired")
            return
        self.goal_request.publish(goal)
        logger.info("nav_goal_request published", client_id=client_id, position=msg.position)
        self._broadcast_state()

    def _on_estop_request(self, _msg: EstopRequest, _websocket: ws_server.ServerConnection) -> None:
        self._cancel_tele_cmd_vel()
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
        self._client_pose = msg
        self._client_pose_received_at = time.time()

    def _on_nav_joystick_request(
        self,
        msg: NavJoystickRequest,
        _websocket: ws_server.ServerConnection,
        _client_id: str,
    ) -> None:
        if not self._capabilities.supports_navigation(NAV_JOYSTICK):
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

    def _fresh_client_pose(self) -> ClientPose | None:
        if self._client_pose is None or self._client_pose_received_at is None:
            return None
        if time.time() - self._client_pose_received_at > CLIENT_POSE_STALE_S:
            return None
        return self._client_pose

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
        if outcome.result is None:
            self._policy.on_failure(work.client_id)
            return
        self._policy.on_success(work.client_id)
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
        self._state_publisher.publish_lidar(msg, lidar=self._lidar_settings)

    async def handle_odom(self, msg: PoseStamped) -> None:
        ts_server = time.time()
        self._pose_buffer.push(msg, ts_server=ts_server)
        self._state_publisher.publish_odom(msg)
        corrected_x, corrected_y = correct_odom_xy(
            msg.x, msg.y, factor=self._profile.odom_scale_correction_factor
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
        self._maybe_ingest_relocalization_transform(ts_server)

    def _maybe_ingest_relocalization_transform(self, ts_server: float) -> None:
        now = time.monotonic()
        if now - self._last_relocalization_transform_poll_at < 2.0:
            return
        self._last_relocalization_transform_poll_at = now
        if "map" not in self.tfbuffer.get_frames():
            return
        transform = self.tfbuffer.get("world", "map")
        if transform is None:
            return
        self._coordinator.on_relocalization_transform(
            Transform(
                translation=transform.translation,
                rotation=transform.rotation,
                frame_id="odom",
                child_frame_id=transform.child_frame_id,
                ts=transform.ts,
            ),
            ts_server=ts_server,
        )

    async def handle_camera_info(self, msg: CameraInfo) -> None:
        if self._profile.T_base_camera_optical is None:
            return
        self._robot_observations.set_camera_info(msg)

    async def handle_color_image(self, msg: Image) -> None:
        if self._profile.T_base_camera_optical is None:
            return
        self._robot_observations.push_image(
            msg,
            ts_server=time.time(),
            speed_mps=self._speed_mps,
            travel_m=self._policy.travel_m,
        )

    async def handle_path(self, msg: Path) -> None:
        if not self._capabilities.supports(CapabilityName.NAVIGATION):
            return
        nav_goal_frame, state_changed = self._nav_goal_coordinator.on_path(msg)
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
        text = _textual_ai_message(msg)
        if text is None:
            return
        self._ws_server.schedule_broadcast_text(encode_agent_message(text))

    async def handle_agent_idle(self, msg: bool) -> None:
        if not self._capabilities.supports(CapabilityName.AGENT):
            return
        idle = bool(msg)
        if idle == self._agent_idle:
            return
        self._agent_idle = idle
        self._broadcast_state()

    @skill
    def ar_place_marker(self, id: str, x: float, y: float, z: float, title: str = "") -> str:
        """Place or replace a marker in the AR client's world at an odom-frame point.

        The point is in the robot odom frame, the same frame as robot pose and
        navigation goals. `id` is the handle, not the label. An omitted or empty
        title leaves the marker unlabeled. The same id upserts.

        Args:
            id: Marker handle. Non-blank, max 64 characters.
            x: Odom-frame X in meters.
            y: Odom-frame Y in meters.
            z: Odom-frame Z in meters.
            title: Optional label on the marker.
        """
        marker_id, error = _validate_marker_id(id)
        if error is not None:
            return error
        error = _validate_ar_place_marker(x, y, z, title)
        if error is not None:
            return error
        if self._ws_server.connection_count == 0:
            return "No AR client connected"
        if self._fresh_client_pose() is None:
            return "No client pose"
        args: dict[str, object] = {
            "id": marker_id,
            "x": float(x),
            "y": float(y),
            "z": float(z),
        }
        if title:
            args["title"] = title
        self._ws_server.schedule_broadcast_text(
            encode_agent_skill(name="ar_place_marker", args=args)
        )
        self._ar_marker_ids.add(marker_id)
        return "ok"

    @skill
    def ar_remove_marker(self, id: str) -> str:
        """Remove a previously placed AR marker by id.

        Args:
            id: Marker handle from ar_place_marker.
        """
        marker_id, error = _validate_marker_id(id)
        if error is not None:
            return error
        if marker_id not in self._ar_marker_ids:
            return "unknown marker id"
        if self._ws_server.connection_count == 0:
            return "No AR client connected"
        self._ws_server.schedule_broadcast_text(
            encode_agent_skill(name="ar_remove_marker", args={"id": marker_id})
        )
        self._ar_marker_ids.discard(marker_id)
        return "ok"

    @skill
    def ar_get_client_pose(self) -> str:
        """Return the latest wearer pose in odom, including look direction.

        Uses the inbound client_pose buffer. Missing or older than 2 s from
        server receive time returns No client pose. Broadcasts nothing.
        """
        pose = self._fresh_client_pose()
        if pose is None:
            return "No client pose"
        look_dir = _look_dir_optical_z(pose.orientation)
        return (
            f"position={list(pose.position)} "
            f"orientation={list(pose.orientation)} "
            f"look_dir={list(look_dir)}"
        )


def _finite_number(value: object, name: str) -> str | None:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(float(value))
    ):
        return f"{name} must be a finite number"
    return None


def _validate_marker_id(marker_id: object) -> tuple[str, str | None]:
    if not isinstance(marker_id, str):
        return "", "id is blank"
    trimmed = marker_id.strip()
    if not trimmed:
        return "", "id is blank"
    if len(trimmed) > MARKER_ID_MAX_LEN:
        return "", "id is too long"
    return trimmed, None


def _validate_ar_place_marker(x: object, y: object, z: object, title: object) -> str | None:
    for name, value in (("x", x), ("y", y), ("z", z)):
        error = _finite_number(value, name)
        if error is not None:
            return error
    if not isinstance(title, str):
        return "title must be a string"
    return None


def _look_dir_optical_z(
    orientation: tuple[float, float, float, float],
) -> tuple[float, float, float]:
    x, y, z, w = orientation
    vx, vy, vz = 0.0, 0.0, 1.0
    tx = 2.0 * (y * vz - z * vy)
    ty = 2.0 * (z * vx - x * vz)
    tz = 2.0 * (x * vy - y * vx)
    look = (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )
    length = math.hypot(*look)
    if length < 1e-6:
        return (0.0, 0.0, 1.0)
    return (look[0] / length, look[1] / length, look[2] / length)
