from __future__ import annotations

import json

from dimos.ar.robot.agent_service import ARAgentService
from dimos.ar.spatial import FrameSnapshot
from dimos.ar.websocket.protocol import ClientPose


def _service() -> tuple[ARAgentService, list[float], list[str]]:
    now = [100.0]
    sent: list[str] = []
    return (
        ARAgentService(
            frames=lambda: FrameSnapshot.initial("test"), connection_count=lambda: 2, broadcast=sent.append, clock=lambda: now[0]
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
            "shared_frame_id": "session:test",
            "args": {"id": "target", "x": 4, "y": 5, "z": 6, "title": "Updated"},
        }
    ]
    service.remove("target")
    assert service.marker_snapshot() == ()
    service.disconnect("a")
    assert service.client_pose() == "No client pose"


def test_nonidentity_map_conversion_and_rebase_keep_agent_context() -> None:
    from dataclasses import replace

    import numpy as np

    initial = FrameSnapshot.initial("test")
    matrix = np.array([[0., -1., 0., 10.], [1., 0., 0., 20.],
                       [0., 0., 1., 0.], [0., 0., 0., 1.]])
    frame = [replace(initial, T_map_odom=matrix)]
    sent: list[str] = []
    now = [100.]
    service = ARAgentService(frames=lambda: frame[0], connection_count=lambda: 1,
                             broadcast=sent.append, clock=lambda: now[0])
    service.set_pose(ClientPose((8., 21., 1.5), (0., 0., 2 ** -0.5, 2 ** -0.5), 1), client_id="a")
    service.begin_turn("a")
    assert "position=[1.0, 2.0, 1.5]" in service.client_pose()
    assert service.place("p", 1, 2, 3) == "ok"
    marker = json.loads(service.marker_snapshot()[0])["args"]
    assert [marker[axis] for axis in ("x", "y", "z")] == [8, 21, 3]
    rebase = np.eye(4)
    rebase[:3, 3] = [5, 0, 0]
    frame[0] = replace(frame[0], shared_frame_id="vps:office", T_map_odom=rebase @ matrix)
    service.rebase_shared_frame(rebase)
    assert json.loads(service.marker_snapshot()[0])["shared_frame_id"] == "vps:office"
    assert "position=[1.0, 2.0, 1.5]" in service.client_pose()
    now[0] += 3
    assert service.client_pose() == "No client pose"


def test_agent_observation_remains_coherent_during_root_adoption(monkeypatch) -> None:
    from dataclasses import replace

    import numpy as np

    frame = [FrameSnapshot.initial("test")]
    service = ARAgentService(
        frames=lambda: frame[0], connection_count=lambda: 1,
        broadcast=lambda _: None, clock=lambda: 100.,
    )
    service.set_pose(_pose(1), client_id="a")
    read_pose = service._fresh_pose

    def adopt_after_pose_read() -> ClientPose | None:
        pose = read_pose()
        rebase = np.eye(4)
        rebase[:3, 3] = [10., 20., 0.]
        frame[0] = replace(frame[0], shared_frame_id="vps:office", T_map_odom=rebase)
        service.rebase_shared_frame(rebase)
        return pose

    monkeypatch.setattr(service, "_fresh_pose", adopt_after_pose_read)
    assert "position=[1.0, 0.0, 1.5]" in service.client_pose()


def test_native_registration_correction_applies_to_next_agent_observation() -> None:
    from dataclasses import replace

    import numpy as np

    frame = [FrameSnapshot.initial("test")]
    service = ARAgentService(
        frames=lambda: frame[0], connection_count=lambda: 1,
        broadcast=lambda _: None, clock=lambda: 100.,
    )
    service.set_pose(_pose(1), client_id="a")
    corrected = np.eye(4)
    corrected[0, 3] = 5.
    frame[0] = replace(frame[0], revision=1, T_map_odom=corrected)
    assert "position=[1.0, 0.0, 1.5]" in service.client_pose()
    service.set_pose(_pose(1), client_id="a")
    assert "position=[-4.0, 0.0, 1.5]" in service.client_pose()


def test_marker_uses_registration_correction_that_arrives_during_placement(monkeypatch) -> None:
    from dataclasses import replace

    import numpy as np

    frame = [FrameSnapshot.initial("test")]
    sent: list[str] = []
    service = ARAgentService(
        frames=lambda: frame[0], connection_count=lambda: 1,
        broadcast=sent.append, clock=lambda: 100.,
    )
    service.set_pose(_pose(1), client_id="a")
    initial = frame[0]
    corrected = np.eye(4)
    corrected[0, 3] = 5.
    reads = 0

    def correction_during_placement() -> FrameSnapshot:
        nonlocal reads
        reads += 1
        return initial if reads == 1 else replace(initial, revision=1, T_map_odom=corrected)

    monkeypatch.setattr(service, "_frames", correction_during_placement)
    assert service.place("p", 1, 2, 3) == "ok"
    assert json.loads(sent[-1])["args"]["x"] == 6.
