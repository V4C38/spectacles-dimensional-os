import { rotateVecByQuat } from "../localization/clientTrackingTransforms";
import type { Quat, Vec3 } from "../websocket/protocolTypes";
import type {
  ManipulationModel,
  ManipulationPlan,
  ManipulationPose,
} from "./ManipulationTypes";

export function multiplyRotation(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function composePose(
  a: ManipulationPose,
  b: ManipulationPose,
): ManipulationPose {
  const p = rotateVecByQuat(a.orientation, b.position);
  return {
    position: p.map((v, i) => v + a.position[i]) as Vec3,
    orientation: multiplyRotation(a.orientation, b.orientation),
  };
}
/** Visual FK only, using the configured model descriptor; never used for control. */
export function linkPoses(
  model: ManipulationModel,
  values: Record<string, number>,
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
  plan: ManipulationPlan,
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

export function manipulationPlanPath(model: ManipulationModel, plan: ManipulationPlan,
  tip: string, values: Record<string, number>, root: ManipulationPose): Vec3[] {
  const count = Math.min(240, Math.max(2, Math.ceil(plan.duration * 30)));
  return Array.from({ length: count + 1 }, (_, i) => composePose(root,
    linkPoses(model, { ...values, ...samplePlan(plan, plan.duration * i / count) })[tip]).position);
}

export function inversePose(pose: ManipulationPose): ManipulationPose {
  const q = pose.orientation;
  const inverse: Quat = [-q[0], -q[1], -q[2], q[3]];
  return { position: rotateVecByQuat(inverse, pose.position.map(v => -v) as Vec3), orientation: inverse };
}

export function toolSubtree(
  model: ManipulationModel,
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
