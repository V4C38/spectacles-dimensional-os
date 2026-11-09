import { linkPoses } from "./ModelKinematics";
import type { ManipulationModel } from "./ManipulationTypes";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected manipulation object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128)
    throw new Error("Invalid manipulation identifier");
  return value;
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid manipulation number");
  return value;
}
function vector(value: unknown, count: number): number[] {
  if (!Array.isArray(value) || value.length !== count)
    throw new Error("Invalid manipulation vector");
  return value.map(finite);
}
function pose(value: unknown, path = "pose"): void {
  try {
    const p = object(value);
    vector(p.position, 3);
    const q = vector(p.orientation, 4);
    if (Math.abs(q.reduce((s, v) => s + v * v, 0) - 1) > 1e-4)
      throw new Error("Expected unit quaternion");
  } catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

/** The same semantic checks apply to inline and completed bulk models. */
export function validateManipulationModel(model: Record<string, unknown>): void {
  text(model.revision);
  text(model.root);
  if (model.visual_profile !== undefined) text(model.visual_profile);
  if (model.gripper_joints !== undefined) {
    for (const [name, raw] of Object.entries(
      object(model.gripper_joints),
    )) {
      text(name);
      const mapping = object(raw);
      finite(mapping.closed);
      finite(mapping.open);
    }
  }
  if (model.asset_url !== null && typeof model.asset_url !== "string")
    throw new Error("Invalid asset URL");
  if (
    !Array.isArray(model.links) ||
    !Array.isArray(model.joints) ||
    model.links.length > 256 ||
    model.joints.length > 256
  )
    throw new Error("Invalid visual model");
  const links = new Set<string>();
  for (const raw of model.links) {
    const link = object(raw),
      name = text(link.name);
    if (links.has(name)) throw new Error("Duplicate link");
    links.add(name);
    if (link.bounds != null) {
      const bounds = object(link.bounds);
      vector(bounds.center, 3);
      if (vector(bounds.size, 3).some((v) => v <= 0))
        throw new Error("Invalid bounds size");
    }
  }
  if (!links.has(String(model.root))) throw new Error("Unknown root link");
  const jointNames = new Set<string>(),
    children = new Set<string>();
  const mimics = new Map<string, string>();
  for (const raw of model.joints) {
    const joint = object(raw);
    text(joint.name);
    text(joint.parent);
    text(joint.child);
    if (
      jointNames.has(String(joint.name)) ||
      children.has(String(joint.child))
    )
      throw new Error("Duplicate joint or child link");
    jointNames.add(String(joint.name));
    children.add(String(joint.child));
    if (
      !["fixed", "revolute", "continuous", "prismatic"].includes(
        String(joint.kind),
      )
    )
      throw new Error("Unsupported visual joint");
    if (!links.has(String(joint.parent)) || !links.has(String(joint.child)))
      throw new Error("Unknown joint link");
    if (joint.limits != null) {
      const limit = object(joint.limits);
      if (finite(limit.lower) > finite(limit.upper))
        throw new Error("Invalid joint limits");
    }
    vector(joint.axis, 3);
    pose(joint.origin);
    if (joint.mimic != null) {
      const m = object(joint.mimic);
      text(m.joint);
      finite(m.multiplier);
      finite(m.offset);
      mimics.set(String(joint.name), String(m.joint));
    }
  }
  if (children.has(String(model.root))) throw new Error("Root link cannot have a parent");
  for (const [name, target] of mimics) {
    if (!jointNames.has(target)) throw new Error("Unknown mimic joint");
    const visited = new Set([name]);
    let current: string | undefined = target;
    while (current !== undefined) {
      if (visited.has(current)) throw new Error("Cyclic mimic joint");
      visited.add(current);
      current = mimics.get(current);
    }
  }
  if (model.gripper_joints !== undefined) {
    for (const name of Object.keys(object(model.gripper_joints))) {
      if (!jointNames.has(name)) throw new Error("Unknown gripper joint");
    }
  }
  linkPoses(
    model as unknown as ManipulationModel,
    Object.fromEntries([...jointNames].map((name) => [name, 0])),
  );
}
