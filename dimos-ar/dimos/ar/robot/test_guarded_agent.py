from __future__ import annotations

import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.robot.agent_control import AgentTurnGate

native = pytest.importorskip("dimos.ar.robot.guarded_agent", exc_type=ImportError)


def test_native_gate_checks_navigation_and_background_following() -> None:
    agent = object.__new__(native.ARGuardedMcpClient)
    agent._ar_gate = AgentTurnGate(threading.RLock())
    agent._navigation = SimpleNamespace(get_state=Mock(return_value=native.NavigationState.IDLE))
    agent._following = SimpleNamespace(ar_following_quiescent=Mock(return_value=True))
    assert agent.ar_agent_set_manual(False)
    agent._following.ar_following_quiescent.return_value = False
    assert not agent.ar_agent_set_manual(True)
    agent._following.ar_following_quiescent.return_value = True
    agent._navigation.get_state.return_value = native.NavigationState.FOLLOWING_PATH
    assert not agent.ar_agent_set_manual(True)
    agent._navigation.get_state.return_value = native.NavigationState.IDLE
    assert agent.ar_agent_set_manual(True)


def test_follow_status_remembers_worker_even_when_native_clears_thread_reference(monkeypatch) -> None:
    following = object.__new__(native.ARPersonFollowSkillContainer)
    following._ar_worker_lock = threading.Lock()
    following._ar_threads = set()
    entered, finish = threading.Event(), threading.Event()

    def loop(*_args, **_kwargs) -> None:
        entered.set()
        assert finish.wait(2)

    monkeypatch.setattr(native.PersonFollowSkillContainer, "_follow_loop", loop)
    worker = threading.Thread(target=following._follow_loop)
    following._thread = worker
    worker.start()
    assert entered.wait(2)
    try:
        following._thread = None  # Native stop_following drops it after a bounded join.
        assert not following.ar_following_quiescent()
    finally:
        finish.set()
        worker.join(2)
    assert following.ar_following_quiescent()


def test_stop_movement_stops_worker_and_suppresses_late_tracker_velocity() -> None:
    following = object.__new__(native.ARPersonFollowSkillContainer)
    following._ar_worker_lock = threading.Lock()
    following._ar_threads = set()
    following._lock = threading.RLock()
    following._should_stop = threading.Event()
    following._frequency = 1000
    following._latest_image = SimpleNamespace(width=100)
    following.config = SimpleNamespace(use_3d_navigation=False)
    following._visual_servo = SimpleNamespace(
        compute_twist=Mock(return_value=native.Twist(linear=[0.4, 0, 0]))
    )
    following.tool_update = Mock()
    following.stop_tool = Mock()
    following._ar_velocity = native._FollowingVelocityOutput(following)
    following.cmd_vel = following._ar_velocity
    sent = []
    stopped = threading.Event()

    def receive(message) -> None:
        sent.append(message)
        stopped.set()

    following.cmd_vel.subscribe(receive)
    entered, finish = threading.Event(), threading.Event()

    def process_image(_image):
        entered.set()
        assert finish.wait(2)
        detection = SimpleNamespace(bbox=[0, 0, 1, 1], bbox_2d_volume=lambda: 1)
        return SimpleNamespaceDetections([detection])

    tracker = SimpleNamespace(process_image=process_image)
    worker = threading.Thread(target=following._follow_loop, args=(tracker, "person"))
    following._thread = worker
    following._ar_threads.add(worker)
    worker.start()
    assert entered.wait(2)
    stop = threading.Thread(target=following._on_ar_stop_movement, args=(native.Bool(True),))
    stop.start()
    try:
        assert stopped.wait(2)
        assert following._should_stop.wait(2)
        assert not following.ar_following_quiescent()
    finally:
        finish.set()
        worker.join(2)
        stop.join(2)
    assert not worker.is_alive()
    assert not stop.is_alive()
    assert following.ar_following_quiescent()
    assert sent and all(message.linear.x == 0 and message.angular.z == 0 for message in sent)
    following._on_ar_stop_movement(native.Bool(False))
    following.cmd_vel.publish(native.Twist(linear=[1, 0, 0]))
    assert sent[-1].linear.x == 0


class SimpleNamespaceDetections:
    def __init__(self, detections) -> None:
        self.detections = detections

    def __len__(self) -> int:
        return len(self.detections)


def test_stop_retires_initial_detection_and_only_new_follow_invocation_resumes(monkeypatch) -> None:
    following = object.__new__(native.ARPersonFollowSkillContainer)
    following._ar_worker_lock = threading.Lock()
    following._ar_threads = set()
    following._thread = None
    following._should_stop = threading.Event()
    following._ar_invocations = threading.local()
    following._ar_velocity = native._FollowingVelocityOutput(following)
    following.cmd_vel = following._ar_velocity
    entered, finish = threading.Event(), threading.Event()
    results = []

    def detect(self, *_args):
        entered.set()
        assert finish.wait(2)
        return self._follow_person("person", [0, 0, 1, 1], None)

    start = Mock(return_value="started")
    monkeypatch.setattr(native.PersonFollowSkillContainer, "follow_person", detect)
    monkeypatch.setattr(native.PersonFollowSkillContainer, "_follow_person", start)
    request = threading.Thread(target=lambda: results.append(following.follow_person("person")))
    request.start()
    assert entered.wait(2)
    try:
        following._on_ar_stop_movement(native.Bool(True))
    finally:
        finish.set()
        request.join(2)
    assert results == ["Following request was retired by Stop."]
    start.assert_not_called()
    assert following.follow_person("person") == "started"
    start.assert_called_once()
    sent = []
    following.cmd_vel.subscribe(sent.append)
    following.cmd_vel.publish(native.Twist(linear=[0.4, 0, 0]))
    assert sent[-1].linear.x == 0.4


def test_start_subscribes_to_the_shared_stop_stream(monkeypatch) -> None:
    following = object.__new__(native.ARPersonFollowSkillContainer)
    following.stop_movement = SimpleNamespace(transport=object(), subscribe=Mock(return_value=Mock()))
    following.register_disposable = Mock()
    monkeypatch.setattr(native.PersonFollowSkillContainer, "start", lambda _self: None)
    following.start()
    following.stop_movement.subscribe.assert_called_once_with(following._on_ar_stop_movement)
