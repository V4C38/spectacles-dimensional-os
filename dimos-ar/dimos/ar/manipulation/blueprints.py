"""Official OpenYAM composition, loaded only by its optional entry point."""

from dimos.ar.manipulation.frames import ReferencePose
from dimos.ar.manipulation.module import ARManipulationModule
from dimos.ar.module import ARModule
from dimos.ar.robot.profiles.profile import RobotName
from dimos.control.coordinator import TaskConfig
from dimos.control.tasks.trajectory_task.trajectory_task import joint_trajectory_task
from dimos.core.coordination.blueprints import autoconnect
from dimos.robot.manipulators.common.blueprints import cartesian_ik_task, coordinator
from dimos.robot.manipulators.common.coordinators import ArmPoseCoordinator
from dimos.robot.manipulators.openyam.config import make_openyam_model_config, openyam_hardware

_model = make_openyam_model_config()
_hardware = openyam_hardware()
if _hardware.adapter_type == "mock_whole_body":
    _hardware.adapter_kwargs["initial_positions"] = [
        *(_model.home_joints or [0.0] * len(_model.joint_names)),
        *([0.0] * (len(_hardware.joints) - len(_model.joint_names))),
    ]
_pose_groups = [g for g in _model.planning_groups if g.tip_link]
_tasks = {g.name: f"ar_follow_{g.name}" for g in _pose_groups}

openyam_ar_planner = autoconnect(
    ARManipulationModule.blueprint(
        model=_model,
        instance_name="ManipulationModule",
        following_tasks=_tasks,
        model_asset_url="/models/openyam.glb",
    ),
    coordinator(
        cls=ArmPoseCoordinator,
        instance_name="ControlCoordinator",
        hardware=[_hardware],
        tasks=[
            joint_trajectory_task(_hardware.joints),
            TaskConfig(
                name=f"{_hardware.hardware_id}_gripper",
                type="gripper",
                joint_names=[name for name in _hardware.joints if name not in _model.joint_names],
                priority=20,
            ),
            *[
                cartesian_ik_task(
                    _hardware,
                    robot_model=_model,
                    target_frame=g.tip_link,
                    name=_tasks[g.name],
                    priority=20,
                )
                for g in _pose_groups
            ],
        ],
    ),
    ARModule.blueprint(
        robot=RobotName.OPENYAM,
        stationary_base=ReferencePose(),
    ),
)

openyam_ar_planner = openyam_ar_planner.global_config(
    n_workers=len(openyam_ar_planner.active_blueprints),
)
