import { toolSubtree } from "@dimos-ar-client/manipulation/ModelKinematics";
import type {
  ManipulationGroup,
  ManipulationModel,
} from "@dimos-ar-client/manipulation/ManipulationTypes";

/** Map normalized opening only to this group's independent finger joints. */
export function gripperJointValues(
  model: ManipulationModel,
  group: ManipulationGroup | undefined,
  opening: number | null | undefined,
): Record<string, number> {
  if (opening == null || !group?.has_gripper || !group.tip_frame) return {};
  const { links: toolLinks } = toolSubtree(model, group.tip_frame);
  const values: Record<string, number> = {};
  const t = Math.max(0, Math.min(1, opening));
  for (const joint of model.joints) {
    if (
      joint.kind !== "prismatic" ||
      !joint.limits ||
      joint.mimic ||
      !toolLinks.has(joint.child) ||
      group.joint_names.includes(joint.name)
    )
      continue;
    const { lower, upper } = joint.limits;
    const mapping = model.gripper_joints?.[joint.name];
    // Older descriptors use the standard lower-to-upper visual articulation.
    values[joint.name] = mapping
      ? mapping.closed + (mapping.open - mapping.closed) * t
      : lower + (upper - lower) * t;
  }
  return values;
}
