"""Hardware-free preflight, executed with the launcher's selected DimOS Python."""

from __future__ import annotations

import inspect
import json
from importlib.metadata import requires, version
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

# No mesh conversion, asset downloads, hardware adapters, workers, or RPC sessions.
PROBE_URDF = """<robot name="launcher_probe">
<link name="base"/><link name="tip"/>
<joint name="joint" type="revolute"><parent link="base"/><child link="tip"/>
<axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="1" velocity="1"/>
</joint></robot>"""


def check_planner() -> dict[str, Any]:
    result: dict[str, Any] = {"ready": False, "state": "incomplete"}
    try:
        from packaging.requirements import Requirement

        result.update(
            dimos_version=version("dimos"), roboplan_version=version("roboplan")
        )
        constraints = [
            Requirement(raw)
            for raw in requires("dimos") or []
            if Requirement(raw).name == "roboplan"
        ]
        for requirement in constraints:
            if (
                requirement.marker is None
                or requirement.marker.evaluate({"extra": "planning"})
            ) and result["roboplan_version"] not in requirement.specifier:
                raise RuntimeError(
                    f"DimOS {result['dimos_version']} requires {requirement}; installed RoboPlan is {result['roboplan_version']}. Install manipulation dependencies."
                )
        from dimos.manipulation.manipulation_module import ManipulationModule
        from dimos.manipulation.planning.groups.models import PlanningGroupDefinition
        from dimos.manipulation.planning.spec.config import RobotModelConfig
        from dimos.manipulation.planning.spec.validation import prepare_robot_model
        from dimos.manipulation.planning.world.roboplan_world import RoboPlanWorld
        from dimos.robot.assets.model import RobotModel

        if "plan_id" not in inspect.signature(
            ManipulationModule.execute
        ).parameters or not callable(
            getattr(ManipulationModule, "inverse_kinematics", None)
        ):
            raise RuntimeError(
                "DimOS is missing execute-by-plan-ID or nonmoving IK. Update the selected DimOS checkout."
            )
        with TemporaryDirectory(prefix="dimos-planner-check-") as directory:
            path = Path(directory) / "probe.urdf"
            path.write_text(PROBE_URDF)
            config = RobotModelConfig(
                model=RobotModel.from_file(path).with_default_joint_acceleration_limit(
                    2.0
                ),
                joint_names=["joint"],
                base_link="base",
                auto_convert_meshes=False,
                planning_groups=[
                    PlanningGroupDefinition(
                        name="probe",
                        joint_names=("joint",),
                        base_link="base",
                        tip_link="tip",
                    )
                ],
            )
            world = RoboPlanWorld()
            world.load_model(prepare_robot_model(config))
            world.finalize()
        result.update(ready=True, state="ready", message="Manipulation planner ready")
    except Exception as exc:  # noqa: BLE001 — report native planner incompatibilities to the UI
        result["message"] = str(exc)
    return result


if __name__ == "__main__":
    result = check_planner()
    print(json.dumps(result))
    raise SystemExit(0 if result["ready"] else 1)
