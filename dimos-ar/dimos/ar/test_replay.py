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
