"""Robot-wide interaction authority and exact shared navigation facts.

All methods belong to ARModule's event loop. Rendering prediction/interpolation
never enters this owner. The injected clock is a monotonic sample timeline, not
robot odometry or headset exposure time.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, replace
import math
import time
from typing import Any, Literal
from uuid import uuid4

from dimos.ar.manipulation.protocol import ManipulationRequest

LEASE_DURATION_S = 0.5
MAX_REQUESTS_PER_CLIENT = 128
NAV_PREVIEW_POSITION_TOLERANCE_M = 0.2
NAV_PREVIEW_YAW_TOLERANCE_RAD = math.radians(15)
InteractionKind = Literal[
    "live", "navigation_planning", "joystick", "manipulation_planning", "manipulation_following"
]
InteractionMode = Literal["manual", "agent"]
InteractionAction = Literal[
    "acquire",
    "renew",
    "update",
    "release",
    "confirm",
    "cancel",
    "cancel_acquire",
    "snapshot",
    "mode",
]


@dataclass(frozen=True)
class InteractionRequest:
    request_id: str
    action: InteractionAction
    epoch: str | None = None
    acquisition_id: str | None = None
    lease_id: str | None = None
    sequence: int | None = None
    kind: InteractionKind | None = None
    source_id: str | None = None
    position: tuple[float, float, float] | None = None
    orientation: tuple[float, float, float, float] | None = None
    mode: InteractionMode | None = None
    group_id: str | None = None
    speed_scale: float | None = None
    gripper: float | None = None


@dataclass(frozen=True)
class Authority:
    client_id: str
    source_id: str
    acquisition_id: str
    lease_id: str
    kind: InteractionKind
    held: bool
    expires_at: float
    sequence: int = -1
    group_id: str | None = None

    def wire(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass(frozen=True)
class SharedTarget:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]
    revision: int
    phase: Literal["draft", "live", "committed"]
    sample_ts: float
    sequence: int
    domain: Literal["navigation", "manipulation"] = "navigation"
    group_id: str | None = None
    speed_scale: float = 0.5
    gripper: float | None = None

    def wire(self) -> dict[str, Any]:
        return {
            **{key: value for key, value in self.__dict__.items() if value is not None},
            "position": list(self.position),
            "orientation": list(self.orientation),
        }


@dataclass(frozen=True)
class InteractionResult:
    request_id: str
    status: Literal["accepted", "busy", "stale", "rejected"]
    code: str
    epoch: str
    revision: int
    lease_id: str | None = None

    def wire(self) -> dict[str, Any]:
        body = {"type": "interaction_result", **self.__dict__}
        if self.lease_id is None:
            del body["lease_id"]
        return body


class InteractionCoordinator:
    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        lease_duration_s: float = LEASE_DURATION_S,
    ) -> None:
        if not math.isfinite(lease_duration_s) or lease_duration_s <= 0:
            raise ValueError("lease duration must be finite and positive")
        self._clock = clock
        self._lease_duration = lease_duration_s
        self.epoch = uuid4().hex
        self._revision = 0
        self._mode: InteractionMode = "manual"
        self._authority: Authority | None = None
        self._targets: dict[tuple[str, str | None], SharedTarget] = {}
        self._active_target_key: tuple[str, str | None] | None = None
        self.preview: dict[str, Any] | None = None
        self._preview_aim: tuple[float, float, float, float] | None = None
        self.active_goal: dict[str, Any] | None = None
        self._pending_arm_motion: set[str] = set()
        self._arm_uncertain = False
        self._arm_stop_pending = False
        self._arm_native_busy = False
        self._arm_retired_motion: tuple[str, int] | None = None
        self._agent_busy = False
        self._motion_busy = False
        self.following_tail: dict[str, Any] | None = None
        self._tail_floor = 0
        self._clients: set[str] = set()
        self._requests: dict[str, OrderedDict[str, InteractionResult]] = {}
        self._cancelled: dict[str, OrderedDict[str, None]] = {}
        self._acquisitions: dict[str, OrderedDict[str, str]] = {}
        self._retired: list[tuple[Authority, str]] = []

    @property
    def target(self) -> SharedTarget | None:
        return self._targets.get(self._active_target_key) if self._active_target_key else None

    def target_for(self, domain: str, group_id: str | None = None) -> SharedTarget | None:
        return self._targets.get((domain, group_id))

    @property
    def revision(self) -> int:
        return self._revision

    @property
    def mode(self) -> InteractionMode:
        return self._mode

    @property
    def agent_busy(self) -> bool:
        return self._agent_busy

    @property
    def motion_busy(self) -> bool:
        return self._motion_busy

    @property
    def authority(self) -> Authority | None:
        return self._authority

    @property
    def mode_change_available(self) -> bool:
        return not (self._authority is not None or self._agent_busy
                    or self._motion_busy or self.following_tail is not None)

    def connect(self, client_id: str) -> None:
        self._clients.add(client_id)
        self._requests.setdefault(client_id, OrderedDict())
        self._cancelled.setdefault(client_id, OrderedDict())
        self._acquisitions.setdefault(client_id, OrderedDict())

    def disconnect(self, client_id: str) -> None:
        self._clients.discard(client_id)
        if self._authority is not None and self._authority.client_id == client_id:
            self._retire("disconnect")
        self._requests.pop(client_id, None)
        self._cancelled.pop(client_id, None)
        self._acquisitions.pop(client_id, None)

    def snapshot(self) -> dict[str, Any]:
        # Return fresh containers: transport consumers cannot mutate authoritative facts.
        import copy

        return {
            "type": "interaction_state",
            "epoch": self.epoch,
            "revision": self._revision,
            "motion_busy": self._motion_busy,
            "following_tail": copy.deepcopy(self.following_tail),
            "mode": self._mode,
            "authority": self._authority.wire() if self._authority is not None else None,
            "targets": [target.wire() for target in self._targets.values()],
            "preview": copy.deepcopy(self.preview),
            "active_goal": copy.deepcopy(self.active_goal),
        }

    def poll(self) -> bool:
        if self._authority is not None and self._clock() >= self._authority.expires_at:
            self._retire("expired")
            return True
        return False

    def drain_retirements(self) -> tuple[tuple[Authority, str], ...]:
        retired = tuple(self._retired)
        self._retired.clear()
        return retired

    def stop(self, reason: str = "stop") -> None:
        self._retire(reason)
        self.preview = None
        self.active_goal = None
        self.following_tail = None
        self._revision += 1
        self._tail_floor = self._revision

    def reset(self) -> None:
        self._retire("reference_reset")
        self.epoch = uuid4().hex
        self._active_target_key = None
        self.following_tail = None
        self._targets.clear()
        self.preview = self.active_goal = None
        self._requests = {client: OrderedDict() for client in self._clients}
        self._cancelled = {client: OrderedDict() for client in self._clients}
        self._acquisitions = {client: OrderedDict() for client in self._clients}
        self._revision += 1

    def authorized(
        self,
        client_id: str,
        epoch: str | None,
        lease_id: str | None,
        *,
        kind: InteractionKind | None = None,
    ) -> bool:
        self.poll()
        authority = self._authority
        return bool(
            self._mode == "manual"
            and client_id in self._clients
            and epoch == self.epoch
            and authority is not None
            and authority.client_id == client_id
            and authority.lease_id == lease_id
            and (kind is None or authority.kind == kind)
        )

    def set_preview(
        self,
        frame: dict[str, Any],
        *,
        epoch: str,
        lease_id: str,
        target_revision: int,
        source_position: tuple[float, float, float] | None = None,
        source_orientation: tuple[float, float, float, float] | None = None,
    ) -> bool:
        self.poll()
        source_pose = (
            (*source_position, self._navigation_yaw(source_orientation))
            if source_position is not None and source_orientation is not None
            else None
        )
        if (
            epoch != self.epoch
            or self._authority is None
            or self._authority.lease_id != lease_id
            or self._authority.kind != "navigation_planning"
            or self.target is None
            or target_revision > self.target.revision
            or (
                self.target.revision != target_revision
                and not self._preview_matches_target(frame, source_pose=source_pose)
            )
        ):
            return False
        import copy

        self.preview = copy.deepcopy(frame)
        self._preview_aim = source_pose
        self._revision += 1
        return True

    @staticmethod
    def _navigation_yaw(orientation: tuple[float, float, float, float]) -> float:
        x, y, z, w = orientation
        return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))

    def _preview_matches_target(
        self,
        frame: dict[str, Any],
        *,
        source_pose: tuple[float, float, float, float] | None = None,
    ) -> bool:
        # Navigation paths are advisory. Tracking jitter must not invalidate
        # every in-flight result while canonical target revisions keep advancing.
        target = self.target
        # The native safe-goal endpoint can differ from the requested aim.
        # Compare against the canonical aim captured by this worker when known.
        pose = source_pose if source_pose is not None else frame.get("pose")
        if target is None or target.domain != "navigation":
            return False
        if not isinstance(pose, (tuple, list)) or len(pose) != 4:
            return False
        if not all(
            isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)
            for value in pose
        ):
            return False
        yaw = self._navigation_yaw(target.orientation)
        delta = yaw - pose[3]
        yaw_error = abs(math.atan2(math.sin(delta), math.cos(delta)))
        return bool(
            math.dist(target.position, pose[:3]) < NAV_PREVIEW_POSITION_TOLERANCE_M
            and yaw_error < NAV_PREVIEW_YAW_TOLERANCE_RAD
        )

    def set_following_tail(self, tail: dict[str, Any] | None) -> None:
        import copy

        if tail is not None and (
            self._authority is not None or tail.get("generation", -1) < self._tail_floor
        ):
            return
        if tail != self.following_tail:
            # Keep the parked target at the endpoint the server will actually
            # finish, including when the last local pointer sample was invalid.
            target = self.target
            if (tail is not None and target is not None
                    and target.domain == "manipulation"
                    and target.group_id == tail.get("group_id")):
                position, orientation = tail.get("position"), tail.get("orientation")
                if (isinstance(position, (list, tuple)) and len(position) == 3
                        and isinstance(orientation, (list, tuple)) and len(orientation) == 4
                        and all(isinstance(v, (int, float)) and math.isfinite(v)
                                for v in (*position, *orientation))):
                    p = (float(position[0]), float(position[1]), float(position[2]))
                    q = (float(orientation[0]), float(orientation[1]),
                         float(orientation[2]), float(orientation[3]))
                    if p != target.position or q != target.orientation:
                        self._targets[(target.domain, target.group_id)] = replace(
                            target, position=p, orientation=q, revision=target.revision + 1,
                            sample_ts=self._clock(), phase="draft")
            self.following_tail = copy.deepcopy(tail)
            self._revision += 1

    def clear_manipulation_target(self, group_id: str) -> None:
        previous = self._targets.pop(("manipulation", group_id), None)
        if previous is not None:
            self._revision += 1

    def set_manipulation_gripper(self, group_id: str, value: float) -> None:
        key = ("manipulation", group_id)
        previous = self._targets.get(key)
        if previous is None or previous.gripper == value:
            return
        target = replace(previous, gripper=value, revision=previous.revision + 1,
                         sample_ts=self._clock())
        self._targets[key] = target
        self._revision += 1

    def observe_manipulation_snapshot(self, snapshot: dict[str, Any]) -> None:
        if snapshot.get("available") is not True:
            return
        execution = snapshot.get("execution")
        self.set_following_tail(snapshot.get("following_tail"))
        self._arm_native_busy = (
            snapshot.get("operation") in {"resetting", "parking"}
            or execution in {"accepted", "executing", "uncertain", "fault"}
        )
        # Live following is scoped to the editing lease; a normal release must
        # allow immediate takeover while native handoff finishes asynchronously.
        # Accepted execution/reset/parking and unresolved stop outcomes retain
        # their independent robot-wide busy guards.
        # A transport timeout can leave native work running. Only an explicit,
        # confirmed stop resolves that uncertainty; missing observations cannot.
        stopped = (
            snapshot.get("stopped") is True
            and snapshot.get("stop_confirmed") is True
            and snapshot.get("following") is not True
            and not self._arm_native_busy
            and execution in {"idle", "completed", "aborted", "rejected"}
        )
        if stopped:
            self._arm_uncertain = self._arm_stop_pending = False
        self._update_manipulation_busy()

    def observe_manipulation_result(self, request: ManipulationRequest, result: dict[str, Any]) -> None:
        retired = self._arm_retired_motion
        revision = request.payload.get("authority_revision", -1)
        if (retired is not None and request.payload.get("authority_epoch") == retired[0]
                and revision <= retired[1]):
            self._pending_arm_motion.discard(request.request_id)
            return
        if (request.action == "cancel" and request.request_id in self._pending_arm_motion
                and result.get("status") in {"cancelled", "completed", "aborted", "no_execution", "succeeded"}):
            self._arm_retired_motion = (self.epoch, revision)
            self._pending_arm_motion.clear()
            self._arm_native_busy = self._arm_uncertain = self._arm_stop_pending = False
            self.set_motion_busy(False)
            return
        if request.action == "gripper" and result.get("status") == "completed":
            authority = self._authority
            if (request.payload.get("authority_epoch") == self.epoch
                    and (authority is None or authority.lease_id == request.payload.get("authority_lease"))):
                self.set_manipulation_gripper(request.group_id, request.payload["value"])
        if request.action in {"execute", "reset_joints", "prepare_shutdown", "cancel"}:
            self._pending_arm_motion.discard(request.request_id)
            if (result.get("status") in {"uncertain", "fault"}
                    or (request.action == "cancel" and result.get("status") not in {"cancelled", "completed", "aborted", "no_execution", "succeeded"})):
                self._arm_uncertain = True
            self._update_manipulation_busy(accepted=result.get("status") == "accepted")

    def _update_manipulation_busy(self, *, accepted: bool = False) -> None:
        self.set_motion_busy(bool(self._pending_arm_motion) or self._arm_native_busy
                             or self._arm_uncertain or self._arm_stop_pending or accepted)

    def begin_manipulation_motion(self, request_id: str) -> None:
        if request_id in self._pending_arm_motion:
            return
        self._pending_arm_motion.add(request_id)
        # A released lease is revoked through its last revision. Reserve a new
        # admission even if native busy facts have not changed since release.
        self._revision += 1
        self._update_manipulation_busy()

    def manipulation_motion_pending(self, request_id: str) -> bool:
        return request_id in self._pending_arm_motion

    def request_manipulation_stop(self) -> None:
        self._arm_stop_pending = True
        self._update_manipulation_busy()

    def set_agent_busy(self, busy: bool) -> None:
        self._agent_busy = busy

    def confirm_native_manual(self) -> None:
        if self._mode != "manual":
            self._mode = "manual"
            self._revision += 1

    def suspend(self, client_id: str, deadline: float) -> bool:
        if not math.isfinite(deadline):
            raise ValueError("suspension deadline must be finite")
        if self._authority is None or self._authority.client_id != client_id:
            return False
        self._authority = replace(self._authority, expires_at=deadline)
        self._revision += 1
        return True

    def cancel_manipulation_target(self, group_id: str) -> None:
        self.clear_manipulation_target(group_id)
        # Cancellation must outrank revocation even when no draft remains.
        self._revision += 1

    def set_motion_busy(self, busy: bool) -> None:
        if busy != self._motion_busy:
            self._motion_busy = busy
            self._revision += 1

    def set_active_goal(self, frame: dict[str, Any] | None) -> None:
        import copy

        self.active_goal = copy.deepcopy(frame)
        self._revision += 1

    def handle(
        self,
        client_id: str,
        request: InteractionRequest,
        *,
        commit: Callable[[SharedTarget, InteractionKind], bool] | None = None,
    ) -> InteractionResult:
        self.poll()
        if client_id not in self._clients:
            return self._result(request, "rejected", "connection_retired")
        cache = self._requests[client_id]
        previous = cache.get(request.request_id)
        if previous is not None:
            # A replayed grant can report success only while that exact lease is live.
            if previous.lease_id is not None and (
                self._authority is None or self._authority.lease_id != previous.lease_id
            ):
                return self._result(request, "stale", "lease_retired")
            return replace(previous, revision=self._revision)
        if request.action == "snapshot":
            result = self._result(request, "accepted", "snapshot")
        elif request.epoch != self.epoch:
            result = self._result(request, "stale", "epoch_changed")
        elif request.action == "cancel_acquire":
            acquisition = request.acquisition_id or request.request_id
            self._remember(self._cancelled[client_id], acquisition, None)
            if (
                self._authority is not None
                and self._authority.client_id == client_id
                and self._authority.acquisition_id == acquisition
            ):
                self._retire("cancelled_acquisition")
            result = self._result(request, "accepted", "acquisition_cancelled")
        elif request.action == "mode":
            result = self._change_mode(request)
        elif request.action == "acquire":
            result = self._acquire(client_id, request)
        elif not self.authorized(client_id, request.epoch, request.lease_id):
            result = self._result(request, "busy" if self._authority else "stale", "not_owner")
        else:
            result = self._owned(request, commit)
        self._remember(cache, request.request_id, result)
        return result

    def _change_mode(self, request: InteractionRequest) -> InteractionResult:
        if request.mode not in ("manual", "agent"):
            return self._result(request, "rejected", "invalid_mode")
        if not self.mode_change_available:
            return self._result(request, "busy", "robot_busy")
        if self._mode != request.mode:
            self._mode = request.mode
            self._revision += 1
        return self._result(request, "accepted", "mode_changed")

    def _acquire(self, client_id: str, request: InteractionRequest) -> InteractionResult:
        acquisition = request.acquisition_id or request.request_id
        if acquisition in self._cancelled[client_id]:
            return self._result(request, "stale", "acquisition_cancelled")
        known = self._acquisitions[client_id].get(acquisition)
        if known is not None:
            if self._authority is not None and self._authority.lease_id == known:
                return self._result(request, "accepted", "already_acquired", known)
            return self._result(request, "stale", "acquisition_retired")
        if (
            self._mode != "manual"
            or self._agent_busy
            or self._motion_busy
            or self._authority is not None
        ):
            return self._result(request, "busy", "robot_busy")
        if request.kind not in (
            "live",
            "navigation_planning",
            "joystick",
            "manipulation_planning",
            "manipulation_following",
        ):
            return self._result(request, "rejected", "invalid_kind")
        lease = uuid4().hex
        self.following_tail = None
        self._authority = Authority(
            client_id,
            request.source_id or "default",
            acquisition,
            lease,
            request.kind,
            True,
            self._clock() + self._lease_duration,
            group_id=request.group_id,
        )
        self._remember(self._acquisitions[client_id], acquisition, lease)
        self._revision += 1
        if request.position is not None and request.orientation is not None:
            self._update_target(request, sequence=-1)
        elif request.kind != "joystick":
            domain = "manipulation" if request.kind.startswith("manipulation_") else "navigation"
            self._active_target_key = (domain, request.group_id)
        self._tail_floor = self._revision
        return self._result(request, "accepted", "acquired", lease)

    def _owned(
        self,
        request: InteractionRequest,
        commit: Callable[[SharedTarget, InteractionKind], bool] | None,
    ) -> InteractionResult:
        authority = self._authority
        assert authority is not None
        if request.action == "renew":
            self._authority = replace(authority, expires_at=self._clock() + self._lease_duration)
            self._revision += 1
            return self._result(request, "accepted", "renewed", authority.lease_id)
        if request.action == "cancel":
            if authority.kind == "navigation_planning":
                self._targets.pop(("navigation", None), None)
                self._active_target_key = None
            self._retire("cancelled")
            return self._result(request, "accepted", "cancelled")
        if request.action not in ("update", "release", "confirm"):
            return self._result(request, "rejected", "invalid_action")
        if request.sequence is None or request.sequence <= authority.sequence:
            return self._result(request, "stale", "sequence_retired")
        if request.action == "confirm" and authority.kind != "navigation_planning":
            return self._result(request, "rejected", "not_planning")
        if request.position is None or request.orientation is None:
            if authority.kind != "joystick":
                return self._result(request, "rejected", "pose_required")
        else:
            self._update_target(request, sequence=request.sequence)
        self._authority = replace(
            authority,
            sequence=request.sequence,
            expires_at=self._clock() + self._lease_duration,
        )
        self._revision += 1
        if request.action == "update":
            return self._result(request, "accepted", "updated", authority.lease_id)
        if request.action == "release" and authority.kind == "navigation_planning":
            self._authority = replace(self._authority, held=False)
            self._revision += 1
            return self._result(request, "accepted", "planning", authority.lease_id)
        target = self.target
        if authority.kind in {"live", "navigation_planning"} and target is not None:
            if commit is not None and not commit(target, authority.kind):
                return self._result(request, "rejected", "native_unavailable", authority.lease_id)
            self._targets[(target.domain, target.group_id)] = replace(target, phase="committed")
        self._retire("released" if request.action == "release" else "confirmed")
        return self._result(request, "accepted", "released")

    def _update_target(self, request: InteractionRequest, *, sequence: int) -> None:
        assert request.position is not None and request.orientation is not None
        assert self._authority is not None
        position = request.position
        orientation = request.orientation
        if not all(math.isfinite(v) for v in (*position, *orientation)):
            raise ValueError("target pose must be finite")
        norm = math.hypot(*orientation)
        if norm < 1e-6:
            raise ValueError("target orientation must be nonzero")
        orientation = tuple(v / norm for v in orientation)  # type: ignore[assignment]
        domain: Literal["navigation", "manipulation"] = (
            "manipulation" if self._authority.kind.startswith("manipulation_") else "navigation"
        )
        group = self._authority.group_id
        self._active_target_key = (domain, group)
        previous = self._targets.get(self._active_target_key)
        phase: Literal["draft", "live", "committed"] = (
            "draft" if self._authority.kind.endswith("planning") else "live"
        )
        speed = (
            request.speed_scale
            if request.speed_scale is not None
            else previous.speed_scale
            if previous is not None
            else 0.5
        )
        gripper = (
            request.gripper
            if request.gripper is not None
            else previous.gripper
            if previous is not None
            else None
        )
        if (
            previous is not None
            and previous.position == position
            and previous.orientation == orientation
            and previous.speed_scale == speed
            and previous.gripper == gripper
        ):
            self._targets[self._active_target_key] = replace(previous, phase=phase, sequence=sequence)
            if previous.phase != phase:
                self._revision += 1
            return
        self._targets[self._active_target_key] = SharedTarget(
            position,
            orientation,
            1 if previous is None else previous.revision + 1,
            phase,
            self._clock(),
            sequence,
            domain,
            group,
            speed,
            gripper,
        )
        if self.preview is not None and not self._preview_matches_target(
            self.preview, source_pose=self._preview_aim
        ):
            self.preview = None
        self._revision += 1

    def _retire(self, reason: str) -> None:
        if self._authority is None:
            return
        self._retired.append((self._authority, reason))
        self._authority = None
        self.preview = None
        self._revision += 1

    def _result(
        self,
        request: InteractionRequest,
        status: Literal["accepted", "busy", "stale", "rejected"],
        code: str,
        lease_id: str | None = None,
    ) -> InteractionResult:
        return InteractionResult(
            request.request_id, status, code, self.epoch, self._revision, lease_id
        )

    @staticmethod
    def _remember(cache: OrderedDict[str, Any], key: str, value: Any) -> None:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > MAX_REQUESTS_PER_CLIENT:
            cache.popitem(last=False)
