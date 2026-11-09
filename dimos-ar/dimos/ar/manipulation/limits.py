"""Reconcile planning and physical OpenYAM limits without changing its geometry."""

import math
from typing import Any
import xml.etree.ElementTree as ET

from dimos.manipulation.planning.spec.config import RobotModelConfig
from dimos.robot.assets.model import RobotModel
from dimos.utils.data import LfsPath

# Match the installed coordinator tracking envelope in every AR command path.
COMMAND_TRACKING_LEAD_RAD = math.radians(10)


def safe_openyam_model(config: RobotModelConfig) -> RobotModelConfig:
    physical = RobotModel.from_file(
        LfsPath("yam_description") / "urdf/yam_gripper_gravity.urdf"
    ).load()
    bounds = {
        joint.attrib["name"]: joint.find("limit")
        for joint in ET.fromstring(physical.xml).findall("joint")
    }
    model = config.model
    for joint in ET.fromstring(model.load().xml).findall("joint"):
        name = joint.attrib["name"]
        if name not in config.joint_names:
            continue
        limit = joint.find("limit")
        hardware = bounds.get(name)
        if limit is None or hardware is None:
            raise ValueError(f"Missing safety limits for {name}")
        lower = max(float(limit.attrib["lower"]), float(hardware.attrib["lower"]))
        upper = min(float(limit.attrib["upper"]), float(hardware.attrib["upper"]))
        if lower >= upper:
            raise ValueError(f"Empty safety interval for {name}")
        # RobotModel applies limit replacements before joint renaming.
        model = model.with_joint_position_limits(
            name.removeprefix("yam_"), lower=lower, upper=upper
        )
    return config.model_copy(update={"model": model})


def soft_joint_limits(config: RobotModelConfig) -> dict[str, tuple[float, float]]:
    """Command limits are separate from the validity of measured feedback."""
    margin = math.radians(3)
    result = {}
    for joint in ET.fromstring(config.model.load().xml).findall("joint"):
        limit = joint.find("limit")
        name = joint.attrib["name"]
        if name in config.joint_names and limit is not None:
            result[name] = (
                float(limit.attrib["lower"]) + margin,
                float(limit.attrib["upper"]) - margin,
            )
    return result


def validate_soft_endpoint(config: RobotModelConfig, joints: dict[str, float]) -> None:
    for name, (lower, upper) in soft_joint_limits(config).items():
        if name in joints and not lower - 1e-6 <= joints[name] <= upper + 1e-6:
            raise ValueError(
                f"Joint limit: target {name} must stay inside the 3 degree safety margin"
            )


def validate_soft_trajectory(
    config: RobotModelConfig, trajectory: Any, measured: dict[str, float]
) -> None:
    """A measured start may enter the buffer, but a path may never move farther outward."""
    limits = soft_joint_limits(config)
    previous = dict(measured)
    recovering = {
        name
        for name, (lower, upper) in limits.items()
        if name in previous and not lower <= previous[name] <= upper
    }
    for point in trajectory.points:
        for name, value in zip(trajectory.joint_names, point.positions, strict=True):
            if name not in limits:
                continue
            lower, upper = limits[name]
            if lower - 1e-6 <= value <= upper + 1e-6:
                recovering.discard(name)
            elif name in recovering and name in previous:
                before = previous[name]
                inward = (before < lower and before - 1e-6 <= value <= lower) or (
                    before > upper and upper <= value <= before + 1e-6
                )
                if not inward:
                    raise ValueError(f"Joint limit: recovery path moves {name} outward")
            else:
                raise ValueError(f"Joint limit: path leaves the safety margin for {name}")
            previous[name] = value
