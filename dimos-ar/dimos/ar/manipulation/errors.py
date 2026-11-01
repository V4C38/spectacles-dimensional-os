import re

RECOVERABLE_CODES = {"ik_failed", "joint_limit", "collision"}


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
