from __future__ import annotations

from dimos.ar.robot.emergency_stop import EmergencyStopController


def _safety(*, estop_available: bool = True) -> tuple[EmergencyStopController, list[str]]:
    calls: list[str] = []

    def effect_a() -> bool:
        calls.append("a")
        return True

    def effect_b() -> bool:
        calls.append("b")
        return False

    return EmergencyStopController(estop_available=estop_available, effects=(effect_a, effect_b)), calls


def test_estop_request_runs_all_effects() -> None:
    safety, calls = _safety()
    assert safety.on_estop_request() is True
    assert calls == ["a", "b"]


def test_last_disconnect_runs_the_same_effects() -> None:
    safety, calls = _safety()
    assert safety.on_last_disconnect() is True
    assert calls == ["a", "b"]


def test_estop_unavailable_runs_no_effects() -> None:
    safety, calls = _safety(estop_available=False)
    assert safety.on_estop_request() is False
    assert safety.on_last_disconnect() is False
    assert calls == []


def test_false_when_no_effect_reports_change() -> None:
    calls: list[str] = []
    safety = EmergencyStopController(estop_available=True, effects=(lambda: calls.append("x") or False,))
    assert safety.on_estop_request() is False
    assert calls == ["x"]


def test_disconnect_stops_motion_without_creating_a_resume_latch() -> None:
    safety, calls = _safety()
    safety.on_last_disconnect()
    assert calls == ["a", "b"]
    assert safety.snapshot() == {"stopped": False, "can_resume": False}


def test_generic_resume_is_bound_to_the_latest_explicit_stop() -> None:
    safety, _calls = _safety()
    safety.on_estop_request()
    first = safety.snapshot()["stop_id"]
    assert safety.begin_resume(first)
    assert not safety.snapshot()["can_resume"]
    safety.on_estop_request()
    second = safety.snapshot()["stop_id"]
    assert second != first
    assert not safety.finish_resume(first, succeeded=True)
    assert not safety.begin_resume(first)
    assert safety.stopped
    assert safety.begin_resume(second)
    assert safety.finish_resume(second, succeeded=True)
    assert safety.snapshot() == {"stopped": False, "can_resume": False}


def test_arm_resume_requires_current_confirmed_feedback_and_recovered_protection() -> None:
    safety = EmergencyStopController(estop_available=True, effects=(), manipulation=True)
    safety.on_estop_request()
    identity = safety.snapshot()["stop_id"]
    assert not safety.begin_resume(identity)
    snapshot = {
        "available": True, "stopped": True, "stop_confirmed": False,
        "execution": "idle", "protection": {"state": "normal"},
    }
    safety.observe_manipulation(snapshot)
    assert not safety.begin_resume(identity)
    snapshot["stop_confirmed"] = True
    snapshot["protection"] = {"state": "fault", "resumable": False}
    safety.observe_manipulation(snapshot)
    assert not safety.begin_resume(identity)
    snapshot["protection"] = {"state": "paused", "resumable": True}
    safety.observe_manipulation(snapshot)
    assert safety.snapshot()["can_resume"]
    safety.observe_manipulation({"available": False})
    assert safety.stopped and not safety.begin_resume(identity)
    safety.observe_manipulation(snapshot)
    assert safety.begin_resume(identity)
    assert safety.finish_resume(identity, succeeded=False) is False
    assert safety.stopped and safety.snapshot()["can_resume"]
