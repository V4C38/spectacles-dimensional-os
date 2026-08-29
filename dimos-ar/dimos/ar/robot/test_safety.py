from __future__ import annotations

from dimos.ar.robot.safety import Safety


def _safety(*, estop_available: bool = True) -> tuple[Safety, list[str]]:
    calls: list[str] = []

    def effect_a() -> bool:
        calls.append("a")
        return True

    def effect_b() -> bool:
        calls.append("b")
        return False

    return Safety(estop_available=estop_available, effects=(effect_a, effect_b)), calls


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
    safety = Safety(estop_available=True, effects=(lambda: calls.append("x") or False,))
    assert safety.on_estop_request() is False
    assert calls == ["x"]
