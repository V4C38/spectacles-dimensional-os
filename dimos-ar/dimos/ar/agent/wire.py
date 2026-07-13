"""Agent wire encode/decode — keep in sync with PROTOCOL.md."""

from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any, Literal

WireAgentState = Literal["idle", "busy"]


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class AgentCommandMessage:
    ts: float
    robot_id: str
    text: str


@dataclass(frozen=True)
class ArSkillResultMessage:
    ts: float
    robot_id: str
    request_id: str
    ok: bool
    skill: str
    data: dict[str, Any] | None = None
    error: str | None = None


def decode_agent_command(
    data: dict[str, Any],
    *,
    ts: float,
    robot_id: str,
) -> AgentCommandMessage:
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Missing or invalid field: text")
    return AgentCommandMessage(ts=ts, robot_id=robot_id, text=text)


def decode_ar_skill_result(
    data: dict[str, Any],
    *,
    ts: float,
    robot_id: str,
) -> ArSkillResultMessage:
    request_id = data.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("Missing or invalid field: request_id")
    skill = data.get("skill")
    if not isinstance(skill, str) or not skill:
        raise ValueError("Missing or invalid field: skill")
    if "ok" not in data or not isinstance(data["ok"], bool):
        raise ValueError("Missing or invalid field: ok")
    ok = bool(data["ok"])
    result_data: dict[str, Any] | None = None
    if "data" in data:
        raw_data = data["data"]
        if raw_data is not None:
            if not isinstance(raw_data, dict):
                raise ValueError("Field 'data' must be a JSON object")
            result_data = raw_data
    error: str | None = None
    if "error" in data:
        raw_error = data["error"]
        if raw_error is not None:
            if not isinstance(raw_error, str):
                raise ValueError("Field 'error' must be a string")
            error = raw_error
    return ArSkillResultMessage(
        ts=ts,
        robot_id=robot_id,
        request_id=request_id,
        ok=ok,
        skill=skill,
        data=result_data,
        error=error,
    )


def encode_agent_response(
    *,
    ts: float | None = None,
    text: str,
) -> str:
    return _dumps(
        {
            "type": "agent_response",
            "ts": ts if ts is not None else time.time(),
            "text": text,
        }
    )


def encode_agent_status(
    *,
    ts: float | None = None,
    state: WireAgentState,
    detail: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "agent_status",
        "ts": ts if ts is not None else time.time(),
        "state": state,
    }
    if detail is not None:
        payload["detail"] = detail
    return _dumps(payload)


def encode_ar_skill(
    *,
    ts: float | None = None,
    request_id: str,
    skill: str,
    args: dict[str, Any] | None = None,
) -> str:
    if not request_id:
        raise ValueError("request_id must be non-empty")
    if not skill:
        raise ValueError("skill must be non-empty")
    payload: dict[str, Any] = {
        "type": "ar_skill",
        "ts": ts if ts is not None else time.time(),
        "request_id": request_id,
        "skill": skill,
    }
    if args is not None:
        payload["args"] = args
    return _dumps(payload)
