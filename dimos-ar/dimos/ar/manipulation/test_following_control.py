"""Exercise the production following solver without any hardware or server."""

import math

import numpy as np
import pytest

from dimos.ar.manipulation.following import create_task
from dimos.control.coordinator import TaskConfig
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.robot.manipulators.openyam.config import make_openyam_model_config


def follow_task():
    model = make_openyam_model_config()
    task = create_task(
        TaskConfig(
            name="follow",
            type="ar_cartesian_ik",
            joint_names=model.joint_names,
            params={"robot_model": model, "target_frame": "gripper_tip"},
        ),
        None,
    )
    return model, task


def feedback(model, values):
    return JointState(name=list(model.joint_names), position=values.tolist())


def pose_key(pose):
    return [
        pose.x,
        pose.y,
        pose.z,
        pose.orientation.x,
        pose.orientation.y,
        pose.orientation.z,
        pose.orientation.w,
    ]


@pytest.mark.parametrize("speed", [0.25, 0.5, 1.0])
@pytest.mark.parametrize("lag_s", [0.0, 0.08])
def test_static_cartesian_target_is_bounded_and_does_not_oscillate(speed, lag_s):
    model, task = follow_task()
    solver = task._solver
    solver.speed_scale = speed
    actual = np.array(model.home_joints)
    goal = actual.copy()
    goal[0] += 0.2
    target = solver.frame_poses(feedback(model, goal), ("gripper_tip",))["gripper_tip"]
    previous = actual.copy()
    velocity = np.zeros_like(actual)
    acceleration = np.array([solver.acceleration_limits[name] for name in model.joint_names])
    limits = np.array(
        [task._config.joint_velocity_limits_rad_s[name] for name in model.joint_names]
    )
    for _ in range(250 if not lag_s else 400):
        command = solver.step({"gripper_tip": target}, feedback(model, actual), 0.01)
        assert command is not None, solver.failure
        current = np.array(command.position)
        next_velocity = (current - previous) / 0.01
        assert np.all(np.abs(next_velocity) <= limits * speed + 1e-7)
        assert np.all(np.abs(next_velocity - velocity) <= acceleration * speed * 0.01 + 1e-7)
        assert next_velocity[0] >= -0.001
        actual = (
            current if not lag_s else actual + (current - actual) * (1 - math.exp(-0.01 / lag_s))
        )
        previous, velocity = current, next_velocity
    measured = solver.frame_poses(feedback(model, actual), ("gripper_tip",))["gripper_tip"]
    assert (
        np.linalg.norm(
            np.array(measured.position.to_tuple()) - np.array(target.position.to_tuple())
        )
        < 0.005
    )
    dot = abs(
        sum(
            getattr(measured.orientation, axis) * getattr(target.orientation, axis)
            for axis in ("x", "y", "z", "w")
        )
    )
    assert 2 * math.acos(min(1, dot)) < math.radians(3)
    assert solver._arrival_hold


def test_advisory_endpoints_cannot_reverse_a_static_cartesian_target():
    model, task = follow_task()
    solver = task._solver
    actual = np.array(model.home_joints)
    old_goal = actual.copy()
    old_goal[0] += 0.4
    goal = actual.copy()
    goal[0] -= 0.4
    old = solver.frame_poses(feedback(model, old_goal), ("gripper_tip",))["gripper_tip"]
    target = solver.frame_poses(feedback(model, goal), ("gripper_tip",))["gripper_tip"]
    task.set_target(old, 0.5, t_now=0.0)
    task.set_validated_target(pose_key(old), dict(zip(model.joint_names, old_goal, strict=True)))
    task.set_target(target, 0.5, t_now=0.01)
    for tick in range(250):
        if tick in {30, 60, 90}:
            # Old, delayed or different-branch advisory IK cannot become a drive target.
            task.set_validated_target(
                pose_key(target), dict(zip(model.joint_names, old_goal, strict=True))
            )
        command = solver.step({"gripper_tip": target}, feedback(model, actual), 0.01)
        assert command is not None, solver.failure
        current = np.array(command.position)
        assert current[0] <= actual[0] + 1e-5
        actual = current
    assert actual[0] < -0.3


def test_multi_joint_static_target_converges_with_feedback_lag():
    model, task = follow_task()
    solver = task._solver
    solver.speed_scale = 0.5
    actual = np.array(model.home_joints)
    goal = actual + np.array([0.2, 0.1, -0.12, 0.0, 0.1, 0.05])
    target = solver.frame_poses(feedback(model, goal), ("gripper_tip",))["gripper_tip"]
    final_positions = []
    for tick in range(600):
        command = solver.step({"gripper_tip": target}, feedback(model, actual), 0.01)
        assert command is not None, solver.failure
        current = np.array(command.position)
        actual += (current - actual) * (1 - math.exp(-0.01 / 0.08))
        if tick >= 500:
            final_positions.append(current)
    assert np.max(np.ptp(final_positions, axis=0)) < 0.002
    measured = solver.frame_poses(feedback(model, actual), ("gripper_tip",))["gripper_tip"]
    assert (
        np.linalg.norm(
            np.array(measured.position.to_tuple()) - np.array(target.position.to_tuple())
        )
        < 0.005
    )
    dot = abs(
        sum(
            getattr(measured.orientation, axis) * getattr(target.orientation, axis)
            for axis in ("x", "y", "z", "w")
        )
    )
    assert 2 * math.acos(min(1, dot)) < math.radians(3)
