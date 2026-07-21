"""AgentRelay — user_command in, agent_response/agent_status out."""

from __future__ import annotations

from collections.abc import Callable
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

    @property
    def state(self) -> WireAgentState:
        return self._state

    def agent_wire_dict(self) -> dict[str, str]:
        return {"state": self._state}

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
        next_state: WireAgentState = "idle" if idle else "busy"
        if next_state == self._state:
            return
        self._state = next_state
        self._sender.send(encode_agent_status(state=next_state))
