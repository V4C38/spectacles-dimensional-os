from __future__ import annotations

import threading

import pytest

from dimos.ar.robot.agent_control import AgentTurnGate


def test_manual_start_holds_queued_turns_until_agent_mode() -> None:
    gate = AgentTurnGate(threading.RLock())
    calls: list[str] = []
    assert gate.manual
    assert not gate.run_turn(lambda: calls.append("queued continuation"))
    assert gate.set_manual(False, lambda: True)
    assert gate.run_turn(lambda: calls.append("queued continuation"))
    assert calls == ["queued continuation"]


def test_idle_turn_does_not_admit_manual_while_native_motion_continues() -> None:
    gate = AgentTurnGate(threading.RLock())
    assert gate.set_manual(False, lambda: True)
    assert not gate.set_manual(True, lambda: False)
    assert not gate.manual
    assert gate.set_manual(True, lambda: True)
    assert gate.manual


def test_running_turn_rejects_mode_change_without_waiting_for_completion() -> None:
    gate = AgentTurnGate(threading.RLock())
    assert gate.set_manual(False, lambda: True)
    started = threading.Event()
    finish = threading.Event()

    def turn() -> None:
        started.set()
        assert finish.wait(2)

    worker = threading.Thread(target=lambda: gate.run_turn(turn))
    worker.start()
    assert started.wait(2)
    try:
        assert not gate.set_manual(True, lambda: True)
        assert not gate.manual
    finally:
        finish.set()
        worker.join(2)
    assert gate.set_manual(True, lambda: True)


def test_failed_native_status_does_not_change_previous_gate() -> None:
    gate = AgentTurnGate(threading.RLock())
    assert gate.set_manual(False, lambda: True)

    def unavailable() -> bool:
        raise RuntimeError("native status unavailable")

    with pytest.raises(RuntimeError):
        gate.set_manual(True, unavailable)
    assert not gate.manual


def test_agent_resume_waits_for_previous_manual_motion_to_finish() -> None:
    gate = AgentTurnGate(threading.RLock())
    assert not gate.set_manual(False, lambda: False)
    assert gate.manual
    assert gate.set_manual(False, lambda: True)
    assert not gate.manual
