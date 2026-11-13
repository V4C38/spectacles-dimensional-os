import { composePose } from "../localization/ClientTracking";
import type { Quat, Vec3, ReadonlyFacts } from "../ClientContracts";
import type { ManipulationModel, ManipulationPlan, ManipulationPose, ManipulationGroup } from "./ManipulationTypes";

export { composePose, inversePose } from "../localization/ClientTracking";
/** Visual FK only, using the configured model descriptor; never used for control. */
export function linkPoses(
  model: ReadonlyFacts<ManipulationModel>,
  values: Readonly<Record<string, number>>,
): Record<string, ManipulationPose> {
  const poses: Record<string, ManipulationPose> = {
    [model.root]: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
  };
  const resolved = { ...values };
  for (let pass = 0; pass < model.joints.length; pass++) {
    let progress = false;
    for (const joint of model.joints) {
      if (poses[joint.child] || !poses[joint.parent]) continue;
      if (joint.mimic && resolved[joint.mimic.joint] === undefined) continue;
      const value = joint.mimic
        ? resolved[joint.mimic.joint] * joint.mimic.multiplier +
          joint.mimic.offset
        : (resolved[joint.name] ?? 0);
      resolved[joint.name] = value;
      const axisLength = Math.hypot(...joint.axis);
      if (axisLength === 0 && joint.kind !== "fixed")
        throw new Error("Invalid joint axis");
      const axis = joint.axis.map((v) => v / (axisLength || 1)) as Vec3;
      const motion: ManipulationPose = {
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
      };
      if (joint.kind === "prismatic")
        motion.position = axis.map((v) => v * value) as Vec3;
      else if (joint.kind !== "fixed")
        motion.orientation = [
          ...axis.map((v) => v * Math.sin(value / 2)),
          Math.cos(value / 2),
        ] as Quat;
      poses[joint.child] = composePose(
        poses[joint.parent],
        composePose(joint.origin, motion),
      );
      progress = true;
    }
    if (!progress) break;
  }
  if (Object.keys(poses).length !== model.links.length)
    throw new Error("Unresolved visual topology or mimic joint");
  return poses;
}
export function samplePlan(
  plan: ReadonlyFacts<ManipulationPlan>,
  time: number,
): Record<string, number> {
  let a = plan.trajectory[0],
    b = a;
  for (const point of plan.trajectory) {
    b = point;
    if (point.time >= time) break;
    a = point;
  }
  const fraction =
    b.time > a.time
      ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)))
      : 0;
  return Object.fromEntries(
    plan.joint_names.map((name, i) => [
      name,
      a.positions[i] + (b.positions[i] - a.positions[i]) * fraction,
    ]),
  );
}

export function manipulationPlanPath(model: ReadonlyFacts<ManipulationModel>, plan: ReadonlyFacts<ManipulationPlan>,
  tip: string, values: Readonly<Record<string, number>>, root: ReadonlyFacts<ManipulationPose>, startTime = 0): Vec3[] {
  const count = Math.min(240, Math.max(2, Math.ceil(plan.duration * 30)));
  return Array.from({ length: count + 1 }, (_, i) => composePose(root,
    linkPoses(model, { ...values, ...samplePlan(plan, startTime + (plan.duration - startTime) * i / count) })[tip]).position);
}

export function toolSubtree(
  model: ReadonlyFacts<ManipulationModel>,
  tipFrame: string,
): {
  root: string;
  links: ReadonlySet<string>;
} {
  let root = tipFrame;
  let parent = model.joints.find((joint) => joint.child === root);
  while (parent?.kind === "fixed") {
    root = parent.parent;
    parent = model.joints.find((joint) => joint.child === root);
  }
  const links = new Set([root]);
  for (let pass = 0; pass < model.joints.length; pass++)
    for (const joint of model.joints)
      if (links.has(joint.parent)) links.add(joint.child);
  return { root, links };
}

/** Map normalized opening only to this group's independent finger joints. */
export function gripperJointValues(
  model: ReadonlyFacts<ManipulationModel>,
  group: ReadonlyFacts<ManipulationGroup> | undefined,
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
    const mapping = model.gripper_joints?.[joint.name];
    if (mapping) values[joint.name] = mapping.closed + (mapping.open - mapping.closed) * t;
  }
  return values;
}

export function jointDelta(from: number, to: number, continuous: boolean): number {
  const delta = to - from;
  return continuous ? Math.atan2(Math.sin(delta), Math.cos(delta)) : delta;
}
