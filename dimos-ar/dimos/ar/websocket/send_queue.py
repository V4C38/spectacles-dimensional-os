"""Per-client WebSocket outbound queue with latest-wins coalescing."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import math
import re
import time

import websockets
import websockets.asyncio.server as ws_server

from dimos.ar.timing_diagnostics import LatencyHistogram, TimingSummary
from dimos.ar.websocket.bulk import TokenBucket
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

OUTBOUND_FIFO_MAXSIZE = 64
OUTBOUND_FIFO_MAX_BYTES = 262_144
CONTROL_RECORD_MAX_BYTES = 16_384
CONTROL_BATCH_MAX_BYTES = 65_536
OUTBOUND_SEND_TIMEOUT_S = 2.0
COALESCE_FRAME_TYPES = frozenset(
    {"presence_state", "pose", "state", "localization_result", "interaction_state", "manipulation_state"}
)
_FRAME_TYPE_RE = re.compile(r'"type"\s*:\s*"([^"]+)"')


def peek_frame_type(text: str) -> str | None:
    match = _FRAME_TYPE_RE.search(text)
    return match.group(1) if match else None


class ClientSendQueue:
    """Per-connection sender with latest-wins coalescing and bounded FIFO."""

    def __init__(
        self,
        websocket: ws_server.ServerConnection,
        *,
        on_failure: Callable[[str], None] | None = None,
        on_transport_failure: Callable[[str], None] | None = None,
        send_timeout_s: float = OUTBOUND_SEND_TIMEOUT_S,
        client_id: str | None = None,
    ) -> None:
        if not math.isfinite(send_timeout_s) or send_timeout_s <= 0:
            raise ValueError("send_timeout_s must be finite and positive")
        self._websocket = websocket
        self._on_failure = on_failure
        self._on_transport_failure = on_transport_failure
        self._send_timeout_s = send_timeout_s
        self.failure_reason: str | None = None
        self._queue: asyncio.Queue[tuple[int, str, float]] = asyncio.Queue(
            maxsize=OUTBOUND_FIFO_MAXSIZE,
        )
        self._coalesce_latest: dict[str, str] = {}
        self._snapshot_budget = TokenBucket(57344, 16384)
        self._sequence = 0
        self._queued_bytes = 0
        self._timing = TimingSummary(
            "WebSocket outbound timing", connection_id=client_id or f"{id(websocket):x}"
        )
        self._send_latency = LatencyHistogram()
        self._queue_latency = LatencyHistogram()
        self._latency_started = time.monotonic()
        self._replacements = 0
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
        size = len(text.encode())
        if size > CONTROL_RECORD_MAX_BYTES:
            self._fail("outbound control record exceeds byte budget")
            return
        frame_type = peek_frame_type(text)
        if frame_type in COALESCE_FRAME_TYPES:
            self._replacements += int(frame_type in self._coalesce_latest)
            self._coalesce_latest[frame_type] = text
        else:
            if self._queued_bytes + size > OUTBOUND_FIFO_MAX_BYTES:
                self._fail("outbound control byte queue overflow")
                return
            self._sequence += 1
            item = (self._sequence, text, time.monotonic())
            try:
                self._queue.put_nowait(item)
                self._queued_bytes += size
            except asyncio.QueueFull:
                # Authority decisions and request replies cannot be dropped.
                # Retire the connection so a reconnect obtains a full snapshot.
                self._fail("outbound control queue overflow")
                return
        self._work_available.set()

    @property
    def pending(self) -> bool:
        return not self._closed and (not self._queue.empty() or bool(self._coalesce_latest))

    def _fail(self, reason: str, *, transport: bool = False) -> None:
        if self.failure_reason is not None or self._closed:
            return
        self.failure_reason = reason
        self._closed = True
        self._work_available.set()
        logger.warning("WebSocket outbound connection failed", reason=reason)
        handler = self._on_transport_failure if transport and self._on_transport_failure else self._on_failure
        if handler is not None:
            try:
                handler(reason)
            except Exception:
                logger.exception("WebSocket outbound failure handler failed")

    async def _sender_loop(self) -> None:
        try:
            while not self._closed:
                if (
                    self._queue.empty()
                    and not self._coalesce_latest
                ):
                    self._work_available.clear()
                    await self._work_available.wait()
                    if self._closed:
                        break
                try:
                    _seq, text, queued_at = self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    await self._flush_coalesced()
                    continue
                self._queue_latency.add((time.monotonic() - queued_at) * 1000)
                await self._send_text(text)
                self._queued_bytes -= len(text.encode())
                # Decisions drain before optional snapshots. Bulk data uses its
                # own socket and cannot enter this queue.
                if self._queue.empty():
                    await self._flush_coalesced()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("WebSocket outbound sender crashed")
            self._fail("outbound sender crashed")

    async def _flush_coalesced(self) -> None:
        if self._closed:
            return
        if self._coalesce_latest:
            batch = ""
            for kind, value in tuple(self._coalesce_latest.items()):
                size = len(value.encode())
                if not self._snapshot_budget.take(size):
                    continue
                self._coalesce_latest.pop(kind, None)
                if batch and len(batch.encode()) + size > CONTROL_BATCH_MAX_BYTES:
                    await self._send_text(batch)
                    batch = ""
                batch += value
            if batch:
                await self._send_text(batch)
            elif self._queue.empty():
                # Yield while capacity replenishes; essential FIFO traffic preempts
                # optional snapshots on the next pass. Latest snapshots replace old ones.
                await asyncio.sleep(0.005)
    async def _send_text(self, text: str) -> None:
        if self._closed:
            return
        started = time.monotonic()
        try:
            async with asyncio.timeout(self._send_timeout_s):
                await self._websocket.send(text)
            self._record_send(started, size=len(text.encode()))
        except (TimeoutError, OSError, websockets.WebSocketException) as exc:
            logger.warning(
                "WebSocket outbound text send failed",
                error=str(exc),
                frame_type=peek_frame_type(text),
            )
            self._fail(
                "outbound send timeout" if isinstance(exc, TimeoutError) else "outbound send failed",
                transport=True,
            )

    def _record_send(self, started: float, *, size: int = 0) -> None:
        # send() duration includes transport backpressure and event-loop stalls;
        # it does not measure delivery to, or consumption by, the headset.
        duration_ms = (time.monotonic() - started) * 1000
        self._send_latency.add(duration_ms)
        self._timing.record(
            counts={
                "text_sends": 1,
                "slow_sends": int(duration_ms >= 100),
                "dropped_fifo": 0,
                "bytes": size,
                "coalesced_replacements": self._replacements,
            },
            maxima={
                "send_max_ms": duration_ms,
                "fifo_depth_max": float(self._queue.qsize()),
                "fifo_bytes_max": float(self._queued_bytes),
                "coalesce_pending_max": float(len(self._coalesce_latest)),
                "send_p95_upper_ms": self._send_latency.percentile(0.95),
                "queue_p99_upper_ms": self._queue_latency.percentile(0.99),
            },
        )
        self._replacements = 0
        if time.monotonic() - self._latency_started >= 30:
            self._latency_started = time.monotonic()
            self._send_latency.clear()
            self._queue_latency.clear()
