"""Application interaction orchestration, separate from DimOS stream wiring.

The coordinator owns replicated facts; this controller owns asynchronous mode
changes, native input admission, and delivery. Native services keep their own
execution lifecycles. All controller transitions run on the AR asyncio loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
import time
from typing import Any

import websockets.asyncio.server as ws_server

from dimos.ar.async_execution import NativeRPC
from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.service import ManipulationService, admit_manipulation
from dimos.ar.navigation.preview import NavigationPreviewService
from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest, NavJoystickRequest
from dimos.ar.replication.interaction import (
    InteractionCoordinator,
    InteractionKind,
    InteractionRequest,
    InteractionResult,
    SharedTarget,
)
from dimos.ar.robot.agent_control import ARAgentControlSpec
from dimos.ar.robot.capabilities import NAV_GOAL, CapabilityName, CapabilitySet
from dimos.ar.websocket.protocol import encode_text, navigation_payload
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


@dataclass(frozen=True)
class InteractionPorts:
    """Explicit host effects and observed availability; never a module back-reference."""

    capabilities: Callable[[], CapabilitySet]
    mapping_restart_required: Callable[[], bool]
    manipulation: Callable[[], ManipulationService | None]
    agent_control: Callable[[], ARAgentControlSpec | None]
    agent_idle: Callable[[], bool]
    previews: Callable[[], NavigationPreviewService]
    commit_target: Callable[[SharedTarget, InteractionKind], bool]
    submit_goal: Callable[[NavGoalRequest], bool]
    cancel_joystick: Callable[[], None]
    stop_navigation: Callable[[], object]
    broadcast_state: Callable[[], None]
    send: Callable[[str, str], None]
    broadcast: Callable[[str], None]
    prepare_outbound: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
    operation_stopped: Callable[[], bool] = lambda: False
    retire_navigation: Callable[[], object] = lambda: None


class InteractionController:
    def __init__(self, ports: InteractionPorts) -> None:
        self._ports = ports
        self._state = InteractionCoordinator()
        self._mode_task: asyncio.Task[None] | None = None
        self._agent_stop_task: asyncio.Task[None] | None = None
        self._native_mode_rpc: NativeRPC | None = None
        self._native_mode_uncertain = False
        self._agent_stop_requested = False
        self._poll_task: asyncio.Task[None] | None = None
        self._sent_revision = -1
        self._native_sequences: dict[str, int] = {}
        self._closed = False

    @property
    def state(self) -> InteractionCoordinator:
        return self._state

    @property
    def mode_task(self) -> asyncio.Task[None] | None:
        return self._mode_task or self._agent_stop_task

    @property
    def native_mode_uncertain(self) -> bool:
        return self._native_mode_uncertain

    @property
    def agent_input_available(self) -> bool:
        return (
            not self._closed
            and not self._ports.operation_stopped()
            and self.mode_task is None
            and not self._native_mode_uncertain
            and self._state.mode == "agent"
            and self._state.authority is None
        )

    def stop_agent(self) -> None:
        """Retire agent work on Stop without implicitly resuming it later."""
        if self._closed or not self._ports.capabilities().supports(CapabilityName.AGENT):
            return
        self._agent_stop_requested = True
        self._native_mode_uncertain = True
        self._state.confirm_native_manual()
        if self._ports.agent_control() is not None and self._agent_stop_task is None:
            self._agent_stop_task = asyncio.create_task(self._stop_native_agent())

    async def _stop_native_agent(self) -> None:
        reported = False
        try:
            control = self._ports.agent_control()
            assert control is not None
            if self._native_mode_rpc is None:
                self._native_mode_rpc = NativeRPC(control)
            while self._agent_stop_requested and not self._closed:
                await self._native_mode_rpc.wait_idle("ar_agent_takeover")
                try:
                    # Dispatch Stop immediately, independently of an obsolete
                    # mode RPC. A timeout never releases that actual RPC's slot.
                    accepted = await self._native_mode_rpc.call("ar_agent_takeover", timeout=2)
                    if accepted:
                        await self._native_mode_rpc.wait_idle("ar_agent_set_manual")
                        if self._mode_task is not None:
                            await asyncio.sleep(0.01)
                            continue
                        # A late resume may have completed after the first Stop.
                        # Confirm the final pause after every old effect drained.
                        accepted = await self._native_mode_rpc.call("ar_agent_takeover", timeout=2)
                except Exception:
                    accepted = False
                    if not reported:
                        logger.exception("Native agent stop could not be confirmed")
                        reported = True
                if accepted:
                    self._agent_stop_requested = False
                    self._native_mode_uncertain = False
                    self._state.confirm_native_manual()
                    self.broadcast(force=True)
                    return
                await asyncio.sleep(0.1)
        finally:
            self._agent_stop_task = None
            self._state.set_agent_busy(not self._ports.agent_idle())
            self._ports.broadcast_state()

    def _finish_mode_task(self) -> None:
        self._mode_task = None
        if (self._agent_stop_requested and not self._closed and self._agent_stop_task is None
                and self._ports.agent_control() is not None):
            self._agent_stop_task = asyncio.create_task(self._stop_native_agent())

    def last_native_sequence(self, lease_id: str) -> int:
        return self._native_sequences.get(lease_id, -1)

    def start(self) -> None:
        if not self._closed and self._poll_task is None:
            self._poll_task = asyncio.create_task(self._poll_interaction())

    async def close(self) -> None:
        self._closed = True
        tasks = [task for task in (self._mode_task, self._agent_stop_task, self._poll_task) if task is not None]
        for task in tasks:
            task.cancel()
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            try:
                if self._native_mode_rpc is not None:
                    self._native_mode_rpc.close()
            finally:
                self._native_mode_rpc = None
                self._mode_task = None
                self._agent_stop_task = None
                self._poll_task = None

    async def _poll_interaction(self) -> None:
        while True:
            self._state.poll()
            self.drain_retirements()
            self.broadcast()
            await asyncio.sleep(0.05)

    def broadcast(self, *, force: bool = False) -> None:
        if self._closed:
            return
        if force or self._sent_revision != self._state.revision:
            self._sent_revision = self._state.revision
            self._ports.broadcast(encode_text(self._state.snapshot()))

    def drain_retirements(self) -> None:
        manipulation = self._ports.manipulation()
        for authority, reason in self._state.drain_retirements():
            self._ports.previews().cancel(authority.client_id)
            self._native_sequences.pop(authority.lease_id, None)
            if authority.kind.startswith("manipulation_") and manipulation is not None:
                manipulation.revoke(
                    self._state.epoch, authority.lease_id, self._state.revision, reason
                )
            if authority.kind == "joystick":
                self._ports.cancel_joystick()
            elif authority.kind == "live" and reason not in {"released", "confirmed"}:
                self._ports.cancel_joystick()
                self._ports.stop_navigation()
                self._state.set_active_goal(None)
                self.broadcast(force=True)
                self._ports.broadcast_state()

    def handle_request(self, request: InteractionRequest, client_id: str) -> None:
        if self._closed:
            return
        if self._ports.operation_stopped() and request.action in {"acquire", "takeover", "confirm", "mode"}:
            self._interaction_reply(request, client_id, "rejected", "operation_stopped")
            return
        manipulation = self._ports.manipulation()
        self._state.poll()
        self.drain_retirements()
        if request.action == "takeover":
            if self._state.takeover_pending(client_id, request.request_id):
                return
            if (not self._ports.capabilities().supports(CapabilityName.AGENT)
                    or not self._ports.capabilities().supports_navigation(NAV_GOAL)
                    or self._ports.mapping_restart_required()):
                self._interaction_reply(request, client_id, "rejected", "navigation_unavailable")
                return
            if self.mode_task is not None or self._native_mode_uncertain:
                self._interaction_reply(request, client_id, "busy", "robot_busy")
                return
            previous = self._state.reserve_takeover(client_id, request)
            if previous is not None:
                self._ports.send(client_id, encode_text(previous.wire()))
                return
            if self._ports.agent_control() is None:
                self._state.retire_takeover()
                self._interaction_reply(request, client_id, "rejected", "native_quiescence_unavailable")
                return
            self._mode_task = asyncio.create_task(self._takeover_native_agent(request, client_id))
            return
        if request.action == "mode":
            previous = self._state.preflight(client_id, request)
            if previous is not None:
                self._ports.send(client_id, encode_text(previous.wire()))
                return
        if (
            request.action == "mode"
            and (request.mode != self._state.mode or self._native_mode_uncertain)
            and self._ports.capabilities().supports(CapabilityName.AGENT)
        ):
            if self.mode_task is not None or not self._state.mode_change_available:
                self._interaction_reply(request, client_id, "busy", "robot_busy")
                return
            if self._ports.agent_control() is None:
                self._interaction_reply(
                    request, client_id, "rejected", "native_quiescence_unavailable"
                )
                return
            self._state.set_agent_busy(True)
            self._mode_task = asyncio.create_task(self._change_native_mode(request, client_id))
            return
        if request.action == "acquire" and (
            self.mode_task is not None or self._native_mode_uncertain
        ):
            self._interaction_reply(request, client_id, "busy", "robot_busy")
            return
        if (
            request.action == "mode"
            and request.mode == "agent"
            and not self._ports.capabilities().supports(CapabilityName.AGENT)
        ):
            reply = {
                "type": "interaction_result",
                "request_id": request.request_id,
                "status": "rejected",
                "code": "agent_unavailable",
                "epoch": self._state.epoch,
                "revision": self._state.revision,
            }
        elif request.action == "acquire" and (
            not self._ports.capabilities().supports(
                CapabilityName.MANIPULATION
                if request.kind is not None and request.kind.startswith("manipulation_")
                else CapabilityName.NAVIGATION
            )
            or self._ports.mapping_restart_required()
        ):
            reply = {
                "type": "interaction_result",
                "request_id": request.request_id,
                "status": "rejected",
                "code": "navigation_unavailable",
                "epoch": self._state.epoch,
                "revision": self._state.revision,
            }
        else:
            previous_target = self._state.target
            result = self._state.handle(client_id, request, commit=self._ports.commit_target)
            self._reconcile_manipulation_authority(request, result, previous_target, manipulation)
            reply = result.wire()
        accepted_sample = reply.get("status") == "accepted" and request.action in {
            "update",
            "renew",
        }
        if accepted_sample and manipulation is not None:
            self._forward_following_target(client_id, manipulation)
        self.drain_retirements()
        if not accepted_sample:
            self._ports.send(client_id, encode_text(reply))
        # High-rate target samples are coalesced by the 20Hz loop. Authority
        # transitions and their exact final poses are delivered immediately.
        if request.action not in {"update", "renew"}:
            self.broadcast(force=True)

    def _reconcile_manipulation_authority(
        self,
        request: InteractionRequest,
        result: InteractionResult,
        previous_target: SharedTarget | None,
        manipulation: ManipulationService | None,
    ) -> None:
        authority = self._state.authority
        if (
            manipulation is not None
            and authority is not None
            and authority.kind == "manipulation_planning"
            and self._state.target is not None
            and (
                previous_target is None
                or self._state.target.domain != previous_target.domain
                or self._state.target.group_id != previous_target.group_id
                or self._state.target.revision != previous_target.revision
            )
        ):
            manipulation.revoke(
                self._state.epoch,
                authority.lease_id,
                # Retire work preceding this edit, not requests admitted for it.
                self._state.revision - 1,
                "target_changed",
            )
        if (
            request.action == "acquire"
            and result.status == "accepted"
            and result.code == "acquired"
            and manipulation is not None
        ):
            manipulation.revoke(
                self._state.epoch,
                result.lease_id or "",
                self._state.revision - 1,
                "superseded",
            )

    def _forward_following_target(self, client_id: str, manipulation: ManipulationService) -> None:
        authority = self._state.authority
        target = self._state.target
        if (
            authority is not None
            and authority.kind == "manipulation_following"
            and target is not None
            and authority.group_id is not None
        ):
            manipulation.follow_shared(
                client_id,
                authority.group_id,
                {
                    "position": list(target.position),
                    "orientation": list(target.orientation),
                    "speed_scale": target.speed_scale,
                    "sequence": authority.sequence,
                    "ts": time.time(),
                    "authority_epoch": self._state.epoch,
                    "authority_lease": authority.lease_id,
                    "authority_revision": self._state.revision,
                    "authority_deadline": authority.expires_at,
                    "target_revision": target.revision,
                },
            )

    def _interaction_reply(
        self, request: InteractionRequest, client_id: str, status: str, code: str
    ) -> None:
        self._ports.send(
            client_id,
            encode_text(
                {
                    "type": "interaction_result",
                    "request_id": request.request_id,
                    "status": status,
                    "code": code,
                    "epoch": self._state.epoch,
                    "revision": self._state.revision,
                }
            ),
        )

    async def _takeover_native_agent(self, request: InteractionRequest, client_id: str) -> None:
        try:
            control = self._ports.agent_control()
            assert control is not None
            if self._native_mode_rpc is None:
                self._native_mode_rpc = NativeRPC(control)
            accepted = await self._native_mode_rpc.call("ar_agent_takeover", timeout=2)
            if not accepted:
                self._native_mode_uncertain = True
                self._interaction_reply(request, client_id, "busy", "native_motion_active")
                return
            if self._agent_stop_task is None:
                self._native_mode_uncertain = False
                self._agent_stop_requested = False
            self._ports.retire_navigation()
            # Retire old native terminal/path facts before publishing the new
            # lease, so canceled agent telemetry cannot terminate the grab.
            self._ports.broadcast_state()
            if self._ports.operation_stopped():
                self._state.retire_takeover()
                self._state.confirm_native_manual()
                self._interaction_reply(request, client_id, "rejected", "operation_stopped")
            else:
                result = self._state.complete_takeover(client_id, request)
                self._ports.send(client_id, encode_text(result.wire()))
            self.broadcast(force=True)
            self._ports.broadcast_state()
        except TimeoutError:
            self._native_mode_uncertain = True
            self._interaction_reply(request, client_id, "rejected", "native_mode_timeout")
        except Exception:
            self._native_mode_uncertain = True
            logger.exception("Native agent takeover failed")
            self._interaction_reply(request, client_id, "rejected", "native_mode_failed")
        finally:
            self._state.retire_takeover()
            self._finish_mode_task()

    async def _change_native_mode(self, request: InteractionRequest, client_id: str) -> None:
        try:
            control = self._ports.agent_control()
            assert control is not None
            if self._native_mode_rpc is None:
                self._native_mode_rpc = NativeRPC(control)
            accepted = await self._native_mode_rpc.call(
                "ar_agent_set_manual",
                request.mode == "manual",
                timeout=2,
            )
            if accepted and request.mode == "agent" and (
                request.epoch != self._state.epoch or self._ports.operation_stopped()
                or self._agent_stop_requested
            ):
                # A source reset invalidates a pending resume. Confirm a native
                # pause before publishing manual; unknown outcomes stay fenced.
                paused = await self._native_mode_rpc.call("ar_agent_takeover", timeout=2)
                if paused:
                    if self._agent_stop_task is None:
                        self._agent_stop_requested = False
                    self._state.confirm_native_manual()
                self._native_mode_uncertain = not paused or self._agent_stop_requested
                self._interaction_reply(request, client_id, "stale",
                                        "epoch_changed" if request.epoch != self._state.epoch
                                        else "operation_stopped")
                self.broadcast(force=True)
                return
            self._state.set_agent_busy(not self._ports.agent_idle())
            # Native acknowledgement is a fact even if the requester or source
            # retired during the RPC. Reconcile before rejecting the old request.
            if accepted:
                assert request.mode is not None
                self._state.confirm_native_mode(request.mode)
            self._native_mode_uncertain = self._native_mode_uncertain and not accepted
            if request.epoch != self._state.epoch:
                self._interaction_reply(request, client_id, "stale", "epoch_changed")
            elif not accepted:
                self._interaction_reply(request, client_id, "busy", "native_motion_active")
            else:
                result = self._state.complete_native_mode(client_id, request)
                self._ports.send(client_id, encode_text(result.wire()))
            self.broadcast(force=True)
        except TimeoutError:
            self._native_mode_uncertain = True
            self._interaction_reply(request, client_id, "rejected", "native_mode_timeout")
        except Exception:
            self._native_mode_uncertain = True
            logger.exception("Native robot mode transition failed")
            self._interaction_reply(request, client_id, "rejected", "native_mode_failed")
        finally:
            self._state.set_agent_busy(not self._ports.agent_idle())
            self._finish_mode_task()

    def authorize_native(
        self, client_id: str, msg: NavGoalRequest | NavJoystickRequest, kind: InteractionKind
    ) -> bool:
        if self._closed or self._ports.operation_stopped():
            return False
        allowed = self._state.authorized(client_id, msg.epoch, msg.lease_id, kind=kind)
        self.drain_retirements()
        authority = self._state.authority
        if not allowed or authority is None or msg.sequence is None:
            return False
        if msg.sequence < authority.sequence or msg.sequence <= self._native_sequences.get(
            authority.lease_id, -1
        ):
            return False
        self._native_sequences[authority.lease_id] = msg.sequence
        return True

    def handle_navigation(
        self, msg: NavGoalRequest, _websocket: ws_server.ServerConnection, client_id: str
    ) -> None:
        if (
            self._closed
            or self._ports.operation_stopped()
            or not self._ports.capabilities().supports_navigation(NAV_GOAL)
            or self._ports.mapping_restart_required()
        ):
            return
        if msg.preview:
            if not self._state.authorized(
                client_id, msg.epoch, msg.lease_id, kind="navigation_planning"
            ):
                self.drain_retirements()
                return
            target = self._state.target
            if target is None:
                return
            self._ports.previews().request(
                replace(
                    msg,
                    position=target.position,
                    orientation=target.orientation,
                    target_revision=target.revision,
                ),
                client_id,
            )
            return
        if not self.authorize_native(client_id, msg, "live"):
            return
        target = self._state.target
        if target is not None and target.domain == "navigation":
            self._ports.submit_goal(
                replace(msg, position=target.position, orientation=target.orientation)
            )

    async def observe_preview(self, client_id: str, request: NavGoalRequest, frame: object) -> None:
        # The worker may complete after release, expiry, handover or aim changes.
        if self._closed or not isinstance(frame, NavGoalFrame):
            return
        if request.epoch is None or request.lease_id is None or request.target_revision is None:
            return
        body = await self._ports.prepare_outbound(navigation_payload(frame))
        if not self._closed and self._state.set_preview(
            body,
            epoch=request.epoch,
            lease_id=request.lease_id,
            target_revision=request.target_revision,
            source_position=request.position,
            source_orientation=request.orientation,
        ):
            self.broadcast()

    def observe_manipulation_snapshot(self, snapshot: dict[str, Any]) -> None:
        self._state.observe_manipulation_snapshot(snapshot)

    def observe_manipulation_result(
        self, request: ManipulationRequest, result: dict[str, Any]
    ) -> None:
        self._state.observe_manipulation_result(request, result)

    def handle_manipulation(
        self, request: ManipulationRequest, client_id: str, clock_offset: float
    ) -> None:
        service = self._ports.manipulation()
        if self._closed or service is None:
            return
        self._state.poll()
        self.drain_retirements()
        admitted: ManipulationRequest | dict[str, Any]
        if request.action not in {"cancel", "resume", "release"} and (
            self.mode_task is not None
            or self._native_mode_uncertain
            or self._ports.operation_stopped()
        ):
            admitted = {"status": "rejected", "code": "busy"}
        else:
            admitted = admit_manipulation(request, client_id, self._state)
        if isinstance(admitted, ManipulationRequest):
            service.submit(admitted, client_id, clock_offset)
        else:
            self._ports.send(
                client_id,
                encode_text(
                    {
                        "type": "manipulation_result",
                        "request_id": request.request_id,
                        "action": request.action,
                        "group_id": request.group_id,
                        **admitted,
                    }
                ),
            )
