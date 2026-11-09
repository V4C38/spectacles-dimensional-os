import socket
import threading
from unittest.mock import Mock

import pytest

from dimos.ar.manipulation.planner_worker import PlanningWorker, receive, send


def test_timeout_retires_worker_before_a_late_plan_can_satisfy_another_target():
    worker = object.__new__(PlanningWorker)
    worker.channel, child = socket.socketpair()
    worker.channel.settimeout(0.02)
    worker.lock = threading.Lock()
    worker._closed = False
    worker.process = Mock()
    entered, release = threading.Event(), threading.Event()

    def native():
        receive(child)
        entered.set()
        release.wait(2)
        try:
            send(child, (True, "old-target-plan"))
        except OSError:
            pass

    thread = threading.Thread(target=native)
    thread.start()
    try:
        with pytest.raises(TimeoutError):
            worker.call("plan", None, "first-target")
        assert entered.is_set()
        release.set()
        thread.join(2)
        with pytest.raises(RuntimeError, match="retired"):
            worker.call("plan", None, "second-target")
        worker.process.terminate.assert_called_once()
        worker.close()
        worker.process.terminate.assert_called_once()
    finally:
        release.set()
        child.close()
        thread.join(2)
        worker.close()


def test_scene_replacement_preserves_environment_obstacles_and_removes_retired_ones():
    import pickle
    from types import SimpleNamespace

    from dimos.ar.manipulation.planner_worker import synchronize_scene

    obstacles = {"old": SimpleNamespace(name="old")}

    def remove(name):
        return obstacles.pop(name, None) is not None

    def add(obstacle):
        obstacles[obstacle.name] = obstacle
        return obstacle.name

    monitor = SimpleNamespace(
        world=SimpleNamespace(get_obstacles=lambda: list(obstacles.values())),
        remove_obstacle=remove, add_obstacle=add,
    )
    synchronize_scene(monitor, pickle.dumps([SimpleNamespace(name="table")]))
    assert set(obstacles) == {"table"}
    synchronize_scene(monitor, pickle.dumps([]))
    assert not obstacles


def test_changed_scene_retires_a_plan_before_execution():
    from types import SimpleNamespace

    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter

    module = SimpleNamespace(config=None, execute=Mock(), clear_planned_path=Mock())
    adapter = DimOSManipulationAdapter(module)
    adapter.scene_snapshot = Mock(return_value=b"new scene")
    adapter._plan_scene = b"old scene"
    with pytest.raises(ValueError, match="scene changed"):
        adapter.execute(blocking=False, plan_id="checked")
    module.execute.assert_not_called()
    module.clear_planned_path.assert_called_once()


def test_next_target_replaces_timed_out_transport_and_uses_the_current_scene(monkeypatch):
    from types import SimpleNamespace

    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
    from dimos.manipulation.manipulation_spec import PlanResult, PlanStatus

    workers, children, threads, requests = [], [], [], []
    release = threading.Event()
    response = PlanResult(PlanStatus.SUCCEEDED, "new target checked", SimpleNamespace(plan_id="new-target-plan"))

    def factory(config):
        worker = object.__new__(PlanningWorker)
        worker.channel, child = socket.socketpair()
        worker.channel.settimeout(0.03 if not workers else 2)
        worker.lock = threading.Lock()
        worker._closed = False
        worker.process = Mock()
        index = len(workers)
        workers.append(worker)
        children.append(child)

        def remote():
            requests.append(receive(child))
            if index == 0:
                release.wait(2)
            try:
                reply = response if index else PlanResult(
                    PlanStatus.SUCCEEDED, "obsolete", SimpleNamespace(plan_id="old-target-plan")
                )
                send(child, (True, reply))
            except OSError:
                pass

        thread = threading.Thread(target=remote)
        thread.start()
        threads.append(thread)
        return worker

    monkeypatch.setattr("dimos.ar.manipulation.adapter.PlanningWorker", factory)
    module = SimpleNamespace(config=SimpleNamespace(), _lock=threading.RLock(), _last_plan=None)
    adapter = DimOSManipulationAdapter(module)
    adapter.scene_snapshot = Mock(return_value=b"old scene")
    try:
        with pytest.raises(TimeoutError):
            adapter.plan_to_joints({"arm": "old target"}, speed_scale=0.2)
        assert len(workers) == 1, "the failed request must not retry itself"
        assert workers[0].closed
        release.set()
        threads[0].join(2)
        adapter.scene_snapshot.return_value = b"current scene"
        result = adapter.plan_to_joints({"arm": "new target"}, speed_scale=0.2)
        assert result.plan.plan_id == module._last_plan.plan_id == "new-target-plan"
        assert len(workers) == 2
        assert workers[1].channel is not workers[0].channel
        assert workers[1].process is not workers[0].process
        assert requests[1][2] == ({"arm": "new target"},)
        assert requests[1][3]["scene"] == b"current scene"
        adapter.close_workers()
        with pytest.raises(RuntimeError, match="closed"):
            adapter.plan_to_joints({"arm": "after shutdown"}, speed_scale=0.2)
        assert len(workers) == 2
    finally:
        release.set()
        adapter.close_workers()
        for child in children:
            child.close()
        for thread in threads:
            thread.join(2)


@pytest.mark.parametrize("advisory", [False, True])
def test_shutdown_during_replacement_startup_cannot_publish_or_resurrect_a_worker(monkeypatch, advisory):
    from types import SimpleNamespace

    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter

    entered, release = threading.Event(), threading.Event()
    replacement = Mock(closed=False)

    def factory(config):
        entered.set()
        assert release.wait(2)
        return replacement

    build = Mock(side_effect=factory)
    monkeypatch.setattr("dimos.ar.manipulation.adapter.PlanningWorker", build)
    config = SimpleNamespace()
    config.model_copy = lambda **kwargs: config
    adapter = DimOSManipulationAdapter(SimpleNamespace(config=config))
    errors = []

    def start():
        try:
            adapter._get_worker(advisory=advisory)
        except RuntimeError as error:
            errors.append(str(error))

    thread = threading.Thread(target=start)
    thread.start()
    try:
        assert entered.wait(1)
        adapter.close_workers()
        assert adapter.worker is None
        release.set()
        thread.join(2)
        assert errors == ["Planning workers closed during startup"]
        replacement.close.assert_called_once()
        with pytest.raises(RuntimeError, match="closed"):
            adapter._get_worker(advisory=advisory)
        build.assert_called_once()
        assert adapter.worker is None
    finally:
        release.set()
        thread.join(2)
        adapter.close_workers()


@pytest.mark.parametrize("advisory", [False, True])
def test_concurrent_replacement_requests_share_one_worker_startup(monkeypatch, advisory):
    from types import SimpleNamespace

    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter

    entered, release = threading.Event(), threading.Event()
    replacement = Mock(closed=False)

    def factory(config):
        entered.set()
        assert release.wait(2)
        return replacement

    build = Mock(side_effect=factory)
    monkeypatch.setattr("dimos.ar.manipulation.adapter.PlanningWorker", build)
    config = SimpleNamespace()
    config.model_copy = lambda **kwargs: config
    adapter = DimOSManipulationAdapter(SimpleNamespace(config=config))
    workers = []
    threads = [threading.Thread(target=lambda: workers.append(adapter._get_worker(advisory=advisory)))
               for _ in range(2)]
    try:
        for thread in threads:
            thread.start()
        assert entered.wait(1)
        release.set()
        for thread in threads:
            thread.join(2)
        assert workers == [replacement, replacement]
        build.assert_called_once()
    finally:
        release.set()
        for thread in threads:
            thread.join(2)
        adapter.close_workers()


def test_module_shutdown_closes_worker_owner_before_waiting_for_startup_thread(monkeypatch):
    from types import SimpleNamespace

    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
    from dimos.ar.manipulation.module import ARManipulationModule, ManipulationModule
    from dimos.ar.manipulation.runtime import ManipulationRuntime

    native = object.__new__(ARManipulationModule)
    native.config = SimpleNamespace()
    native._adapter = DimOSManipulationAdapter(native)
    native._runtime = ManipulationRuntime(native._adapter)
    native._closing = False
    native._lifecycle_stop = threading.Event()
    native._auxiliary_thread = native._watchdog_thread = None
    entered, release = threading.Event(), threading.Event()
    replacement = Mock(closed=False)

    def factory(config):
        entered.set()
        assert release.wait(2)
        return replacement

    monkeypatch.setattr("dimos.ar.manipulation.adapter.PlanningWorker", factory)
    monkeypatch.setattr(ManipulationModule, "stop", lambda self: None)
    errors = []

    def start():
        try:
            native._adapter._get_worker(advisory=False)
        except RuntimeError as error:
            errors.append(str(error))

    thread = threading.Thread(target=start)

    def join(timeout):
        release.set()
        thread.join(timeout)

    native._lifecycle_thread = SimpleNamespace(join=join, is_alive=thread.is_alive)
    thread.start()
    try:
        assert entered.wait(1)
        native.stop()
        assert errors == ["Planning workers closed during startup"]
        assert native._adapter.worker is None
        replacement.close.assert_called_once()
    finally:
        release.set()
        thread.join(2)
        native._adapter.close_workers()


@pytest.mark.parametrize("closed_by", ["stop", "failed_startup"])
def test_closed_worker_owner_rejects_module_restart_before_native_effects(monkeypatch, closed_by):
    from types import SimpleNamespace

    from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
    from dimos.ar.manipulation.module import ARManipulationModule, ManipulationModule
    from dimos.ar.manipulation.runtime import ManipulationRuntime

    native = object.__new__(ARManipulationModule)
    native.config = SimpleNamespace()
    native._adapter = DimOSManipulationAdapter(native)
    native._runtime = ManipulationRuntime(native._adapter)
    native._closing = False
    native._lifecycle_stop = threading.Event()
    native._lifecycle_thread = native._auxiliary_thread = native._watchdog_thread = None
    native_start = Mock()
    monkeypatch.setattr(ManipulationModule, "start", native_start)
    monkeypatch.setattr(ManipulationModule, "stop", Mock())
    if closed_by == "stop":
        native.stop()
    else:
        monkeypatch.setattr("dimos.ar.manipulation.adapter.PlanningWorker",
                            Mock(side_effect=RuntimeError("planning startup failed")))
        with pytest.raises(RuntimeError, match="planning startup failed"):
            native._adapter.prepare_feedback()
    closing = native._closing
    with pytest.raises(RuntimeError, match="restart the process"):
        native.start()
    native_start.assert_not_called()
    assert native._closing == closing
