from __future__ import annotations

import threading
import time
from typing import Any

from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.robot.unitree.go2.connection import (
    ConnectionConfig,
    GO2Connection,
    Go2Mode,
    make_connection,
)
from dimos.utils.logging_config import setup_logger
from reactivex.disposable import CompositeDisposable, Disposable

from dimos_ar.bridge_status import get_bridge_status_tracker
from dimos_ar.robot_bootstrap import resolve_ip_for_serial

logger = setup_logger()


class ARConnectionConfig(ConnectionConfig):
    target_serial: str | None = None
    stale_timeout_s: float = 10.0
    rediscover_interval_s: float = 5.0


class ARGO2Connection(GO2Connection):
    """GO2 connection with LAN re-discovery when sensor streams go stale."""

    config: ARConnectionConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._stream_disposables = CompositeDisposable()
        self._watchdog_stop = threading.Event()
        self._watchdog_thread: threading.Thread | None = None
        self._last_lidar_mono: float | None = None
        self._last_odom_mono: float | None = None
        self._last_reconnect_mono: float = 0.0
        self._reconnect_lock = threading.Lock()

    def _is_live(self) -> bool:
        return not global_config.replay and self.config.target_serial is not None

    def _update_streams_active(self) -> None:
        tracker = get_bridge_status_tracker()
        if tracker is None:
            return
        now = time.monotonic()
        if self._last_lidar_mono is None or self._last_odom_mono is None:
            tracker.set_streams_active(False)
            return
        stale_for = now - min(self._last_lidar_mono, self._last_odom_mono)
        tracker.set_streams_active(stale_for < self.config.stale_timeout_s)

    def _on_lidar(self, msg: PointCloud2) -> None:
        self._last_lidar_mono = time.monotonic()
        self._update_streams_active()
        self.lidar.publish(msg)

    def _publish_tf(self, msg: PoseStamped) -> None:
        self._last_odom_mono = time.monotonic()
        self._update_streams_active()
        super()._publish_tf(msg)

    def _subscribe_streams(self) -> None:
        def onimage(image: Image) -> None:
            self.color_image.publish(image)
            self._latest_video_frame = image

        self._stream_disposables.add(self.connection.lidar_stream().subscribe(self._on_lidar))
        self._stream_disposables.add(self.connection.odom_stream().subscribe(self._publish_tf))
        self._stream_disposables.add(self.connection.video_stream().subscribe(onimage))
        self._stream_disposables.add(Disposable(self.cmd_vel.subscribe(self.move)))

    def _unsubscribe_streams(self) -> None:
        self._stream_disposables.dispose()
        self._stream_disposables = CompositeDisposable()

    def _initial_robot_setup(self) -> None:
        self.standup()
        time.sleep(3)
        self.connection.balance_stand()
        if self.config.mode == Go2Mode.RAGE:
            self.connection.enable_rage_mode()
        self.connection.set_obstacle_avoidance(self.config.g.obstacle_avoidance)

    @rpc
    def start(self) -> None:
        super(GO2Connection, self).start()
        if not hasattr(self, "connection"):
            return
        self.connection.start()
        self._subscribe_streams()

        if self._camera_info_thread is None or not self._camera_info_thread.is_alive():
            self._camera_info_thread = threading.Thread(
                target=self.publish_camera_info,
                daemon=True,
            )
            self._camera_info_thread.start()

        if self._is_live():
            self._initial_robot_setup()
            self._start_watchdog()
        elif not global_config.replay:
            self._initial_robot_setup()

    def _start_watchdog(self) -> None:
        if self._watchdog_thread is not None and self._watchdog_thread.is_alive():
            return
        self._watchdog_stop.clear()
        self._watchdog_thread = threading.Thread(
            target=self._watchdog_loop,
            name="argo2-connection-watchdog",
            daemon=True,
        )
        self._watchdog_thread.start()

    def _watchdog_loop(self) -> None:
        serial = self.config.target_serial
        if serial is None:
            return

        while not self._watchdog_stop.wait(1.0):
            if not self._is_live():
                continue

            now = time.monotonic()
            if self._last_lidar_mono is None or self._last_odom_mono is None:
                continue

            stale_for = now - min(self._last_lidar_mono, self._last_odom_mono)
            if stale_for < self.config.stale_timeout_s:
                continue

            tracker = get_bridge_status_tracker()
            if tracker is not None:
                tracker.set_streams_active(False)

            since_reconnect = now - self._last_reconnect_mono
            if since_reconnect < self.config.rediscover_interval_s:
                continue

            new_ip = resolve_ip_for_serial(serial)
            if new_ip is None:
                logger.warning(
                    "Go2 %s not on LAN (stale streams for %.1fs) — retrying discovery",
                    serial,
                    stale_for,
                )
                continue

            with self._reconnect_lock:
                self._reconnect(new_ip)

    def _reconnect(self, ip: str) -> None:
        serial = self.config.target_serial
        logger.info("Reconnecting to Go2 %s at %s", serial, ip)

        tracker = get_bridge_status_tracker()
        if tracker is not None:
            tracker.set_reconnecting(True)
            tracker.set_streams_active(False)

        self._unsubscribe_streams()
        try:
            self.connection.stop()
        except Exception as exc:
            logger.warning("Error stopping connection during reconnect: %s", exc)

        global_config.update(robot_ip=ip)
        self.connection = make_connection(ip, self.config.g)
        self.connection.start()
        self._subscribe_streams()
        self._last_lidar_mono = None
        self._last_odom_mono = None
        self._last_reconnect_mono = time.monotonic()
        if tracker is not None:
            tracker.set_reconnecting(False)
        logger.info("Reconnected to Go2 %s", serial)

    @rpc
    def stop(self) -> None:
        self._watchdog_stop.set()
        if self._watchdog_thread is not None and self._watchdog_thread.is_alive():
            self._watchdog_thread.join(timeout=2.0)
        self._watchdog_thread = None
        self._unsubscribe_streams()
        super().stop()
