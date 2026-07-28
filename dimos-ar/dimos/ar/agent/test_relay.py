from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

from dimos.ar.agent.relay import AgentRelay
from dimos.ar.agent.wire import UserCommandMessage
from dimos.ar.bridge.sender import BridgeSender


class AIMessage:
    def __init__(
        self,
        content: Any = "",
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> None:
        self.content = content
        self.tool_calls = tool_calls or []


class HumanMessage:
    def __init__(self, content: str = "") -> None:
        self.content = content


class ToolMessage:
    def __init__(self, content: str = "", tool_call_id: str = "") -> None:
        self.content = content
        self.tool_call_id = tool_call_id


def _make_relay() -> tuple[AgentRelay, list[str], MagicMock]:
    published: list[str] = []
    sender = BridgeSender()
    mock_server = MagicMock()
    sender.bind(mock_server)
    relay = AgentRelay(
        sender=sender,
        publish_human_input=published.append,
    )
    return relay, published, mock_server


def test_on_user_command_publishes_human_input() -> None:
    relay, published, _server = _make_relay()
    relay.on_user_command(
        UserCommandMessage(ts=1.0, robot_id="unitree_go2", text="  move forward  ")
    )
    assert published == ["move forward"]


def test_on_agent_message_forwards_text_only_ai() -> None:
    relay, _published, server = _make_relay()
    relay.on_agent_message(AIMessage(content="On my way."))
    payloads = [json.loads(call.args[0]) for call in server.schedule_send.call_args_list]
    assert payloads == [
        {"type": "agent_response", "ts": payloads[0]["ts"], "text": "On my way."}
    ]


def test_on_agent_message_ignores_human_tool_and_tool_calling() -> None:
    relay, _published, server = _make_relay()
    relay.on_agent_message(HumanMessage(content="hi"))
    relay.on_agent_message(ToolMessage(content="ok", tool_call_id="1"))
    relay.on_agent_message(
        AIMessage(
            content="",
            tool_calls=[{"name": "relative_move", "args": {}, "id": "tc1"}],
        )
    )
    assert server.schedule_send.call_count == 0


def test_on_agent_idle_emits_status_on_change() -> None:
    relay, _published, server = _make_relay()
    assert relay.state == "idle"
    relay.on_agent_idle(False)
    assert relay.state == "busy"
    assert relay.detail == "thinking"
    relay.on_agent_idle(False)  # no duplicate
    relay.on_agent_idle(True)
    assert relay.state == "idle"
    assert relay.detail is None
    payloads = [json.loads(call.args[0]) for call in server.schedule_send.call_args_list]
    assert [p["type"] for p in payloads] == ["agent_status", "agent_status"]
    assert payloads[0]["state"] == "busy"
    assert payloads[0]["detail"] == "thinking"
    assert payloads[1]["state"] == "idle"
    assert "detail" not in payloads[1]
    assert relay.agent_wire_dict() == {"state": "idle"}


def test_set_detail_emits_while_busy() -> None:
    relay, _published, server = _make_relay()
    relay.on_agent_idle(False)
    server.schedule_send.reset_mock()
    relay.set_detail("planning route")
    assert relay.detail == "planning route"
    payloads = [json.loads(call.args[0]) for call in server.schedule_send.call_args_list]
    assert payloads == [
        {
            "type": "agent_status",
            "ts": payloads[0]["ts"],
            "state": "busy",
            "detail": "planning route",
        }
    ]
    assert relay.agent_wire_dict() == {"state": "busy", "detail": "planning route"}


def test_detail_phase_restores_previous() -> None:
    relay, _published, server = _make_relay()
    relay.on_agent_idle(False)
    server.schedule_send.reset_mock()
    with relay.detail_phase("marking space"):
        assert relay.detail == "marking space"
    assert relay.detail == "thinking"
    payloads = [json.loads(call.args[0]) for call in server.schedule_send.call_args_list]
    assert [p.get("detail") for p in payloads] == ["marking space", "thinking"]

