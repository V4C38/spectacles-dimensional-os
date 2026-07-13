from __future__ import annotations

import asyncio
import time
from typing import get_args
from unittest.mock import MagicMock

import pytest

from dimos.ar.network.inbound_dispatch import (
    MESSAGE_LANES,
    DispatchLane,
    InboundDispatcher,
    lane_for_message,
)
from dimos.ar.network.protocol import (
    AgentCommandMessage,
    ArSkillResultMessage,
    CameraInfoMessage,
    GetStatusMessage,
    InboundMessage,
    PingMessage,
    RegistrationCommandMessage,
)


@pytest.mark.asyncio
async def test_policy_covers_every_inbound_message_type() -> None:
    assert set(MESSAGE_LANES) == set(get_args(InboundMessage))


def test_lane_for_registration_command_is_ordered() -> None:
    msg = RegistrationCommandMessage(
        ts=1.0,
        robot_id="unitree_go2",
        command="start",
        mode="april_tag",
    )

    assert lane_for_message(msg) == DispatchLane.ORDERED


@pytest.mark.asyncio
async def test_ordered_submit_returns_immediately_for_slow_handler() -> None:
    dispatcher = InboundDispatcher(loop=asyncio.get_running_loop())
    dispatcher.start()
    msg = RegistrationCommandMessage(
        ts=1.0,
        robot_id="unitree_go2",
        command="start",
        mode="april_tag",
    )

    def slow_handler(_msg: InboundMessage, _ws: object) -> None:
        time.sleep(0.2)

    started = time.monotonic()
    dispatcher.submit(msg, MagicMock(), slow_handler)
    elapsed = time.monotonic() - started
    await dispatcher.stop()

    assert elapsed < 0.05


@pytest.mark.asyncio
async def test_ordered_lane_preserves_fifo() -> None:
    dispatcher = InboundDispatcher(loop=asyncio.get_running_loop())
    dispatcher.start()
    seen: list[str] = []
    done = asyncio.Event()

    loop = asyncio.get_running_loop()

    def ordered_handler(msg: InboundMessage, _ws: object) -> None:
        assert isinstance(msg, RegistrationCommandMessage)
        seen.append(msg.command)
        if len(seen) == 3:
            loop.call_soon_threadsafe(done.set)

    for command in ("stop", "start", "commit"):
        dispatcher.submit(
            RegistrationCommandMessage(
                ts=1.0,
                robot_id="unitree_go2",
                command=command,
                mode="april_tag" if command == "start" else None,
            ),
            MagicMock(),
            ordered_handler,
        )

    await asyncio.wait_for(done.wait(), timeout=1.0)
    await dispatcher.stop()

    assert seen == ["stop", "start", "commit"]


@pytest.mark.asyncio
async def test_ordered_worker_survives_handler_exception() -> None:
    dispatcher = InboundDispatcher(loop=asyncio.get_running_loop())
    dispatcher.start()
    done = asyncio.Event()
    calls = 0
    loop = asyncio.get_running_loop()

    def handler(_msg: InboundMessage, _ws: object) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("boom")
        loop.call_soon_threadsafe(done.set)

    for _ in range(2):
        dispatcher.submit(
            RegistrationCommandMessage(
                ts=1.0,
                robot_id="unitree_go2",
                command="stop",
            ),
            MagicMock(),
            handler,
        )

    await asyncio.wait_for(done.wait(), timeout=1.0)
    await dispatcher.stop()

    assert calls == 2


@pytest.mark.asyncio
async def test_background_handler_does_not_wait_behind_ordered() -> None:
    dispatcher = InboundDispatcher(loop=asyncio.get_running_loop())
    dispatcher.start()
    background_done = asyncio.Event()
    loop = asyncio.get_running_loop()

    def slow_ordered(_msg: InboundMessage, _ws: object) -> None:
        time.sleep(0.3)

    def background(_msg: InboundMessage, _ws: object) -> None:
        loop.call_soon_threadsafe(background_done.set)

    dispatcher.submit(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="unitree_go2",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
        slow_ordered,
    )
    dispatcher.submit(
        GetStatusMessage(ts=1.0, robot_id="unitree_go2"),
        MagicMock(),
        background,
    )

    await asyncio.wait_for(background_done.wait(), timeout=0.1)
    await dispatcher.stop()


@pytest.mark.asyncio
async def test_async_lane_runs_coroutine_handler() -> None:
    dispatcher = InboundDispatcher(loop=asyncio.get_running_loop())
    dispatcher.start()
    done = asyncio.Event()

    async def handler(_msg: InboundMessage, _ws: object) -> None:
        done.set()

    dispatcher.submit(
        PingMessage(ts=1.0, robot_id="unitree_go2", client_ts=2.0),
        MagicMock(),
        handler,
    )

    await asyncio.wait_for(done.wait(), timeout=1.0)
    await dispatcher.stop()


@pytest.mark.asyncio
async def test_camera_info_policy_is_background() -> None:
    msg = CameraInfoMessage(
        ts=1.0,
        robot_id="unitree_go2",
        width=100,
        height=100,
        fx=1.0,
        fy=1.0,
        cx=50.0,
        cy=50.0,
        distortion=(),
        camera_model="pinhole",
        device_model="test",
    )

    assert lane_for_message(msg) == DispatchLane.BACKGROUND


def test_lane_for_agent_command_is_background() -> None:
    msg = AgentCommandMessage(ts=1.0, robot_id="unitree_go2", text="hi")
    assert lane_for_message(msg) == DispatchLane.BACKGROUND


def test_lane_for_ar_skill_result_is_background() -> None:
    msg = ArSkillResultMessage(
        ts=1.0,
        robot_id="unitree_go2",
        request_id="req-1",
        ok=True,
        skill="get_user_hmd_transform",
    )
    assert lane_for_message(msg) == DispatchLane.BACKGROUND


def test_lane_for_agent_command_is_background() -> None:
    msg = AgentCommandMessage(ts=1.0, robot_id="unitree_go2", text="hi")
    assert lane_for_message(msg) == DispatchLane.BACKGROUND


def test_lane_for_ar_skill_result_is_background() -> None:
    msg = ArSkillResultMessage(
        ts=1.0,
        robot_id="unitree_go2",
        request_id="req-1",
        ok=True,
        skill="get_user_hmd_transform",
    )
    assert lane_for_message(msg) == DispatchLane.BACKGROUND
