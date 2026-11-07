from __future__ import annotations

import json

from dimos.ar.robot.agent_service import ARAgentService
from dimos.ar.websocket.protocol import ClientPose


def _service() -> tuple[ARAgentService, list[float], list[str]]:
    now = [100.0]
    sent: list[str] = []
    return (
        ARAgentService(
            factor=1.0, connection_count=lambda: 2, broadcast=sent.append, clock=lambda: now[0]
        ),
        now,
        sent,
    )


def _pose(x: float) -> ClientPose:
    return ClientPose(position=(x, 0, 1.5), orientation=(0, 0, 0, 1), ts=1)


def test_actor_pose_does_not_switch_when_another_client_reports() -> None:
    service, _, _ = _service()
    service.set_pose(_pose(1), client_id="a")
    service.set_pose(_pose(2), client_id="b")
    assert service.client_pose() == "No client pose"
    assert service.begin_turn("a")
    assert "position=[1.0, 0.0, 1.5]" in service.client_pose()
    service.set_pose(_pose(3), client_id="b")
    assert "position=[1.0, 0.0, 1.5]" in service.client_pose()
    assert not service.begin_turn("b")
    service.update_idle(False)
    service.update_idle(True)
    assert service.begin_turn("b")
    assert "position=[3.0, 0.0, 1.5]" in service.client_pose()


def test_disconnected_or_stale_actor_never_falls_back_to_observer_pose() -> None:
    service, now, _ = _service()
    service.set_pose(_pose(1), client_id="a")
    service.begin_turn("a")
    now[0] += 2.1
    service.set_pose(_pose(2), client_id="b")
    assert service.client_pose() == "No client pose"
    service.disconnect("a")
    assert service.client_pose() == "No client pose"
    assert service.place("target", 1, 2, 3) == "No client pose"
    assert not service.begin_turn("b")
    service.update_idle(False)
    service.update_idle(True)
    assert service.begin_turn("b")
    assert "position=[2.0, 0.0, 1.5]" in service.client_pose()


def test_queued_idle_fact_cannot_complete_a_newly_dispatched_turn() -> None:
    service, _, _ = _service()
    assert service.begin_turn("a")
    assert not service.update_idle(True)
    assert not service.idle
    assert not service.begin_turn("b")
    service.update_idle(False)
    assert service.update_idle(True)
    assert service.idle


def test_failed_publish_can_undo_only_its_unstarted_turn() -> None:
    service, _, _ = _service()
    service.begin_turn("a")
    service.cancel_turn("b")
    assert not service.idle
    service.cancel_turn("a")
    assert service.idle
    service.begin_turn("b")
    service.update_idle(False)
    service.cancel_turn("b")
    assert not service.idle


def test_background_continuation_keeps_actor_after_llm_idle_and_disconnect() -> None:
    service, _, _ = _service()
    service.set_pose(_pose(1), client_id="a")
    assert service.begin_turn("a")
    service.update_idle(False)
    service.update_idle(True)
    service.disconnect("a")
    service.set_pose(_pose(2), client_id="b")
    assert service.client_pose() == "No client pose"
    assert service.begin_turn("b")
    assert "position=[2.0, 0.0, 1.5]" in service.client_pose()


def test_late_join_marker_snapshot_contains_current_poses_and_removals() -> None:
    service, _, _ = _service()
    service.set_pose(_pose(1), client_id="a")
    assert service.place("target", 1, 2, 3, "First") == "ok"
    assert service.place("target", 4, 5, 6, "Updated") == "ok"
    snapshot = [json.loads(frame) for frame in service.marker_snapshot()]
    assert snapshot == [
        {
            "type": "agent_skill",
            "name": "ar_place_marker",
            "args": {"id": "target", "x": 4, "y": 5, "z": 6, "title": "Updated"},
        }
    ]
    service.remove("target")
    assert service.marker_snapshot() == ()
    service.disconnect("a")
    assert service.client_pose() == "No client pose"
