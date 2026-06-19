"""PreviewService — off-thread preview path planner and broadcaster.

Owns a single-slot request queue (condition variable) and a dedicated worker
thread so that A* planning doesn't block the asyncio event loop.
"""

from __future__ import annotations

from dataclasses import dataclass
import threading
from typing import TYPE_CHECKING

from dimos.ar.network.data_plane import build_preview_path_payload
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.odom_buffer import OdomBuffer
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.network.protocol import PlanPathMessage
    from dimos.ar.preview_planner import PreviewPlanner
    from dimos.ar.tracking.transforms import Calibration
    from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid

logger = setup_logger()


@dataclass(frozen=True)
class PreviewPathRequest:
    ts: float
    target_world: tuple[float, float, float]


class PreviewService:
    """Runs path preview planning in a dedicated thread and sends preview payloads."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        calibration: Calibration,
        odom: OdomBuffer,
        planner: PreviewPlanner,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._calibration = calibration
        self._odom = odom
        self._planner = planner
        self._stop_event = threading.Event()
        self._condition = threading.Condition()
        self._request: PreviewPathRequest | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._stop_event.clear()

        def loop() -> None:
            while not self._stop_event.is_set():
                with self._condition:
                    while self._request is None and not self._stop_event.is_set():
                        self._condition.wait()
                    if self._stop_event.is_set():
                        return
                    request = self._request
                    self._request = None
                if request is not None:
                    self._process_request(request)

        self._thread = threading.Thread(
            target=loop,
            name="ar-preview-planner",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        with self._condition:
            self._request = None
            self._condition.notify_all()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)
        self._thread = None

    def update_costmap(self, grid: OccupancyGrid) -> None:
        self._planner.update_costmap(grid)

    def on_plan_path(self, msg: PlanPathMessage) -> None:
        if not self._calibration.is_registered or not self._planner.has_costmap():
            self._send_preview_path(ts=msg.ts, target_world=msg.position, waypoints=[])
            return
        if self._odom.latest() is None:
            self._send_preview_path(ts=msg.ts, target_world=msg.position, waypoints=[])
            return
        with self._condition:
            self._request = PreviewPathRequest(ts=msg.ts, target_world=msg.position)
            self._condition.notify()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _process_request(self, request: PreviewPathRequest) -> None:
        try:
            if not self._calibration.is_registered:
                self._send_preview_path(
                    ts=request.ts,
                    target_world=request.target_world,
                    waypoints=[],
                )
                return
            odom = self._odom.latest()
            if odom is None or not self._planner.has_costmap():
                self._send_preview_path(
                    ts=request.ts,
                    target_world=request.target_world,
                    waypoints=[],
                )
                return
            target_odom = self._calibration.inverse_transform_point(request.target_world)
            preview_path = self._planner.plan(
                (odom.position[0], odom.position[1]),
                (target_odom[0], target_odom[1]),
            )
            if not preview_path:
                self._send_preview_path(
                    ts=request.ts,
                    target_world=request.target_world,
                    waypoints=[],
                )
                return
            world_waypoints: list[tuple[float, float, float]] = []
            for waypoint in preview_path:
                world_position, _ = self._calibration.transform_pose(
                    waypoint,
                    (0.0, 0.0, 0.0, 1.0),
                )
                world_waypoints.append(world_position)
            self._send_preview_path(
                ts=request.ts,
                target_world=request.target_world,
                waypoints=world_waypoints,
            )
        except Exception as exc:
            logger.exception("XR preview planning failed", error=str(exc))
            self._send_preview_path(
                ts=request.ts,
                target_world=request.target_world,
                waypoints=[],
            )

    def _send_preview_path(
        self,
        *,
        ts: float,
        target_world: tuple[float, float, float],
        waypoints: list[tuple[float, float, float]],
    ) -> None:
        self._sender.send(
            build_preview_path_payload(
                ts=ts,
                target_world=target_world,
                waypoints=waypoints,
                robot_id=self._robot_id,
            )
        )
