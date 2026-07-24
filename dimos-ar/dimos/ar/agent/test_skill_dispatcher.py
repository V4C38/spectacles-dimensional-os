from __future__ import annotations

import json
import threading
import time
from unittest.mock import MagicMock

import pytest

from dimos.ar.agent.skill_dispatcher import ArSkillDispatcher, ArSkillError
from dimos.ar.agent.wire import ArSkillResultMessage, decode_hmd_transform
from dimos.ar.bridge.sender import BridgeSender


def _make_dispatcher(
    *,
    connection_count: int = 1,
) -> tuple[ArSkillDispatcher, MagicMock]:
    sender = BridgeSender()
    mock_server = MagicMock()
    sender.bind(mock_server)
    dispatcher = ArSkillDispatcher(sender=sender, default_timeout_s=0.5)
    dispatcher.bind_connection_count(lambda: connection_count)
    return dispatcher, mock_server


def test_request_success_round_trip() -> None:
    dispatcher, mock_server = _make_dispatcher()

    def reply() -> None:
        time.sleep(0.05)
        payload = json.loads(mock_server.schedule_send.call_args.args[0])
        dispatcher.on_ar_skill_result(
            ArSkillResultMessage(
                ts=1.0,
                robot_id="unitree_go2",
                request_id=payload["request_id"],
                ok=True,
                skill="get_user_hmd_transform",
                data={
                    "position": [1.0, 0.5, 2.0],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                },
            )
        )

    threading.Thread(target=reply, daemon=True).start()
    result = dispatcher.request("get_user_hmd_transform")
    assert result.ok is True
    assert result.data is not None
    assert result.data["position"] == [1.0, 0.5, 2.0]
    sent = json.loads(mock_server.schedule_send.call_args.args[0])
    assert sent["type"] == "ar_skill"
    assert sent["skill"] == "get_user_hmd_transform"


def test_request_timeout() -> None:
    dispatcher, _server = _make_dispatcher()
    with pytest.raises(ArSkillError, match="timed out"):
        dispatcher.request("get_user_hmd_transform", timeout_s=0.05)


def test_request_no_client_fast_fail() -> None:
    dispatcher, mock_server = _make_dispatcher(connection_count=0)
    with pytest.raises(ArSkillError, match="No AR client connected"):
        dispatcher.request("get_user_hmd_transform")
    assert mock_server.schedule_send.call_count == 0


def test_late_result_dropped() -> None:
    dispatcher, _server = _make_dispatcher()
    dispatcher.on_ar_skill_result(
        ArSkillResultMessage(
            ts=1.0,
            robot_id="unitree_go2",
            request_id="unknown-id",
            ok=True,
            skill="get_user_hmd_transform",
        )
    )


def test_concurrent_requests_correlate_by_request_id() -> None:
    dispatcher, mock_server = _make_dispatcher()
    results: dict[str, ArSkillResultMessage] = {}

    def worker(skill: str) -> None:
        results[skill] = dispatcher.request(skill, timeout_s=1.0)

    threads = [
        threading.Thread(target=worker, args=("skill_a",), daemon=True),
        threading.Thread(target=worker, args=("skill_b",), daemon=True),
    ]
    for t in threads:
        t.start()

    deadline = time.monotonic() + 1.0
    while mock_server.schedule_send.call_count < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert mock_server.schedule_send.call_count == 2

    payloads = [
        json.loads(call.args[0]) for call in mock_server.schedule_send.call_args_list
    ]
    by_skill = {p["skill"]: p["request_id"] for p in payloads}
    dispatcher.on_ar_skill_result(
        ArSkillResultMessage(
            ts=1.0,
            robot_id="unitree_go2",
            request_id=by_skill["skill_b"],
            ok=True,
            skill="skill_b",
            data={"which": "b"},
        )
    )
    dispatcher.on_ar_skill_result(
        ArSkillResultMessage(
            ts=1.0,
            robot_id="unitree_go2",
            request_id=by_skill["skill_a"],
            ok=True,
            skill="skill_a",
            data={"which": "a"},
        )
    )
    for t in threads:
        t.join(timeout=1.0)
    assert results["skill_a"].data == {"which": "a"}
    assert results["skill_b"].data == {"which": "b"}


def test_decode_hmd_transform() -> None:
    pos, ori = decode_hmd_transform(
        {"position": [1, 2, 3], "orientation": [0, 0, 0, 1]}
    )
    assert pos == (1.0, 2.0, 3.0)
    assert ori == (0.0, 0.0, 0.0, 1.0)
    with pytest.raises(ValueError, match="position"):
        decode_hmd_transform({"orientation": [0, 0, 0, 1]})
