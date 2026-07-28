"""AgentRelay — user_command in, agent_response/agent_status out."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

from dimos.ar.agent.wire import (
    UserCommandMessage,
    WireAgentState,
    encode_agent_response,
    encode_agent_status,
)
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.sender import BridgeSender

logger = setup_logger()

# Coarse busy-phase labels for agent_status.detail (Lens activity line).
DETAIL_THINKING = "thinking"
DETAIL_PLANNING_ROUTE = "planning route"
DETAIL_LOCATING_YOU = "locating you"
DETAIL_MARKING_SPACE = "marking space"


def _assistant_text(msg: Any) -> str | None:
    """Return final assistant text, or None when the message is not user-facing."""
    # Duck-type LangChain AIMessage so CI can import without langchain_core.
    if type(msg).__name__ != "AIMessage":
        return None
    tool_calls = getattr(msg, "tool_calls", None) or []
    if tool_calls:
        return None
    content = getattr(msg, "content", None)
    if isinstance(content, str):
        text = content.strip()
        return text or None
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                block_text = block.get("text")
                if isinstance(block_text, str):
                    parts.append(block_text)
        joined = "".join(parts).strip()
        return joined or None
    return None


class AgentRelay:
    """Bridge agent I/O; never blocks the inbound WebSocket lane."""

    def __init__(
        self,
        *,
        sender: BridgeSender,
        publish_human_input: Callable[[str], None],
    ) -> None:
        self._sender = sender
        self._publish_human_input = publish_human_input
        self._state: WireAgentState = "idle"
        self._detail: str | None = None

    @property
    def state(self) -> WireAgentState:
        return self._state

    @property
    def detail(self) -> str | None:
        return self._detail

    def agent_wire_dict(self) -> dict[str, str]:
        payload: dict[str, str] = {"state": self._state}
        if self._detail is not None:
            payload["detail"] = self._detail
        return payload

    def set_detail(self, detail: str | None) -> None:
        """Update busy-phase detail and emit agent_status when it changes."""
        if detail == self._detail:
            return
        self._detail = detail
        if self._state != "busy":
            return
        self._sender.send(encode_agent_status(state="busy", detail=detail))

    @contextmanager
    def detail_phase(self, detail: str) -> Iterator[None]:
        """Temporarily set a busy detail; restore previous (or thinking) on exit."""
        previous = self._detail
        self.set_detail(detail)
        try:
            yield
        finally:
            if self._state == "busy":
                restore = previous if previous is not None else DETAIL_THINKING
                self.set_detail(restore)

    def on_user_command(self, msg: UserCommandMessage) -> None:
        text = msg.text.strip()
        logger.info(
            "user_command received",
            robot_id=msg.robot_id,
            text=text[:120],
        )
        self._publish_human_input(text)

    def on_agent_message(self, msg: Any) -> None:
        text = _assistant_text(msg)
        if text is None:
            return
        self._sender.send(encode_agent_response(text=text))

    def on_agent_idle(self, idle: bool) -> None:
        if idle:
            if self._state == "idle" and self._detail is None:
                return
            self._state = "idle"
            self._detail = None
            self._sender.send(encode_agent_status(state="idle"))
            return
        if self._state == "busy" and self._detail == DETAIL_THINKING:
            return
        self._state = "busy"
        self._detail = DETAIL_THINKING
        self._sender.send(encode_agent_status(state="busy", detail=DETAIL_THINKING))
