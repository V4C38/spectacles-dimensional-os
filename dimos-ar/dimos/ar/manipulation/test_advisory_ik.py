"""Configured advisory budgets and real six-axis IK recovery, without hardware."""

from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
from dimos.ar.manipulation.module import ARManipulationModuleConfig
from dimos.control.tasks.pose_target_ik import PinkPoseTargetSolver, PoseTargetIKTaskConfig
from dimos.manipulation.planning.kinematics.pink_ik import PinkIK
from dimos.manipulation.planning.spec.validation import prepare_robot_model
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.robot.manipulators.openyam.config import make_openyam_model_config


def test_advisory_worker_retains_configured_solver_budget(monkeypatch):
    config = ARManipulationModuleConfig(model=make_openyam_model_config())
    config.kinematics.max_iterations = 237
    workers = []

    def worker(settings):
        workers.append(settings)
        return Mock()

    monkeypatch.setattr("dimos.ar.manipulation.adapter.PlanningWorker", worker)
    monkeypatch.setattr("dimos.ar.manipulation.adapter.PinkPoseTargetSolver", Mock())
    adapter = DimOSManipulationAdapter(SimpleNamespace(config=config))
    adapter.prepare_feedback()
    assert len(workers) == 2
    assert workers[1] is not config
    assert workers[0].kinematics.max_iterations == 237
    assert workers[1].kinematics.max_iterations == 237
    assert adapter.worker is not adapter.evaluation_worker


@pytest.mark.parametrize("delta", [
    [0.6, 0.3, -0.3, 0.2, 0.2, 0.3],
    [-0.6, -0.3, 0.3, -0.2, -0.2, -0.3],
    [1.0, 0.4, -0.4, 0.3, 0.3, 0.4],
])
def test_real_six_axis_targets_repeat_and_recover_after_unreachable_target(delta):
    model = make_openyam_model_config()
    config = ARManipulationModuleConfig(model=model)
    prepared = prepare_robot_model(model)
    # Exercise installed Pink IK against the real model. Collision admission is
    # controlled here; the worker retains the production world's collision checks.
    collision_check = Mock(return_value=True)
    world = SimpleNamespace(
        is_finalized=True,
        get_prepared_model=lambda: prepared,
        check_config_collision_free=collision_check,
    )
    fk = PinkPoseTargetSolver(PoseTargetIKTaskConfig(
        joint_names=tuple(model.joint_names), robot_model=model,
        target_frames=("gripper_tip",),
    ))
    seed = JointState(name=list(model.joint_names), position=list(model.home_joints))
    target = fk.frame_poses(JointState(
        name=list(model.joint_names),
        position=(np.array(model.home_joints) + delta).tolist(),
    ), ("gripper_tip",))["gripper_tip"]
    group = prepared.planning_groups[0]
    truncated = PinkIK(config.kinematics.model_copy(update={"max_iterations": 12}))
    assert not truncated.solve_pose_targets(
        world, {group: target}, seed=seed, max_attempts=1
    ).is_success()
    solver = PinkIK(config.kinematics)
    for _ in range(3):
        result = solver.solve_pose_targets(world, {group: target}, seed=seed, max_attempts=1)
        assert result.is_success(), result.message
        assert result.position_error < 0.001
        assert result.orientation_error < 0.01
    impossible = PoseStamped(position=[10, 10, 10])
    assert not solver.solve_pose_targets(
        world, {group: impossible}, seed=seed, max_attempts=1
    ).is_success()
    recovered = solver.solve_pose_targets(world, {group: target}, seed=seed, max_attempts=1)
    assert recovered.is_success(), recovered.message
    assert recovered.joint_state is not None
    collision_check.return_value = False
    assert not solver.solve_pose_targets(
        world, {group: target}, seed=seed, max_attempts=1
    ).is_success()
    assert collision_check.call_count == 5
