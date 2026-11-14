from __future__ import annotations

from queue import Queue
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dimos.ar.robot.agent_control import AgentTurnGate

native = pytest.importorskip("dimos.ar.robot.guarded_agent", exc_type=ImportError)


def test_native_gate_checks_navigation_and_background_following() -> None:
    agent = object.__new__(native.ARGuardedMcpClient)
    agent._ar_gate = AgentTurnGate(threading.RLock())
    agent._message_queue = Queue()
    agent._history = []
    agent._navigation = SimpleNamespace(get_state=Mock(return_value=native.NavigationState.IDLE),
                                       ar_navigation_agent_manual=Mock(return_value=True))
    agent._following = SimpleNamespace(ar_following_quiescent=Mock(return_value=True),
                                      ar_following_set_manual=Mock(return_value=True))
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
    assert following.follow_person("person") == "Following is paused for manual control."
    assert following.ar_following_set_manual(True, 0)
    assert following.ar_following_set_manual(False, 0)
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


def agent_fixture():
    agent = object.__new__(native.ARGuardedMcpClient)
    agent._ar_gate = AgentTurnGate(threading.RLock())
    agent._message_queue = Queue()
    agent._history = []
    agent._navigation = SimpleNamespace(
        get_state=Mock(return_value=native.NavigationState.IDLE),
        ar_navigation_agent_manual=Mock(return_value=True),
    )
    agent._following = SimpleNamespace(ar_following_quiescent=Mock(return_value=True),
                                      ar_following_set_manual=Mock(return_value=True))
    agent._mcp_request = Mock(return_value={"content": []})
    assert agent.ar_agent_set_manual(False)
    return agent


def test_takeover_retires_a_running_llm_and_blocks_its_later_tools():
    agent = agent_fixture()
    entered, finish = threading.Event(), threading.Event()
    retired = []

    def turn():
        entered.set()
        assert finish.wait(2)
        try:
            agent._mcp_tool_call("navigate_with_text", {"query": "old goal"})
        except RuntimeError:
            retired.append(True)

    worker = threading.Thread(target=lambda: agent._ar_gate.run_turn(turn))
    worker.start()
    assert entered.wait(2)
    try:
        agent._message_queue.put("old continuation")
        assert agent.ar_agent_takeover()
        assert agent._ar_gate.manual
        assert agent._message_queue.empty()
        assert not agent.ar_agent_set_manual(False)
    finally:
        finish.set()
        worker.join(2)
    assert retired == [True]
    agent._mcp_request.assert_not_called()
    assert agent.ar_agent_set_manual(False)
    agent._mcp_tool_call("navigate_with_text", {"query": "fresh goal"})
    agent._mcp_request.assert_called_once()


def test_inflight_native_tool_keeps_takeover_uncertain_and_resume_closed():
    agent = agent_fixture()
    entered, finish = threading.Event(), threading.Event()
    errors = []

    def call(*_args, **_kwargs):
        entered.set()
        assert finish.wait(2)
        return {"content": []}

    agent._mcp_request.side_effect = call

    def effect():
        try:
            agent._mcp_tool_call("follow_person", {"query": "old goal"})
        except RuntimeError:
            errors.append("retired")

    worker = threading.Thread(target=effect)
    worker.start()
    assert entered.wait(2)
    try:
        assert not agent.ar_agent_takeover()
        assert agent._ar_gate.manual
        assert not agent.ar_agent_set_manual(False)
    finally:
        finish.set()
        worker.join(2)
    assert errors == ["retired"]
    assert agent.ar_agent_set_manual(False)


def test_retired_tool_notifications_and_lookout_continuations_never_replay():
    agent = agent_fixture()
    agent._mcp_tool_call("look_out_for", {"then": {"tool": "follow_person", "args": {}}})
    request = agent._mcp_request.call_args.args[1]
    continuation = request["arguments"]["then"]
    token = request["_meta"]["progressToken"]
    agent._history.append("old goal")
    assert agent.ar_agent_takeover()
    assert agent.ar_agent_set_manual(False)
    assert agent._history == []
    agent._mcp_request.reset_mock()
    agent.dispatch_continuation(continuation, {})
    agent._on_tool_stream_message({"method": "notifications/progress", "params": {
        "progressToken": token, "message": "old following result",
    }})
    assert agent._message_queue.empty()
    agent._mcp_request.assert_not_called()


def test_following_manual_latch_rejects_new_work_until_explicit_agent_resume():
    following = object.__new__(native.ARPersonFollowSkillContainer)
    following._ar_worker_lock = threading.Lock()
    following._ar_threads = set()
    following._thread = None
    following._should_stop = threading.Event()
    following._ar_velocity = native._FollowingVelocityOutput(following)
    assert following.ar_following_set_manual(True, 0)
    assert following.follow_person("person") == "Following is paused for manual control."
    assert not following._ar_velocity.resume(following._ar_velocity.generation)
    assert following.ar_following_set_manual(False, 0)
    assert following._ar_velocity.resume(following._ar_velocity.generation)


def test_resume_failure_re_latches_both_native_lanes_after_partial_success():
    agent = agent_fixture()
    assert agent.ar_agent_takeover()

    def following_mode(manual, _generation):
        if not manual:
            raise OSError("following RPC unavailable")
        return True

    agent._following.ar_following_set_manual.side_effect = following_mode
    assert not agent.ar_agent_set_manual(False)
    assert agent._ar_gate.manual
    assert agent._navigation.ar_navigation_agent_manual.call_args.args[0] is True
    assert agent._following.ar_following_set_manual.call_args.args[0] is True


def test_takeover_during_resume_quiescence_never_opens_native_lanes():
    agent = agent_fixture()
    assert agent.ar_agent_takeover()
    agent._navigation.ar_navigation_agent_manual.reset_mock()
    agent._following.ar_following_set_manual.reset_mock()

    def quiescence():
        assert agent.ar_agent_takeover()
        return native.NavigationState.IDLE

    agent._navigation.get_state.side_effect = quiescence
    assert not agent.ar_agent_set_manual(False)
    assert agent._ar_gate.manual
    assert all(call.args[0] is True for call in agent._navigation.ar_navigation_agent_manual.call_args_list)
    assert all(call.args[0] is True for call in agent._following.ar_following_set_manual.call_args_list)


def test_retired_tool_exception_does_not_kill_worker_or_discard_a_fresh_goal():
    agent = agent_fixture()
    entered, finish, retired, fresh = (threading.Event() for _ in range(4))
    agent._stop_event = threading.Event()
    agent._state_graph = SimpleNamespace()
    agent.agent_idle = SimpleNamespace(publish=lambda _idle: retired.set())

    def process(_graph, message):
        if message == "old":
            entered.set()
            assert finish.wait(2)
            raise RuntimeError("Agent action was retired by manual control")
        fresh.set()
        agent._stop_event.set()

    agent._process_message = process
    agent._message_queue.put("old")
    worker = threading.Thread(target=agent._thread_loop)
    worker.start()
    assert entered.wait(2)
    try:
        assert agent.ar_agent_takeover()
        finish.set()
        assert retired.wait(2)
        # Acquire the same turn lock to wait for the complete cleanup boundary.
        with agent._ar_gate._turn_lock:
            assert agent.ar_agent_set_manual(False)
        agent._message_queue.put("fresh")
        assert fresh.wait(2)
    finally:
        finish.set()
        agent._stop_event.set()
        worker.join(2)
    assert not worker.is_alive()


def test_delayed_follow_entry_cannot_adopt_a_post_stop_resume_generation(monkeypatch):
    following = object.__new__(native.ARPersonFollowSkillContainer)
    following._ar_worker_lock = threading.Lock()
    following._ar_threads = set()
    following._thread = None
    following._should_stop = threading.Event()
    following._ar_invocations = threading.local()
    output = native._FollowingVelocityOutput(following)
    entered, finish = threading.Event(), threading.Event()
    first = True

    class DelayedEntry:
        @property
        def generation(self):
            nonlocal first
            generation = output.generation
            if first:
                first = False
                entered.set()
                assert finish.wait(2)
            return generation

        @property
        def manual(self):
            return output.manual

        def set_manual(self, manual, generation=None):
            return output.set_manual(manual, generation)

    following._ar_velocity = DelayedEntry()
    start = Mock(return_value="started")
    monkeypatch.setattr(native.PersonFollowSkillContainer, "follow_person", start)
    results = []
    worker = threading.Thread(target=lambda: results.append(following.follow_person("old person")))
    worker.start()
    assert entered.wait(2)
    try:
        assert following.ar_following_set_manual(True, 0)
        assert following.ar_following_set_manual(False, 0)
    finally:
        finish.set()
        worker.join(2)
    assert results == ["Following request was retired by Stop."]
    start.assert_not_called()
    assert output.set_manual(True, 2)
    assert not output.set_manual(False, 1)
    assert output.manual
