"""Bounded asynchronous dispatch to the optional manipulation Spec."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Awaitable, Callable
import logging
import time
from typing import Any

from dimos.ar.manipulation.errors import ManipulationError, spatial_error_code
from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.rpc import ManipulationRPC
from dimos.ar.manipulation.spec import ARManipulationSpec
from dimos.ar.websocket.protocol import encode_text

logger = logging.getLogger(__name__)

_STATE_CHANGING_ACTIONS = frozenset(
    {"acquire", "release", "cancel", "resume", "execute", "reset_joints", "prepare_shutdown"}
)


async def _unchanged(value: dict[str, Any]) -> dict[str, Any]:
    return value


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
        self._rpc = ManipulationRPC(runtime)
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
        self._shared_targets: dict[str, tuple[str, dict[str, Any]]] = {}
        self._shared_tokens: dict[str, tuple[str, str]] = {}
        self._shared_sequences: dict[str, int] = {}

    def start(self) -> None:
        self._poll = asyncio.create_task(self._poll_state())
        if self._control_state is not None:
            self._heartbeat = asyncio.create_task(self._heartbeat_loop())

    def follow_shared(self, client_id: str, group: str, body: dict[str, Any]) -> None:
        self._shared_targets[client_id] = (group, body)
        owned = self._shared_tokens.get(client_id)
        if owned is None or owned[0] != body["authority_lease"]:
            return
        token = owned[1]
        sequence = self._shared_sequences.get(client_id, 0) + 1
        self._shared_sequences[client_id] = sequence
        self.submit(ManipulationRequest(
            f"shared-follow-{token}-{sequence}", "update", group,
            {**body, "token": token, "sequence": sequence}), client_id)

    def suspend(self, client_id: str, deadline: float) -> None:
        self._spawn(self._rpc.call("ar_manipulation_suspend", client_id, deadline),
                    (client_id, "suspend"))

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
        except Exception as exc:  # noqa: BLE001 — RPC/native errors are protocol replies
            code = spatial_error_code(str(exc), "ik_failed")
            result = {"status": "infeasible", "code": code, "message": str(exc)}
        if result.get("status") == "following":
            return
        result["sequence"] = request.payload["sequence"]
        self._reply(client_id, request, result)

    async def _dispatch(
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
            code = exc.code if isinstance(exc, ManipulationError) else spatial_error_code(str(exc))
            recoverable = request.action in {"update", "evaluate", "plan"} and code in {
                "ik_failed",
                "joint_limit",
                "collision",
            }
            result = {
                "status": "infeasible" if recoverable else "rejected",
                "code": code,
                "message": str(exc),
            }
            if isinstance(exc, ManipulationError) and exc.failed_joints:
                result["failed_joints"] = exc.failed_joints
            logger.info("Manipulation request rejected: %s: %s", request.action, str(exc))
        except Exception as exc:
            logger.exception("Manipulation command failed")
            code = spatial_error_code(str(exc))
            recoverable = request.action in {"update", "evaluate", "plan"} and code in {
                "ik_failed",
                "joint_limit",
                "collision",
            }
            result = {
                "status": "uncertain" if request.action in {"execute", "reset_joints", "prepare_shutdown"} else "infeasible" if recoverable else "rejected",
                "code": "rpc_uncertain" if request.action in {"execute", "reset_joints", "prepare_shutdown"} else code,
                "message": str(exc),
            }
        if request.action == "update":
            if (request.request_id.startswith("shared-follow-")
                    and result.get("status") == "following"
                    and result.get("message") == "Following retired"):
                result = {**result, "status": "rejected", "code": "retired"}
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
        if request.action in {"evaluate", "update"}:
            position, orientation = request.payload.get("position"), request.payload.get("orientation")
            if position is not None and orientation is not None:
                result["sample_pose"] = {"position": list(position), "orientation": list(orientation)}
            revision = request.payload.get("advisory_target_revision", request.payload.get("target_revision"))
            if revision is not None:
                result["target_revision"] = revision
        if request.action == "gripper":
            key = (client_id, request.request_id)
            self._gripper_inflight.discard(key)
            self._gripper_results[key] = dict(result)
            self._gripper_results.move_to_end(key)
            while len(self._gripper_results) > 128:
                self._gripper_results.popitem(last=False)
        if request.action == "acquire" and isinstance(result.get("token"), str):
            lease = request.payload.get("authority_lease")
            if isinstance(lease, str):
                self._shared_tokens[client_id] = (lease, result["token"])
                pending = self._shared_targets.get(client_id)
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
                    time.monotonic() + 0.5,
                    timeout=0.3,
                )
            except Exception:
                logger.exception("Manipulation control-plane heartbeat unavailable")
                await self._rpc.wait_idle("ar_manipulation_heartbeat")
            await asyncio.sleep(0.1)

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
                prepared = await self._prepare_outbound(
                    {**snapshot, "type": "manipulation_state"}
                )
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
        self._shared_targets.pop(client_id, None)
        self._shared_tokens.pop(client_id, None)
        self._shared_sequences.pop(client_id, None)
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
