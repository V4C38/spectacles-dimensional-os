import type { ManipulationGroup, ManipulationModel } from "@dimos-ar-client/manipulation/ManipulationTypes";

/** Map normalized opening only to this group's independent finger joints. */
export function gripperJointValues(model: ManipulationModel, group: ManipulationGroup | undefined,
  opening: number | null | undefined): Record<string, number> {
  if (opening == null || !group?.has_gripper || !group.tip_frame) return {};
  let root = group.tip_frame;
  let parent = model.joints.find(j => j.child === root);
  while (parent?.kind === "fixed") {
    root = parent.parent;
    parent = model.joints.find(j => j.child === root);
  }
  const toolLinks = new Set([root]);
  for (let pass = 0; pass < model.joints.length; pass++)
    for (const joint of model.joints) if (toolLinks.has(joint.parent)) toolLinks.add(joint.child);
  const values: Record<string, number> = {};
  const t = Math.max(0, Math.min(1, opening));
  for (const joint of model.joints) {
    if (joint.kind !== "prismatic" || !joint.limits || joint.mimic || !toolLinks.has(joint.child) || group.joint_names.includes(joint.name)) continue;
    const { lower, upper } = joint.limits;
    values[joint.name] = model.asset_url === "/models/openyam.glb"
      ? upper - (upper - lower) * t : lower + (upper - lower) * t;
  }
  return values;
}
