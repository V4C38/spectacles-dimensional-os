"""Validated manipulation messages and integration contracts without arm runtime imports."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Protocol

from dimos.ar.numeric import finite_number as number
from dimos.spec.utils import Spec

ACTIONS = frozenset(
    {
        "evaluate",
        "plan",
        "execute",
        "cancel",
        "resume",
        "acquire",
        "update",
        "release",
        "gripper",
        "reset_joints",
        "prepare_shutdown",
    }
)


@dataclass(frozen=True)
class ManipulationRequest:
    request_id: str
    action: str
    group_id: str
    payload: dict[str, Any]


def identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError(f"{name} must contain 1 to 128 characters")
    return value


def decode_request(data: dict[str, Any]) -> ManipulationRequest:
    request_id = identifier(data.get("request_id"), "request_id")
    group_id = identifier(data.get("group_id"), "group_id")
    action = data.get("action")
    if not isinstance(action, str) or action not in ACTIONS:
        raise ValueError("unknown manipulation action")
    payload: dict[str, Any] = {}
    for field in ("epoch", "lease_id"):
        if field in data:
            payload[field] = identifier(data[field], field)
    for field in ("sequence", "target_revision"):
        if field in data:
            value = data[field]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{field} must be a nonnegative integer")
            payload[field] = value

    if action in {"evaluate", "plan", "update"}:
        for key, count in (("position", 3), ("orientation", 4)):
            values = data.get(key)
            if not isinstance(values, list) or len(values) != count:
                raise ValueError(f"{key} must contain {count} numbers")
            payload[key] = [number(v, key) for v in values]
        if abs(sum(v * v for v in payload["orientation"]) - 1) > 1e-4:
            raise ValueError("orientation must be a unit quaternion")
    if action in {"execute", "release", "update"}:
        key = "plan_id" if action == "execute" else "token"
        payload[key] = identifier(data.get(key), key)
    if action == "update":
        sequence = data.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ValueError("sequence must be a nonnegative integer")
        payload["sequence"] = sequence
        payload["ts"] = number(data.get("ts"), "ts")
    if action in {"plan", "update", "reset_joints", "prepare_shutdown"}:
        speed = number(
            data.get("speed_scale", 0.2 if action == "prepare_shutdown" else 0.5), "speed_scale"
        )
        if not 0 < speed <= 1:
            raise ValueError("speed_scale must be in (0, 1]")
        payload["speed_scale"] = speed
    if action == "plan" and "final_gripper" in data:
        value = number(data["final_gripper"], "final_gripper")
        if not 0 <= value <= 1:
            raise ValueError("final_gripper must be in [0, 1]")
        payload["final_gripper"] = value
    if action == "gripper":
        value = number(data.get("value"), "value")
        if not 0 <= value <= 1:
            raise ValueError("gripper value must be in [0, 1]")
        payload["value"] = value
    return ManipulationRequest(request_id, action, group_id, payload)


RECOVERABLE_CODES = frozenset({"ik_failed", "joint_limit", "collision"})


def spatial_error_code(message: str | None, default: str = "rejected") -> str:
    text = (message or "").lower()
    if "limit" in text:
        return "joint_limit"
    if "collision" in text:
        return "collision"
    if re.search(
        r"\bik\b|unreachable|infeasible|no[ _]?solution|converg|qp[ _](solver|failed)|configuration.?limits",
        text,
    ):
        return "ik_failed"
    return default


class ManipulationError(ValueError):
    def __init__(self, code: str, message: str, failed_joints: list[str] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.failed_joints = failed_joints or []


class ExecutionNotStartedError(ManipulationError):
    """A checked admission failure that guarantees no motion was dispatched."""


def rejection_result(action: object, error: Exception, *, transport: bool = False) -> dict[str, Any]:
    code = error.code if isinstance(error, ManipulationError) else spatial_error_code(str(error))
    recoverable = (isinstance(action, str) and action in {"update", "evaluate", "plan"}
                   and code in RECOVERABLE_CODES)
    uncertain = (transport and isinstance(action, str)
                 and action in {"execute", "reset_joints", "prepare_shutdown"})
    result: dict[str, Any] = {
        "status": "uncertain" if uncertain else "infeasible" if recoverable else "rejected",
        "code": "rpc_uncertain" if uncertain else code,
        "message": str(error),
    }
    if isinstance(error, ManipulationError) and error.failed_joints:
        result["failed_joints"] = error.failed_joints
    return result


class ARManipulationSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_manipulation_command(
        self, client_id: str, request: dict[str, Any]
    ) -> dict[str, Any]: ...

    def ar_manipulation_evaluate_following(
        self, client_id: str, request: dict[str, Any]
    ) -> dict[str, Any]: ...

    def ar_manipulation_snapshot(self) -> dict[str, Any]: ...

    def ar_manipulation_disconnect(self, client_id: str) -> None: ...

    def ar_manipulation_suspend(self, client_id: str, deadline: float) -> None: ...

    def ar_manipulation_stop(
        self, epoch: str | None = None, revision: int | None = None
    ) -> None: ...

    def ar_manipulation_revoke(
        self, epoch: str, lease_id: str, revision: int, reason: str = "released"
    ) -> None: ...

    def ar_manipulation_heartbeat(self, epoch: str, revision: int, deadline: float) -> None: ...

    def ar_manipulation_asset(self, kind: str, revision: str) -> dict[str, Any] | None: ...
