"""Hardware-free verification of the official planning scene and AR worker snapshots."""

from dimos.ar.manipulation.adapter import DimOSManipulationAdapter
from dimos.ar.manipulation.collision_model import (
    with_finger_self_collision_exclusion,
    with_openyam_collision_geometry,
)
from dimos.ar.manipulation.limits import safe_openyam_model
from dimos.ar.manipulation.model import describe_model
from dimos.ar.manipulation.module import ARManipulationModuleConfig
from dimos.manipulation.manipulation_module import ManipulationModule
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.robot.manipulators.openyam.config import make_openyam_model_config


def check_scene():
    config = ARManipulationModuleConfig(
        model=with_finger_self_collision_exclusion(with_openyam_collision_geometry(safe_openyam_model(make_openyam_model_config())))
    )
    module = ManipulationModule(model=config.model)
    module.config = config
    adapter = DimOSManipulationAdapter(module)
    try:
        module._initialize_planning()
        feedback = JointState(name=list(config.model.joint_names), position=list(config.model.home_joints))
        adapter.feedback = feedback
        module._on_joint_state(feedback)
        import xml.etree.ElementTree as ET
        collision_links = [link.attrib["name"] for link in ET.fromstring(config.model.model.load().xml).findall("link")
                           if link.findall("collision")]
        scene = module._world_monitor.world._scene
        assert all(scene.getCollisionGeometryIDs(link) for link in collision_links)
        assert module._world_monitor.is_state_valid(feedback), "home must remain valid"
        group = module.list_planning_groups()[0].id
        pose = module._world_monitor.get_group_ee_pose(group, feedback)
        target = PoseStamped(frame_id="world", position=[pose.x + 0.01, pose.y, pose.z], orientation=pose.orientation)
        evaluation = adapter.evaluate(group, target)
        assert evaluation.success, evaluation.message
        plan = adapter.plan_to_poses({group: target}, speed_scale=0.2)
        assert plan.succeeded and plan.plan is not None
        retired_worker = adapter.worker
        assert retired_worker is not None
        old_pid = retired_worker.process.pid
        retired_worker.process.terminate()
        retired_worker.process.wait(timeout=5)
        try:
            adapter.plan_to_poses({group: target}, speed_scale=0.2)
        except (OSError, EOFError):
            pass
        else:
            raise AssertionError("a dead planner transport did not fail its current request")
        assert retired_worker.closed
        obstacle = module.add_obstacle(
            "new-environment-obstacle", Pose(position=target.position), "sphere", [1.0]
        )
        assert obstacle
        assert not module._world_monitor.is_state_valid(feedback), "parent world ignored the obstacle"
        assert not adapter.evaluate(group, target).success, "advisory worker ignored the new obstacle"
        try:
            adapter.execute(blocking=False, plan_id=plan.plan.plan_id)
        except ValueError as exc:
            assert "scene changed" in str(exc)
        else:
            raise AssertionError("a plan from the old scene remained executable")
        try:
            adapter.plan_to_poses({group: target}, speed_scale=0.2)
        except ValueError:
            pass
        else:
            raise AssertionError("checked planner ignored the new obstacle")
        assert adapter.worker is not retired_worker
        assert adapter.worker.process.pid != old_pid
        assert module.remove_obstacle(obstacle)
        assert adapter.evaluate(group, target).success
        assert adapter.plan_to_poses({group: target}, speed_scale=0.2).succeeded
        description = describe_model(config.model.model.load().xml)
        finger = next(link for link in description["links"] if link["name"] == "tip_left")
        world = module._world_monitor.world
        with world.scratch_context() as context:
            world.set_joint_state(context, feedback)
            transform = world.get_link_pose(context, "tip_left")
        import numpy as np
        center = transform[:3, :3] @ np.asarray(finger["bounds"]["center"]) + transform[:3, 3]
        finger_obstacle = module.add_obstacle(
            "finger-environment", Pose(position=center.tolist()), "sphere", [0.02]
        )
        for link in collision_links:
            scene.setCollisions(link, finger_obstacle, link == "tip_left")
        assert not module._world_monitor.is_state_valid(feedback), "finger collision geometry is absent"
        assert module.remove_obstacle(finger_obstacle)
        assert module._world_monitor.is_state_valid(feedback)
        print("Official planning scene synchronization verified", flush=True)
    finally:
        adapter.close_workers()
        module.stop()


if __name__ == "__main__":
    check_scene()
