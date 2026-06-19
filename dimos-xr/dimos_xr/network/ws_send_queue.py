"""Per-client WebSocket outbound queue with latest-wins coalescing."""

from __future__ import annotations

import asyncio
import os
import re

from dimos.utils.logging_config import setup_logger
import websockets
import websockets.asyncio.server as ws_server

logger = setup_logger()

OUTBOUND_FIFO_MAXSIZE = 64
OUTBOUND_BACKLOG_LOG_INTERVAL_S = 5.0
COALESCE_MESSAGE_TYPES = frozenset(
    {
        "lidar",
        "pose",
        "path",
        "path_preview",
        "nav_status",
        "bridge_status",
        "align_status",
        "camera_frame_ack",
    }
)
_MESSAGE_TYPE_RE = re.compile(r'"type"\s*:\s*"([^"]+)"')
_ALIGN_STATUS_STATE_RE = re.compile(r'"state"\s*:\s*"([^"]+)"')
_ALIGN_STATUS_TERMINAL_STATES = frozenset({"aligned", "failed"})

_TRACE = os.getenv("DIMOS_XR_TRACE", "") not in ("", "0", "false")


def peek_message_type(text: str) -> str | None:
    match = _MESSAGE_TYPE_RE.search(text)
    return match.group(1) if match else None


class ClientSendQueue:
    """Per-connection sender with latest-wins coalescing and bounded FIFO."""

    def __init__(self, websocket: ws_server.ServerConnection) -> None:
        self._websocket = websocket
        self._queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue(
            maxsize=OUTBOUND_FIFO_MAXSIZE,
        )
        self._coalesce_latest: dict[str, str] = {}
        self._sequence = 0
        self._sent_count = 0
        self._dropped_fifo_count = 0
        self._last_backlog_log_mono = 0.0
        self._work_available = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._closed = False

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._sender_loop())

    async def stop(self) -> None:
        self._closed = True
        self._work_available.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def enqueue(self, text: str) -> None:
        if self._closed:
            return
        msg_type = peek_message_type(text)
        if msg_type in COALESCE_MESSAGE_TYPES:
            if msg_type == "align_status":
                pending = self._coalesce_latest.get("align_status")
                if pending is not None:
                    pending_state_match = _ALIGN_STATUS_STATE_RE.search(pending)
                    if (
                        pending_state_match
                        and pending_state_match.group(1) in _ALIGN_STATUS_TERMINAL_STATES
                    ):
                        new_state_match = _ALIGN_STATUS_STATE_RE.search(text)
                        new_state = new_state_match.group(1) if new_state_match else ""
                        if new_state not in _ALIGN_STATUS_TERMINAL_STATES:
                            self._work_available.set()
                            return
            self._coalesce_latest[msg_type] = text
        else:
            self._sequence += 1
            item = (self._sequence, text)
            try:
                self._queue.put_nowait(item)
            except asyncio.QueueFull:
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                self._dropped_fifo_count += 1
                try:
                    self._queue.put_nowait(item)
                except asyncio.QueueFull:
                    pass
        self._work_available.set()

    async def _sender_loop(self) -> None:
        try:
            while not self._closed:
                if self._queue.empty() and not self._coalesce_latest:
                    self._work_available.clear()
                    await self._work_available.wait()
                    if self._closed:
                        break
                try:
                    _seq, text = self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    await self._flush_coalesced_batch()
                    continue
                await self._send(text)
                await self._flush_one_coalesced()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("XR WebSocket outbound sender crashed", error=str(exc))

    async def _flush_one_coalesced(self) -> None:
        if not self._coalesce_latest:
            return
        msg_type = next(iter(self._coalesce_latest))
        text = self._coalesce_latest.pop(msg_type)
        await self._send(text)

    async def _flush_coalesced_batch(self) -> None:
        while self._coalesce_latest and not self._closed:
            await self._flush_one_coalesced()

    async def _send(self, text: str) -> None:
        import time

        try:
            await self._websocket.send(text + "\n")
            self._sent_count += 1
            msg_type = peek_message_type(text)
            if _TRACE and msg_type == "align_status":
                logger.debug("XR WebSocket outbound align_status sent", bytes=len(text))
            now = time.monotonic()
            if now - self._last_backlog_log_mono >= OUTBOUND_BACKLOG_LOG_INTERVAL_S:
                fifo_depth = self._queue.qsize()
                coalesce_depth = len(self._coalesce_latest)
                if fifo_depth > 0 or coalesce_depth > 0 or self._dropped_fifo_count > 0:
                    self._last_backlog_log_mono = now
                    logger.info(
                        "XR WebSocket outbound backlog",
                        fifo_depth=fifo_depth,
                        coalesce_pending=coalesce_depth,
                        dropped_fifo=self._dropped_fifo_count,
                    )
        except websockets.ConnectionClosed:
            self._closed = True
        except (OSError, websockets.WebSocketException) as exc:
            msg_type = peek_message_type(text)
            logger.warning(
                "XR WebSocket outbound send failed",
                error=str(exc),
                message_type=msg_type,
            )
