"""Shared-authority admission and bounded dispatch to the optional manipulation Spec."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
import logging
import math
import time
from typing import TYPE_CHECKING, Any

from dimos.ar.async_execution import (
    CONTROL_LEASE_S,
    HEARTBEAT_INTERVAL_S,
    HEARTBEAT_TIMEOUT_S,
    NativeRPC,
)
from dimos.ar.manipulation.protocol import (
    ARManipulationSpec,
    ManipulationRequest,
    rejection_result,
    spatial_error_code,
)
from dimos.ar.timing_diagnostics import TimingSummary
from dimos.ar.websocket.protocol import encode_text

if TYPE_CHECKING:
    from dimos.ar.replication.interaction import InteractionCoordinator

logger = logging.getLogger(__name__)

_STATE_CHANGING_ACTIONS = frozenset(
    {"acquire", "release", "cancel", "resume", "execute", "reset_joints", "prepare_shutdown"}
)


async def _unchanged(value: dict[str, Any]) -> dict[str, Any]:
    return value


@dataclass
class SharedFollowing:
    """One client's cached canonical target and acknowledged native lease."""

    target: tuple[str, dict[str, Any]] | None = None
    lease: str | None = None
    token: str | None = None
    sequence: int = 0

    def bind(self, lease: str, token: str) -> None:
        self.lease, self.token = lease, token

    def next_sample(self, group: str, body: dict[str, Any]) -> ManipulationRequest | None:
        self.target = (group, body)
        if self.token is None or self.lease != body["authority_lease"]:
            return None
        self.sequence += 1
        return ManipulationRequest(
            f"shared-follow-{self.token}-{self.sequence}",
            "update",
            group,
            {**body, "token": self.token, "sequence": self.sequence},
        )


class ManipulationService:
    def __init__(
        self,
        runtime: ARManipulationSpec,
        send: Callable[[str, str], None],
        broadcast: Callable[[str], None],
        on_ready: Callable[[], None] | None = None,
        on_snapshot: Callable[[dict[str, Any]], None] | None = None,
        on_result: Callable[[ManipulationRequest, dict[str, Any]], None] | None = None,
        control_state: Callable[[], tuple[str, int]] | None = None,
        prepare_outbound: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None,
    ) -> None:
        self._advisory_timing = TimingSummary("AR advisory IK timing")
        self._advisory_started: dict[tuple[str, str], float] = {}
        self._rpc = NativeRPC(runtime)
        self._send = send
        self._broadcast = broadcast
        self._on_ready = on_ready
        self._on_snapshot = on_snapshot
        self._on_result = on_result
        self._control_state = control_state
        self._prepare_outbound = prepare_outbound or _unchanged
        self._heartbeat: asyncio.Task[None] | None = None
        self._assets: dict[str, tuple[str, dict[str, Any]]] = {}
        self._latest_snapshot: dict[str, Any] | None = None
        self._tasks: set[asyncio.Task[None]] = set()
        self._pending: set[tuple[str, str]] = set()
        self._closed = False
        self._poll: asyncio.Task[None] | None = None
        self._clients: set[str] = set()
        self._updates: dict[str, tuple[ManipulationRequest, float]] = {}
        self._evaluation_at: dict[str, float] = {}
        self._ready_reported = False
        self._quiescing = False
        self._quiescent = False
        self._pending_stop: tuple[str | None, int | None] | None = None
        self._authority_epoch: str | None = None
        self._authority_revision = -1
        self._pending_revoke: tuple[str, str, int, str] | None = None
        self._gripper_results: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()
        self._gripper_inflight: set[tuple[str, str]] = set()
        self._snapshot_generation = 0
        self._shared_following: dict[str, SharedFollowing] = {}

    def start(self) -> None:
        self._poll = asyncio.create_task(self._poll_state())
        if self._control_state is not None:
            self._heartbeat = asyncio.create_task(self._heartbeat_loop())

    def follow_shared(self, client_id: str, group: str, body: dict[str, Any]) -> None:
        if self._closed or client_id not in self._clients:
            return
        state = self._shared_following.setdefault(client_id, SharedFollowing())
        sample = state.next_sample(group, body)
        if sample is not None:
            self.submit(sample, client_id)

    def suspend(self, client_id: str, deadline: float) -> None:
        self._spawn(
            self._rpc.call("ar_manipulation_suspend", client_id, deadline), (client_id, "suspend")
        )

    def connect(self, client_id: str) -> None:
        self._clients.add(client_id)
        if self._latest_snapshot is not None:
            self._send(
                client_id, encode_text({**self._latest_snapshot, "type": "manipulation_state"})
            )

    def submit(self, request: ManipulationRequest, client_id: str, clock_offset: float = 0) -> None:
        if self._closed or client_id not in self._clients:
            return
        if request.action == "gripper":
            request_key = (client_id, request.request_id)
            cached = self._gripper_results.get(request_key)
            if cached is not None:
                self._reply(client_id, request, dict(cached))
                return
            if request_key in self._gripper_inflight:
                return
        self._record_authority(
            request.payload.get("authority_epoch"), request.payload.get("authority_revision")
        )
        if self._quiescing and request.action not in {"cancel", "release"}:
            self._reply(
                client_id,
                request,
                {"status": "rejected", "code": "stopping", "message": "Stopping"},
            )
            return
        if request.action == "prepare_shutdown":
            self._quiescing = True
            self._updates.clear()
        if request.action == "update":
            self._updates[client_id] = (request, clock_offset)
            key = (client_id, "update")
            if key not in self._pending and len(self._tasks) >= 16:
                self._updates.pop(client_id, None)
                self._reply(client_id, request, {"status": "rejected", "message": "server busy"})
                return
            if key not in self._pending:
                self._spawn(self._drain_updates(client_id), key)
            return
        key = (client_id, "advisory" if request.action == "evaluate" else request.action)
        if key in self._pending or (
            len(self._tasks) >= 16 and request.action not in {"cancel", "release"}
        ):
            self._reply(
                client_id,
                request,
                {"status": "rejected", "message": "request already pending or server busy"},
            )
            return
        if request.action == "gripper":
            self._gripper_inflight.add((client_id, request.request_id))
        self._spawn(self._dispatch(request, client_id, clock_offset), key)

    def _spawn(self, coroutine: Any, key: tuple[str, str]) -> None:
        self._pending.add(key)
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)

        def done(finished: asyncio.Task[None]) -> None:
            self._tasks.discard(finished)
            self._pending.discard(key)
            if not finished.cancelled() and (error := finished.exception()) is not None:
                logger.error(
                    "Manipulation RPC task failed: %s",
                    key,
                    exc_info=(type(error), error, error.__traceback__),
                )

        task.add_done_callback(done)

    async def _drain_updates(self, client_id: str) -> None:
        while client_id in self._updates and client_id in self._clients:
            request, offset = self._updates.pop(client_id)
            await self._dispatch(request, client_id, offset)
            key = (client_id, "follow_evaluation")
            now = asyncio.get_running_loop().time()
            if key not in self._pending and now - self._evaluation_at.get(client_id, -1e9) >= 0.05:
                self._evaluation_at[client_id] = now
                self._spawn(self._evaluate_follow(request, client_id), key)

    async def _evaluate_follow(self, request: ManipulationRequest, client_id: str) -> None:
        """Advisory work never blocks the receipt/forwarding of held samples."""
        try:
            result = await self._rpc.call(
                "ar_manipulation_evaluate_following",
                client_id,
                {**request.payload, "group_id": request.group_id},
                timeout=20,
            )
        except Exception as exc:  # noqa: BLE001 — remote native errors are advisory wire results
            code = spatial_error_code(str(exc), "ik_failed")
            result = {"status": "infeasible", "code": code, "message": str(exc)}
        if result.get("status") == "following":
            return
        result["sequence"] = request.payload["sequence"]
        self._reply(client_id, request, result)

    async def _dispatch(
        self, request: ManipulationRequest, client_id: str, clock_offset: float
    ) -> None:
        if request.action != "evaluate":
            await self._dispatch_command(request, client_id, clock_offset)
            return
        started = time.monotonic()
        key = (client_id, request.request_id)
        self._advisory_started[key] = started
        self._advisory_timing.record(counts={"requests": 1}, maxima={})
        try:
            await self._dispatch_command(request, client_id, clock_offset)
        finally:
            self._advisory_started.pop(key, None)
            self._advisory_timing.record(
                counts={"completions": 1},
                maxima={"duration_max_ms": (time.monotonic() - started) * 1000},
            )

    async def _dispatch_command(
        self, request: ManipulationRequest, client_id: str, clock_offset: float
    ) -> None:
        body = {**request.payload, "action": request.action, "group_id": request.group_id}
        if request.action == "update":
            body["ts"] += clock_offset
        call = self._state_call if request.action in _STATE_CHANGING_ACTIONS else self._rpc.call
        try:
            result = await call(
                "ar_manipulation_command",
                client_id,
                body,
                timeout=57 if request.action in {"reset_joints", "prepare_shutdown"} else 20,
            )
            if request.action == "prepare_shutdown":
                self._quiescent = result.get("quiescent") is True
        except ValueError as exc:
            result = rejection_result(request.action, exc)
            logger.info("Manipulation request rejected: %s: %s", request.action, str(exc))
        except Exception as exc:
            if request.action == "evaluate" and isinstance(exc, TimeoutError):
                self._advisory_timing.record(counts={"timeouts": 1}, maxima={})
            logger.exception("Manipulation command failed")
            result = rejection_result(request.action, exc, transport=True)
        if request.action == "update":
            result.setdefault("sequence", request.payload["sequence"])
        if request.action != "update" or result.get("status") in {
            "rejected",
            "infeasible",
            "feasible",
        }:
            result = await self._prepare_outbound({**result, "type": "manipulation_result"})
            self._reply(client_id, request, result)

    async def _state_call(self, method: str, *args: Any, timeout: float = 2.0) -> Any:
        # Invalidate snapshots captured before admission and while the command
        # was in flight. Asset materialization/packing can outlive its native RPC.
        self._snapshot_generation += 1
        try:
            return await self._rpc.call(method, *args, timeout=timeout)
        finally:
            self._snapshot_generation += 1

    def _reply(self, client_id: str, request: ManipulationRequest, result: dict[str, Any]) -> None:
        if request.action == "evaluate" and result.get("status") != "feasible":
            self._advisory_timing.record(counts={"failures": 1}, maxima={})
        if request.action in {"evaluate", "update"}:
            position, orientation = (
                request.payload.get("position"),
                request.payload.get("orientation"),
            )
            if position is not None and orientation is not None:
                result["sample_pose"] = {
                    "position": list(position),
                    "orientation": list(orientation),
                }
            revision = request.payload.get(
                "advisory_target_revision", request.payload.get("target_revision")
            )
            if revision is not None:
                result["target_revision"] = revision
        if request.action == "gripper":
            key = (client_id, request.request_id)
            self._gripper_inflight.discard(key)
            self._gripper_results[key] = dict(result)
            self._gripper_results.move_to_end(key)
            while len(self._gripper_results) > 128:
                self._gripper_results.popitem(last=False)
        if (
            request.action == "acquire"
            and isinstance(result.get("token"), str)
            and client_id in self._clients
            and not self._closed
        ):
            lease = request.payload.get("authority_lease")
            if isinstance(lease, str):
                state = self._shared_following.setdefault(client_id, SharedFollowing())
                state.bind(lease, result["token"])
                pending = state.target
                if pending is not None:
                    self.follow_shared(client_id, *pending)
        if self._on_result is not None:
            self._on_result(request, result)
        if client_id in self._clients and not self._closed:
            self._send(
                client_id,
                encode_text(
                    {
                        **result,
                        "type": "manipulation_result",
                        "request_id": request.request_id,
                        "action": request.action,
                        "group_id": request.group_id,
                    }
                ),
            )

    async def _heartbeat_loop(self) -> None:
        while not self._closed:
            assert self._control_state is not None
            epoch, revision = self._control_state()
            try:
                await self._rpc.call(
                    "ar_manipulation_heartbeat",
                    epoch,
                    revision,
                    time.monotonic() + CONTROL_LEASE_S,
                    timeout=HEARTBEAT_TIMEOUT_S,
                )
            except Exception:
                logger.exception("Manipulation control-plane heartbeat unavailable")
                await self._rpc.wait_idle("ar_manipulation_heartbeat")
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)

    async def _materialize(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        result = dict(snapshot)
        for kind in ("model", "plan"):
            revision = result.pop(f"{kind}_revision", None)
            if revision is not None:
                cached = self._assets.get(kind)
                if cached is None or cached[0] != revision:
                    asset = await self._rpc.call("ar_manipulation_asset", kind, revision)
                    if kind == "plan" and asset is None:
                        # Planning/target updates may retire this optional asset
                        # after snapshot capture. Joint feedback remains valid.
                        result[kind] = None
                        self._assets.pop(kind, None)
                        continue
                    if not isinstance(asset, dict):
                        raise ValueError(f"native {kind} asset retired")
                    cached = self._assets[kind] = (revision, asset)
                result[kind] = cached[1]
            elif kind == "plan" and "plan_metadata" in result:
                result[kind] = None
                self._assets.pop(kind, None)
        result.pop("plan_metadata", None)
        return result

    async def _poll_state(self) -> None:
        while not self._closed:
            generation = self._snapshot_generation
            try:
                snapshot = await self._rpc.call("ar_manipulation_snapshot")
                snapshot = await self._materialize(snapshot)
                prepared = await self._prepare_outbound({**snapshot, "type": "manipulation_state"})
                if generation == self._snapshot_generation:
                    self._latest_snapshot = prepared
                    if self._on_snapshot is not None:
                        self._on_snapshot(snapshot)
                    if snapshot.get("available") and not self._ready_reported:
                        if self._on_ready is not None:
                            self._on_ready()
                        self._ready_reported = True
                    self._broadcast(encode_text(self._latest_snapshot))
            except Exception as exc:
                if generation == self._snapshot_generation:
                    logger.exception("Manipulation observation failed")
                    self._broadcast(
                        encode_text(
                            {"type": "manipulation_state", "available": False, "message": str(exc)}
                        )
                    )
            if self._advisory_started:
                self._advisory_timing.record(
                    counts={},
                    maxima={
                        "pending_age_max_ms": (
                            time.monotonic() - min(self._advisory_started.values())
                        )
                        * 1000
                    },
                )
            await self._rpc.wait_readers()
            await asyncio.sleep(1 / 30)

    def _record_authority(self, epoch: object, revision: object) -> None:
        if (
            isinstance(epoch, str)
            and epoch
            and isinstance(revision, int)
            and not isinstance(revision, bool)
            and revision >= self._authority_revision
        ):
            self._authority_epoch, self._authority_revision = epoch, revision

    def revoke(self, epoch: str, lease_id: str, revision: int, reason: str) -> None:
        self._record_authority(epoch, revision)
        if self._closed:
            return
        self._pending_revoke = (epoch, lease_id, revision, reason)
        key = ("server", "revoke")
        if key not in self._pending:
            self._spawn(self._drain_revocations(), key)

    async def _drain_revocations(self) -> None:
        while self._pending_revoke is not None:
            envelope = self._pending_revoke
            self._pending_revoke = None
            try:
                call = self._rpc.call if envelope[3] == "target_changed" else self._state_call
                await call("ar_manipulation_revoke", *envelope)
            except TimeoutError:
                await self._rpc.wait_idle("ar_manipulation_revoke")
                self._snapshot_generation += 1

    def emergency_stop(self, epoch: str | None = None, revision: int | None = None) -> None:
        key = ("server", "estop")
        if self._closed:
            return
        self._updates.clear()
        self._snapshot_generation += 1
        self._record_authority(epoch, revision)
        self._pending_stop = (epoch, revision)
        if key not in self._pending:
            self._spawn(self._drain_stops(), key)

    async def _drain_stops(self) -> None:
        while self._pending_stop is not None:
            epoch, revision = self._pending_stop
            self._pending_stop = None
            args = () if epoch is None else (epoch, revision)
            try:
                await self._state_call("ar_manipulation_stop", *args)
            except TimeoutError:
                await self._rpc.wait_idle("ar_manipulation_stop")
                self._snapshot_generation += 1

    def disconnect(self, client_id: str) -> None:
        self._clients.discard(client_id)
        self._shared_following.pop(client_id, None)
        self._updates.pop(client_id, None)
        if self._closed or self._quiescent:
            return
        self._spawn(
            self._state_call("ar_manipulation_disconnect", client_id),
            (client_id, "disconnect"),
        )

    async def close(self) -> None:
        self._closed = True
        self._pending_stop = None
        self._pending_revoke = None
        # Retire observation calls before the runtime and its RPC session shut down.
        if self._heartbeat:
            self._heartbeat.cancel()
            await asyncio.gather(self._heartbeat, return_exceptions=True)
            self._heartbeat = None
        if self._poll:
            self._poll.cancel()
            await asyncio.gather(self._poll, return_exceptions=True)
            self._poll = None
        clients = tuple(self._clients)
        self._clients.clear()
        self._updates.clear()
        self._shared_following.clear()
        if not self._quiescent:
            # Stop once before retiring individual leases, with a bounded RPC deadline.
            try:
                stop_args = (
                    ()
                    if self._authority_epoch is None
                    else (self._authority_epoch, self._authority_revision + 1)
                )
                async with asyncio.timeout(0.8):
                    await self._rpc.wait_idle("ar_manipulation_stop")
                    await self._rpc.call("ar_manipulation_stop", *stop_args, timeout=0.8)
                for client in clients:
                    await self._rpc.call("ar_manipulation_disconnect", client, timeout=0.3)
            except Exception:
                logger.warning(
                    "Manipulation stop acknowledgement unavailable during teardown", exc_info=True
                )
        for task in tuple(self._tasks):
            task.cancel()
        await asyncio.gather(*tuple(self._tasks), return_exceptions=True)
        self._rpc.close()


def admit_manipulation(
    request: ManipulationRequest, client_id: str, interaction: InteractionCoordinator
) -> ManipulationRequest | dict[str, Any]:
    payload = request.payload
    authority = interaction.authority
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
    target = interaction.target_for("manipulation", request.group_id)
    valid_target = target is not None and payload.get("target_revision") == target.revision
    allowed = (
        epoch == interaction.epoch and interaction.mode == "manual" and (owns or authority is None)
    )
    if request.action in {"acquire", "update"}:
        allowed = (
            allowed
            and owns
            and authority is not None
            and authority.kind == "manipulation_following"
        )
    elif request.action == "evaluate":
        allowed = allowed and owns and target is not None
    elif request.action in {"plan", "execute"}:
        allowed = allowed and valid_target
    elif request.action == "gripper":
        allowed = allowed and owns
    if not allowed:
        return {
            "status": "rejected",
            "code": "ownership",
            "message": "Robot interaction is owned or target changed",
        }
    advisory_current = False
    if request.action == "evaluate" and target is not None:
        advisory_current = bool(
            math.dist(payload["position"], target.position) < 1e-6
            and abs(
                sum(a * b for a, b in zip(payload["orientation"], target.orientation, strict=True))
            )
            > 1 - 1e-10
        )
    if request.action in {"update", "plan"} and target is not None:
        payload = {
            **payload,
            "position": list(target.position),
            "orientation": list(target.orientation),
            "speed_scale": target.speed_scale,
        }
        payload.pop("final_gripper", None)
        if request.action == "plan" and target.gripper is not None:
            payload["final_gripper"] = target.gripper
    if request.action == "cancel":
        interaction.cancel_manipulation_target(request.group_id)
    trusted = {
        **payload,
        "authority_epoch": interaction.epoch,
        "authority_lease": authority.lease_id if owns and authority is not None else None,
        "authority_revision": interaction.revision,
        "authority_deadline": authority.expires_at
        if request.action != "cancel" and owns and authority is not None
        else time.monotonic() + 0.5,
        "target_revision": target.revision if target is not None else 0,
    }
    if request.action == "evaluate":
        trusted["advisory_target_revision"] = (
            target.revision
            if advisory_current and target is not None
            else payload.get("target_revision")
        )
        trusted["advisory_current"] = advisory_current
    if request.action in {"execute", "reset_joints", "prepare_shutdown", "cancel"}:
        if request.action != "cancel" and interaction.motion_busy:
            return {"status": "rejected", "code": "busy"}
        if request.action == "reset_joints":
            interaction.clear_manipulation_target(request.group_id)
            trusted["authority_revision"] = interaction.revision
        interaction.begin_manipulation_motion(request.request_id)
        trusted["authority_revision"] = interaction.revision
    return replace(request, payload=trusted)
