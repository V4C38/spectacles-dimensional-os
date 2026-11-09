import math
import xml.etree.ElementTree as ET

from dimos.ar.manipulation.limits import safe_openyam_model, soft_joint_limits
from dimos.robot.manipulators.openyam.config import make_openyam_model_config


def test_planning_joint_one_cannot_request_physical_fault_range():
    original = make_openyam_model_config()
    safe = safe_openyam_model(original)
    root = ET.fromstring(safe.model.load().xml)
    joints = {j.attrib["name"]: j for j in root.findall("joint")}
    limit = joints["yam_joint1"].find("limit")
    assert limit is not None
    assert math.isclose(float(limit.attrib["upper"]), 1.5708)
    assert float(limit.attrib["lower"]) == -2.61799
    assert math.isclose(soft_joint_limits(safe)["yam_joint1"][1], 1.5708 - math.radians(3))
    joint_two = joints["yam_joint2"].find("limit")
    assert joint_two is not None
    assert float(joint_two.attrib["lower"]) <= 0.007820248722056888
    assert soft_joint_limits(safe)["yam_joint2"][0] > 0.007820248722056888
    assert safe.joint_names == original.joint_names
    assert safe.home_joints == original.home_joints
    for name in safe.joint_names:
        bound = joints[name].find("limit")
        assert bound is not None
        assert float(bound.attrib["lower"]) < float(bound.attrib["upper"])


def test_follow_accepts_valid_feedback_inside_the_command_margin():
    from dimos.ar.manipulation.following import create_task
    from dimos.control.coordinator import TaskConfig
    from dimos.msgs.sensor_msgs.JointState import JointState

    config = safe_openyam_model(make_openyam_model_config())
    task = create_task(
        TaskConfig(
            name="follow",
            type="ar_cartesian_ik",
            joint_names=config.joint_names,
            params={"robot_model": config, "target_frame": "gripper_tip"},
        ),
        {},
    )
    values = list(config.home_joints)
    values[1] = 0.007820248722056888
    goal = list(values)
    goal[1] += 0.1
    measured = JointState(name=list(config.joint_names), position=values)
    target = task._solver.frame_poses(
        JointState(name=list(config.joint_names), position=goal), ["gripper_tip"]
    )["gripper_tip"]
    command = task._solver.step({"gripper_tip": target}, measured, 0.01)
    assert command is not None, task._solver.failure
    assert task._solver.failure is None
    assert command.position[1] > measured.position[1]


def test_recovery_path_only_enters_the_margin_inward():
    from types import SimpleNamespace

    import pytest

    from dimos.ar.manipulation.limits import validate_soft_trajectory

    config = safe_openyam_model(make_openyam_model_config())

    def path(values):
        return SimpleNamespace(
            joint_names=["yam_joint2"], points=[SimpleNamespace(positions=[v]) for v in values]
        )

    validate_soft_trajectory(config, path([0.0078, 0.02, 0.06, 0.2]), {"yam_joint2": 0.0078})
    with pytest.raises(ValueError, match="outward"):
        validate_soft_trajectory(config, path([0.0078, 0.005, 0.2]), {"yam_joint2": 0.0078})
    with pytest.raises(ValueError, match="leaves"):
        validate_soft_trajectory(config, path([0.0078, 0.06, 0.04, 0.2]), {"yam_joint2": 0.0078})


def test_finger_collision_policy_keeps_visuals_and_arm_collisions():
    import pickle

    from dimos.ar.manipulation.collision_model import with_finger_self_collision_exclusion

    original = safe_openyam_model(make_openyam_model_config())
    config = with_finger_self_collision_exclusion(original)
    before = ET.fromstring(original.model.load().xml)
    after = ET.fromstring(pickle.loads(pickle.dumps(config.model)).load().xml)
    assert ET.tostring(after) == ET.tostring(before)
    assert ("tip_left", "tip_right") in config.collision_exclusion_pairs
    assert not original.collision_exclusion_pairs
    assert all(
        "tip_left" in pair or "tip_right" in pair
        for pair in config.collision_exclusion_pairs
    )


def test_collision_model_survives_blueprint_config_serialization():
    from dimos.ar.manipulation.collision_model import with_finger_self_collision_exclusion
    from dimos.manipulation.planning.spec.config import RobotModelConfig

    config = with_finger_self_collision_exclusion(safe_openyam_model(make_openyam_model_config()))
    restored = RobotModelConfig.model_validate(config.model_dump())
    assert restored.model.load().xml == config.model.load().xml
    assert restored.model.load().joints == config.model.load().joints


def test_openyam_collision_compatibility_preserves_exact_visual_geometry():
    from dimos.ar.manipulation.collision_model import with_openyam_collision_geometry

    original = safe_openyam_model(make_openyam_model_config())
    config = with_openyam_collision_geometry(original)
    before = ET.fromstring(original.model.load().xml)
    after = ET.fromstring(config.model.load().xml)
    links = {link.attrib["name"]: link for link in before.findall("link")}
    for link in after.findall("link"):
        visuals = links[link.attrib["name"]].findall("visual")
        assert len(link.findall("collision")) == len(visuals)
        for collision, visual in zip(link.findall("collision"), visuals, strict=True):
            assert ET.tostring(collision.find("geometry")) == ET.tostring(visual.find("geometry"))
            assert ET.tostring(collision.find("origin")) == ET.tostring(visual.find("origin"))
    assert config.joint_names == original.joint_names
    assert config.model.load().package_paths == original.model.load().package_paths
    assert with_openyam_collision_geometry(config) is config
