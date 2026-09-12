import type { ClientTrackingOrigin } from "../core/localization/clientTrackingOrigin";
import { odomToClientTrackingYawPose } from "../core/localization/clientTrackingTransforms";
import type { NavGoal } from "../core/websocket/protocolTypes";
import { clientTrackingToSpecsYawPose } from "../SpecsCoordinates";
import { LineRenderer } from "./LineRenderer";

export const CORNER_FILLET_MAX_CM = 10.0;
export const CORNER_FILLET_ANGLE_DEG = 40.0;
export const CORNER_FILLET_SEGMENTS = 2;

export function filletPathCorners(points: vec3[]): vec3[] {
  if (points.length < 3) {
    return points;
  }

  const filleted: vec3[] = [new vec3(points[0].x, points[0].y, points[0].z)];
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const turnAngle = cornerTurnAngleDeg(prev, corner, next);
    if (turnAngle < CORNER_FILLET_ANGLE_DEG) {
      filleted.push(new vec3(corner.x, corner.y, corner.z));
      continue;
    }

    const incomingLength = Math.sqrt(
      (corner.x - prev.x) * (corner.x - prev.x) +
        (corner.z - prev.z) * (corner.z - prev.z),
    );
    const outgoingLength = Math.sqrt(
      (next.x - corner.x) * (next.x - corner.x) +
        (next.z - corner.z) * (next.z - corner.z),
    );
    const filletDistance = Math.min(
      CORNER_FILLET_MAX_CM,
      incomingLength * 0.45,
      outgoingLength * 0.45,
    );
    if (filletDistance <= 0.5) {
      filleted.push(new vec3(corner.x, corner.y, corner.z));
      continue;
    }

    const incomingT = filletDistance / incomingLength;
    const outgoingT = filletDistance / outgoingLength;
    const incomingFillet = lerpPoint(corner, prev, incomingT);
    const outgoingFillet = lerpPoint(corner, next, outgoingT);
    filleted.push(incomingFillet);
    for (let segment = 1; segment <= CORNER_FILLET_SEGMENTS; segment++) {
      const t = segment / (CORNER_FILLET_SEGMENTS + 1);
      filleted.push(lerpPoint(incomingFillet, outgoingFillet, t));
    }
    filleted.push(outgoingFillet);
  }

  filleted.push(
    new vec3(
      points[points.length - 1].x,
      points[points.length - 1].y,
      points[points.length - 1].z,
    ),
  );
  return filleted;
}

export function rangePathY(
  points: vec3[],
  floorY: number | null,
  goalY: number | null,
): vec3[] {
  if (floorY === null || goalY === null || points.length === 0) {
    return points;
  }
  if (points.length === 1) {
    return [new vec3(points[0].x, floorY, points[0].z)];
  }
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1];
    const current = points[index];
    const dx = current.x - prev.x;
    const dy = current.y - prev.y;
    const dz = current.z - prev.z;
    distances.push(distances[index - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const total = distances[distances.length - 1];
  if (total <= 0.0001) {
    return points.map((point) => new vec3(point.x, floorY, point.z));
  }
  return points.map((point, index) => {
    const progress = distances[index] / total;
    return new vec3(point.x, floorY + (goalY - floorY) * progress, point.z);
  });
}

export class NavGoalPresenter {
  private readonly line: LineRenderer;

  constructor(parent: SceneObject) {
    if (!parent) {
      throw new Error("parent is required");
    }
    this.line = new LineRenderer({ parent, name: "NavGoalPath" });
    this.hide();
  }

  apply(input: {
    nav_goal: NavGoal | null;
    origin: ClientTrackingOrigin | null;
    pathVisible?: boolean;
    floorY?: number | null;
    goalY?: number | null;
  }): void {
    if (
      input.pathVisible === false ||
      !input.origin ||
      !input.nav_goal ||
      input.nav_goal.path_poses.length < 2
    ) {
      this.hide();
      return;
    }
    const points = input.nav_goal.path_poses.map((pose) => {
      const specs = clientTrackingToSpecsYawPose(odomToClientTrackingYawPose(pose, input.origin!));
      return new vec3(specs[0], specs[1], specs[2]);
    });
    this.line.setPoints(rangePathY(filletPathCorners(points), input.floorY ?? null, input.goalY ?? null));
  }

  hide(): void {
    this.line.clear();
  }

  destroy(): void {
    this.line.destroy();
  }
}

function normalizePlanar(vec: vec3): vec3 | null {
  const length = Math.sqrt(vec.x * vec.x + vec.z * vec.z);
  if (length <= 0.0001) {
    return null;
  }
  return new vec3(vec.x / length, 0, vec.z / length);
}

function cornerTurnAngleDeg(prev: vec3, corner: vec3, next: vec3): number {
  const incoming = normalizePlanar(new vec3(corner.x - prev.x, 0, corner.z - prev.z));
  const outgoing = normalizePlanar(new vec3(next.x - corner.x, 0, next.z - corner.z));
  if (!incoming || !outgoing) {
    return 0;
  }
  const dot = Math.max(-1, Math.min(1, incoming.x * outgoing.x + incoming.z * outgoing.z));
  return Math.acos(dot) * (180.0 / Math.PI);
}

function lerpPoint(a: vec3, b: vec3, t: number): vec3 {
  return new vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}
