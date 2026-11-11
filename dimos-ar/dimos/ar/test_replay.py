import pytest

from dimos.ar.replay import inspect_recording
from dimos.memory.store.sqlite import SqliteStore
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.robot.manipulators.openyam.config import make_openyam_model_config


def record(path, streams):
    store = SqliteStore(path=str(path))
    store.start()
    for name, samples in streams.items():
        stream = store.stream(name, JointState)
        for i, sample in enumerate(samples):
            stream.append(sample, ts=10 + i * 0.1)
    store.stop()


def sample():
    model = make_openyam_model_config()
    return JointState(name=list(model.joint_names), position=list(model.home_joints))


def test_arm_recording_validates_payload_not_stream_name(tmp_path):
    path = tmp_path / "arm.db"
    record(path, {"anything": [sample(), sample()]})
    assert inspect_recording(str(path), "openyam")["streams"] == {"joints": "anything"}


def test_arm_recording_rejects_later_incomplete_sample(tmp_path):
    path = tmp_path / "arm.db"
    record(path, {"joints": [sample(), JointState(name=["other"], position=[0])]})
    with pytest.raises(ValueError, match="Every arm sample"):
        inspect_recording(str(path), "openyam")


def test_multiple_arm_streams_require_explicit_selection(tmp_path):
    path = tmp_path / "arm.db"
    record(path, {"measured": [sample()], "commanded": [sample()]})
    info = inspect_recording(str(path), "openyam")
    assert info["needs_selection"]
    assert set(info["candidates"]["joints"]) == {"measured", "commanded"}
    assert not inspect_recording(str(path), "openyam", {"joints": "measured"})["needs_selection"]
    with pytest.raises(ValueError, match="Invalid joints stream"):
        inspect_recording(str(path), "openyam", {"joints": "missing"})


def test_replay_compositions_have_only_the_ar_publisher_and_keep_config_identity():
    from dimos.ar.replay import openyam_ar_replay, unitree_go2_ar_replay

    for blueprint in (openyam_ar_replay, unitree_go2_ar_replay):
        assert len(blueprint.active_blueprints) == 1
        atom = blueprint.active_blueprints[0]
        assert atom.name == "ARModule"


@pytest.mark.asyncio
async def test_playback_preserves_producer_timing_despite_delayed_camera_delivery(monkeypatch):
    import time
    from types import SimpleNamespace
    from unittest.mock import Mock

    from dimos.ar.localization.source_clock import RobotSourceClock
    from dimos.ar.replay import RecordedARModule
    from dimos.ar.robot.odometry import RobotOdometry
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

    now = [110.15]
    monkeypatch.setattr(time, "time", lambda: now[0])
    module = object.__new__(RecordedARModule)
    module._last_samples = {}
    module._recording_epoch = 100
    module._odometry = RobotOdometry(factor=1)
    module._odometry.clock = RobotSourceClock()
    paired = []
    async def odom(sample):
        module._odometry.accept(sample)
    async def image(sample):
        paired.append(module._odometry.history.at_image_ts(sample.ts))
    module.handle_odom = odom
    module.handle_color_image = image
    first = PoseStamped(ts=10, position=[0, 0, 0])
    await module._sample("odom", first)
    await module._sample("odom", PoseStamped(ts=10.1, position=[2, 0, 0]))
    now[0] = 110.3
    await module._sample("color_image", SimpleNamespace(ts=10.05))
    assert paired[0].position[0] == pytest.approx(1)
    assert paired[0].ts_server == pytest.approx(110.05)
    assert first.ts == 10
    latest = module._odometry.history.latest()
    module._state_publisher = SimpleNamespace(publish_odom=Mock())
    for _ in range(3):
        now[0] += 10
        await module._publish_retained()
    assert module._odometry.history.latest() is latest
    assert latest.ts_server == pytest.approx(110.1)
    assert module._state_publisher.publish_odom.call_count == 3
