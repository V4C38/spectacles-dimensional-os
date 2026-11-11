import re
from typing import Any

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
