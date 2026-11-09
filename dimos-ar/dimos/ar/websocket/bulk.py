"""Bounded v2 bulk assets, incremental records, and upload framing.

This lane carries presentation data and localization pixels, never authority.
An asset revision is immutable and scoped to this server instance.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
import hashlib
import json
import math
import struct
import threading
import time
from typing import Any
from uuid import uuid4

CHUNK_BYTES = 16_384
BINARY_HEADER = struct.Struct("<4sII")
BINARY_MAGIC = b"ARB2"
UPLOAD_MAX_BYTES = 4_194_304
ASSET_MAX_BYTES = 16_777_216
CACHE_MAX_BYTES = 67_108_864
CACHE_MAX_ASSETS = 32
BULK_BYTES_PER_SECOND = 1_048_576


def dumps(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def _parts(metadata: dict[str, Any], arrays: dict[str, Iterable[Any]]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    current: dict[str, Any] = {"metadata": metadata}
    size = len(dumps(current).encode())
    if size > 14_000:
        raise ValueError("bulk metadata exceeds record budget")
    for field, items in arrays.items():
        for item in items:
            item_size = len(dumps(item).encode()) + len(field) + 8
            if item_size > 14_000:
                raise ValueError("bulk item exceeds record budget")
            if size + item_size > 14_000:
                parts.append(current)
                current, size = {}, 2
            current.setdefault(field, []).append(item)
            size += item_size
    if current:
        parts.append(current)
    return parts


@dataclass(frozen=True)
class BulkAsset:
    kind: str
    ref: dict[str, str]
    records: tuple[str, ...]
    size: int


class BulkAssetStore:
    def __init__(self) -> None:
        self.epoch = uuid4().hex
        self._assets: OrderedDict[tuple[str, str, str], BulkAsset] = OrderedDict()
        self._bytes = 0
        self._lock = threading.RLock()
        self._route_identity: OrderedDict[int, tuple[dict[str, Any], dict[str, str]]] = OrderedDict()
        self._pins: dict[str, tuple[str, str, str]] = {}

    def put(self, kind: str, identity: str, revision: str, value: dict[str, Any],
            *, pin_slot: str | None = None) -> dict[str, str]:
        key = kind, identity, revision
        with self._lock:
            existing = self._assets.get(key)
            if existing is not None:
                self._assets.move_to_end(key)
                if pin_slot is not None:
                    self._pins[pin_slot] = key
                return dict(existing.ref)
        if kind == "model":
            metadata = {k: v for k, v in value.items() if k not in {"links", "joints"}}
            data = _parts(metadata, {"links": value.get("links", []), "joints": value.get("joints", [])})
        elif kind == "trajectory":
            data = _parts({k: v for k, v in value.items() if k != "trajectory"}, {"points": value["trajectory"]})
        elif kind == "route":
            data = _parts({k: v for k, v in value.items() if k != "path_poses"}, {"points": value["path_poses"]})
        else:
            raise ValueError("unknown bulk asset kind")
        ref = {"epoch": self.epoch, "id": identity, "revision": revision}
        records = tuple(
            dumps({"type": "bulk_record", **ref, "kind": kind, "part": part,
                   "parts": len(data), "data": item}) + "\n"
            for part, item in enumerate(data)
        )
        size = sum(len(record.encode()) for record in records)
        if size > ASSET_MAX_BYTES or any(len(record.encode()) > CHUNK_BYTES for record in records):
            raise ValueError("bulk asset exceeds byte budget")
        asset = BulkAsset(kind, ref, records, size)
        with self._lock:
            if key not in self._assets:
                self._assets[key] = asset
                self._bytes += size
            if pin_slot is not None:
                self._pins[pin_slot] = key
            while self._bytes > CACHE_MAX_BYTES or len(self._assets) > CACHE_MAX_ASSETS:
                retired_key = next((item for item in self._assets if item not in self._pins.values()), None)
                if retired_key is None:
                    raise ValueError("active bulk assets exceed cache budget")
                retired = self._assets.pop(retired_key)
                self._bytes -= retired.size
        return dict(ref)

    def get(self, kind: str, ref: dict[str, Any]) -> BulkAsset | None:
        if ref.get("epoch") != self.epoch:
            return None
        with self._lock:
            result = self._assets.get((kind, str(ref.get("id")), str(ref.get("revision"))))
            if result is not None:
                self._assets.move_to_end((kind, result.ref["id"], result.ref["revision"]))
            return result

    def compact(self, payload: dict[str, Any], *, _slot: str | None = None) -> dict[str, Any]:
        body = dict(payload)
        model = body.get("model")
        if isinstance(model, dict):
            revision = str(model["revision"])
            body["model_ref"] = self.put("model", "model", revision, model, pin_slot="model")
            del body["model"]
        plan = body.get("plan")
        if isinstance(plan, dict) and "trajectory" in plan:
            identity = str(plan["plan_id"])
            body["plan_ref"] = self.put("trajectory", identity, identity, plan, pin_slot="plan")
            del body["plan"]
        if body.get("type") == "manipulation_result" and "trajectory" in body:
            identity = str(body["plan_id"])
            body["plan_ref"] = self.put("trajectory", identity, identity, payload, pin_slot="plan")
            del body["trajectory"]
        if "path_poses" in body:
            route = body
            slot = _slot or ("preview" if body.get("preview") is True else "active_goal")
            with self._lock:
                cached = self._route_identity.get(id(payload))
            if (cached is not None and cached[0] is payload
                    and cached[1]["id"] == f"route:{slot}"
                    and self.get("route", cached[1]) is not None):
                ref = cached[1]
            else:
                revision = hashlib.sha256(dumps(route).encode()).hexdigest()
                ref = self.put("route", f"route:{slot}", revision, route, pin_slot=slot)
                with self._lock:
                    self._route_identity[id(payload)] = (payload, ref)
                    while len(self._route_identity) > 8:
                        self._route_identity.popitem(last=False)
            with self._lock:
                self._pins[slot] = ("route", ref["id"], ref["revision"])
            body = {k: v for k, v in body.items() if k != "path_poses"}
            body["route_ref"] = dict(ref)
        for field in ("preview", "active_goal"):
            if isinstance(body.get(field), dict):
                body[field] = self.compact(body[field], _slot=field)
        return body


class TokenBucket:
    def __init__(self, rate: float, capacity: float) -> None:
        self.rate, self.capacity = rate, capacity
        self.tokens = capacity
        self.updated = time.monotonic()

    def take(self, amount: float = 1) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + max(0, now - self.updated) * self.rate)
        self.updated = now
        if not math.isfinite(amount) or amount > self.tokens:
            return False
        self.tokens -= amount
        return True


class BulkUpload:
    def __init__(self, identity: int, size: int, capture_id: str | None = None) -> None:
        if type(identity) is not int or not 0 <= identity < 2**32:
            raise ValueError("invalid bulk upload id")
        if type(size) is not int or not 6 <= size <= UPLOAD_MAX_BYTES:
            raise ValueError("invalid bulk upload size")
        self.identity, self.size = identity, size
        self.capture_id = capture_id
        self.data = bytearray()
        self.started = time.monotonic()
        self.last_progress = self.started

    def append(self, chunk: bytes) -> bytes | None:
        if len(chunk) > CHUNK_BYTES or len(chunk) <= BINARY_HEADER.size:
            raise ValueError("invalid bulk chunk size")
        magic, identity, offset = BINARY_HEADER.unpack_from(chunk)
        if magic != BINARY_MAGIC or identity != self.identity or offset != len(self.data):
            raise ValueError("bulk chunk identity or offset mismatch")
        if (time.monotonic() - self.started > 30
                or time.monotonic() - self.last_progress > 5
                or len(self.data) + len(chunk) - 12 > self.size):
            raise ValueError("bulk upload expired or exceeds declared size")
        self.data.extend(chunk[12:])
        self.last_progress = time.monotonic()
        return bytes(self.data) if len(self.data) == self.size else None


def binary_chunks(identity: int, payload: bytes) -> Iterable[bytes]:
    for offset in range(0, len(payload), CHUNK_BYTES - BINARY_HEADER.size):
        yield BINARY_HEADER.pack(BINARY_MAGIC, identity, offset) + payload[offset:offset + CHUNK_BYTES - 12]


class BulkPeer:
    """One replaceable asset per identity and one latest LiDAR sample."""

    def __init__(
        self, websocket: Any, epoch: str, budget: TokenBucket,
        active: Callable[[], int], controls_pending: Callable[[], bool],
    ) -> None:
        self.websocket, self.epoch, self.budget = websocket, epoch, budget
        self._active, self._controls_pending = active, controls_pending
        self._local = TokenBucket(BULK_BYTES_PER_SECOND, CHUNK_BYTES * 2)
        self._assets: OrderedDict[tuple[str, str], BulkAsset] = OrderedDict()
        self._latest: OrderedDict[tuple[str, str], str] = OrderedDict()
        self._lidar: bytes | None = None
        self._serial = 0
        self._wake = asyncio.Event()
        self._current = False
        self._current_asset: tuple[str, str, str] | None = None
        self.uploading = False
        self.task: asyncio.Task[None] | None = None

    @property
    def busy(self) -> bool:
        return self._current or bool(self._assets) or self._lidar is not None

    def enqueue(self, asset: BulkAsset) -> None:
        key = asset.kind, asset.ref["id"]
        queued = self._assets.get(key)
        if (self._current_asset == (*key, asset.ref["revision"])
                or (queued is not None and queued.ref["revision"] == asset.ref["revision"])):
            return
        self._latest[key] = asset.ref["revision"]
        self._latest.move_to_end(key)
        while len(self._latest) > 32:
            self._latest.popitem(last=False)
        self._assets[key] = asset
        self._assets.move_to_end(key)
        while len(self._assets) > 8:
            self._assets.popitem(last=False)
        self._wake.set()

    def lidar(self, data: bytes) -> None:
        if len(data) <= 65_536:
            self._lidar = data
            self._wake.set()

    async def consume(self, size: int) -> None:
        while True:
            self._local.rate = BULK_BYTES_PER_SECOND / max(1, self._active())
            self.budget.take(0)
            self._local.take(0)
            if (not self._controls_pending() and self.budget.tokens >= size
                    and self._local.tokens >= size):
                self.budget.take(size)
                self._local.take(size)
                break
            await asyncio.sleep(0.005)

    async def _send(self, value: str | bytes) -> None:
        size = len(value.encode()) if isinstance(value, str) else len(value)
        await self.consume(size)
        async with asyncio.timeout(2):
            await self.websocket.send(value)
        await asyncio.sleep(0)

    async def run(self) -> None:
        while True:
            if not self._assets and self._lidar is None:
                self._wake.clear()
                await self._wake.wait()
            self._current = True
            try:
                if self._assets:
                    key, asset = self._assets.popitem(last=False)
                    self._current_asset = (*key, asset.ref["revision"])
                    for record in asset.records:
                        if self._latest.get(key) != asset.ref["revision"]:
                            break
                        await self._send(record)
                elif self._lidar is not None:
                    payload, self._lidar = self._lidar, None
                    self._serial = (self._serial + 1) % 2**32
                    await self._send(dumps({"type": "bulk_binary_begin", "kind": "lidar",
                                           "epoch": self.epoch, "id": self._serial,
                                           "total_bytes": len(payload)}) + "\n")
                    for chunk in binary_chunks(self._serial, payload):
                        await self._send(chunk)
            finally:
                self._current_asset = None
                self._current = False
