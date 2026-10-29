"""Per-client WebSocket outbound queue with latest-wins coalescing."""

from __future__ import annotations

import asyncio
import json
import re
import time

import websockets
import websockets.asyncio.server as ws_server

from dimos.ar.timing_diagnostics import TimingSummary
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

OUTBOUND_FIFO_MAXSIZE = 64
COALESCE_FRAME_TYPES = frozenset({"pose", "nav_goal", "state", "localization_result"})
_FRAME_TYPE_RE = re.compile(r'"type"\s*:\s*"([^"]+)"')


def peek_frame_type(text: str) -> str | None:
    match = _FRAME_TYPE_RE.search(text)
    return match.group(1) if match else None


class ClientSendQueue:
    """Per-connection sender with latest-wins coalescing and bounded FIFO."""

    def __init__(self, websocket: ws_server.ServerConnection) -> None:
        self._websocket = websocket
        self._queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue(
            maxsize=OUTBOUND_FIFO_MAXSIZE,
        )
        self._coalesce_latest: dict[str, str] = {}
        self._coalesce_latest_binary: bytes | None = None
        self._sequence = 0
        self._dropped_fifo_count = 0
        self._reported_drops = 0
        self._timing = TimingSummary(
            "WebSocket outbound timing", connection_id=f"{id(websocket):x}"
        )
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
        frame_type = peek_frame_type(text)
        # Previews are request/reply traffic. Coalescing them with authoritative
        # nav_goal frames loses either the active route or a correlated reply.
        preview = frame_type == "nav_goal" and json.loads(text).get("preview") is True
        if frame_type in COALESCE_FRAME_TYPES and not preview:
            self._coalesce_latest[frame_type] = text
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

    def enqueue_binary(self, data: bytes) -> None:
        if self._closed:
            return
        self._coalesce_latest_binary = data
        self._work_available.set()

    async def _sender_loop(self) -> None:
        try:
            while not self._closed:
                if (
                    self._queue.empty()
                    and not self._coalesce_latest
                    and self._coalesce_latest_binary is None
                ):
                    self._work_available.clear()
                    await self._work_available.wait()
                    if self._closed:
                        break
                try:
                    _seq, text = self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    await self._flush_coalesced()
                    continue
                await self._send_text(text)
                await self._flush_coalesced()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("WebSocket outbound sender crashed")

    async def _flush_coalesced(self) -> None:
        if self._closed:
            return
        if self._coalesce_latest:
            batch = "".join(self._coalesce_latest.values())
            self._coalesce_latest.clear()
            await self._send_text(batch)
        if self._coalesce_latest_binary is not None:
            data = self._coalesce_latest_binary
            self._coalesce_latest_binary = None
            await self._send_binary(data)

    async def _send_text(self, text: str) -> None:
        started = time.monotonic()
        try:
            await self._websocket.send(text)
            self._record_send(started, binary=False)
        except websockets.ConnectionClosed:
            self._closed = True
        except (OSError, websockets.WebSocketException) as exc:
            logger.warning(
                "WebSocket outbound text send failed",
                error=str(exc),
                frame_type=peek_frame_type(text),
            )

    async def _send_binary(self, data: bytes) -> None:
        started = time.monotonic()
        try:
            await self._websocket.send(data)
            self._record_send(started, binary=True)
        except websockets.ConnectionClosed:
            self._closed = True
        except (OSError, websockets.WebSocketException) as exc:
            logger.warning("WebSocket outbound binary send failed", error=str(exc))

    def _record_send(self, started: float, *, binary: bool) -> None:
        # send() duration includes transport backpressure and event-loop stalls;
        # it does not measure delivery to, or consumption by, the headset.
        duration_ms = (time.monotonic() - started) * 1000
        dropped = self._dropped_fifo_count - self._reported_drops
        self._reported_drops = self._dropped_fifo_count
        self._timing.record(
            counts={
                "text_sends": int(not binary),
                "binary_sends": int(binary),
                "slow_sends": int(duration_ms >= 100),
                "dropped_fifo": dropped,
            },
            maxima={
                "send_max_ms": duration_ms,
                "fifo_depth_max": float(self._queue.qsize()),
                "coalesce_pending_max": float(len(self._coalesce_latest)),
                "binary_pending_max": float(self._coalesce_latest_binary is not None),
            },
        )
