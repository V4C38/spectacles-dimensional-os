import type { Vec3 } from "../websocket/protocolTypes";
import type { ManipulationPose, ManipulationModel } from "./ManipulationTypes";
import { composePose, inversePose, toolSubtree } from "./ModelKinematics";

export const ARM_VISUAL_STYLE = {
  fill: 0.28, opacity: 1, widthM: 0.0006, dashM: 0.006, gapM: 0.009,
  minimumPixels: 0.9, errorWidthScale: 1.5, creaseDegrees: 30,
  color: 0xcbd9df, errorColor: 0xff453a, warningColor: 0xffcc00,
} as const;

export function armLinkWeight(current: ManipulationPose, proposed: ManipulationPose): number {
  const distance = Math.hypot(...current.position.map((v, i) => v - proposed.position[i]));
  const angle = 2 * Math.acos(Math.min(1, Math.abs(current.orientation.reduce((n, v, i) => n + v * proposed.orientation[i], 0))));
  const t = Math.max(0, Math.min(1, (Math.max(distance / 0.10, angle / (Math.PI / 6)) - 0.06) / 0.94));
  return t * t * (3 - 2 * t);
}

/** Feature edges weld positions, so duplicated normals/UV seams do not become wireframe. */
export function armShapeEdges(positions: readonly number[], indices: readonly number[]): Vec3[] {
  const edges = new Map<string, { a: Vec3; b: Vec3; normals: Vec3[] }>();
  const point = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const key = (p: Vec3) => p.map(v => Math.round(v * 1e6)).join(",");
  for (let i = 0; i < indices.length; i += 3) {
    const p = indices.slice(i, i + 3).map(point);
    const u = p[1].map((v, j) => v - p[0][j]), v = p[2].map((v, j) => v - p[0][j]);
    const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n); if (length < 1e-12) continue;
    const normal = n.map(v => v / length) as Vec3;
    for (let j = 0; j < 3; j++) {
      const a = p[j], b = p[(j + 1) % 3], ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}:${kb}` : `${kb}:${ka}`;
      const edge = edges.get(id);
      if (edge) edge.normals.push(normal); else edges.set(id, { a, b, normals: [normal] });
    }
  }
  const result: Vec3[] = [], threshold = Math.cos(ARM_VISUAL_STYLE.creaseDegrees * Math.PI / 180);
  for (const edge of edges.values()) {
    if (edge.normals.length === 1 || edge.normals.some(n => n.reduce((s, v, i) => s + v * edge.normals[0][i], 0) < threshold)) result.push(edge.a, edge.b);
  }
  return result;
}

export function gripperBounds(model: ManipulationModel, poses: Record<string, ManipulationPose>, tip: string) {
  const tool = toolSubtree(model, tip), inverse = inversePose(poses[tool.root]);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const link of model.links) {
    if (!tool.links.has(link.name) || !link.bounds) continue;
    const transform = composePose(inverse, poses[link.name]);
    for (let i = 0; i < 8; i++) {
      const local = link.bounds.center.map((v, axis) => v + ((i & (1 << axis)) ? 1 : -1) * link.bounds!.size[axis] / 2) as Vec3;
      const p = composePose(transform, { position: local, orientation: [0, 0, 0, 1] }).position;
      p.forEach((v, axis) => { min[axis] = Math.min(min[axis], v); max[axis] = Math.max(max[axis], v); });
    }
  }
  return { ...tool, center: min.map((v, i) => (v + max[i]) / 2) as Vec3, size: min.map((v, i) => max[i] - v) as Vec3 };
}

/** OpenYAM visual envelope in its URDF link frame; independent of planning collisions. */
export const OPENYAM_FOREARM_BOXES: readonly { center: Vec3; size: Vec3 }[] = [
  { center: [-0.0600003, -0.0344453, -0.1530005], size: [0.057, 0.06671, 0.240914] },
  { center: [-0.0298676, -0.034925, -0.0005235], size: [0.122666, 0.08985, 0.064041] },
];

/** Both hosts consume the same visibility, displacement and IK presentation policy. */
export function armLinkPresentation(input: {
  selected: boolean; hovered: boolean; dragging: boolean; finishing: boolean;
  displaced: boolean; playing: boolean; weight: number; failed: boolean; failedLink: boolean;
}) {
  const reveal = input.hovered && !input.dragging;
  const hoverBoost = input.hovered ? (input.selected ? 1.15 : input.dragging ? 1.05 : 1.10) : 1;
  // Selection reveals the complete planner mesh independently of hover or displacement.
  const weight = input.selected || input.playing || reveal ? 1 : input.weight;
  const alpha = input.failed ? Math.max(0.65, weight) : weight;
  return {
    alpha: alpha * hoverBoost * (input.selected ? 1.10 : 1),
    displacementBoost: input.selected ? 1 : 1.10,
    floor: input.selected || reveal || input.failed ? 0.25 * (!input.selected && reveal ? 1.05 / hoverBoost : 1) : 0,
    showFill: input.selected || ((!input.hovered || input.dragging || input.finishing || input.playing) && (input.displaced || input.playing || input.failed)),
    pointVisible: input.selected || reveal || input.displaced || input.playing || input.failed || input.dragging,
    visible: (input.selected || reveal || input.displaced || input.playing || input.failed) && alpha > 0.001,
    color: input.failed ? ARM_VISUAL_STYLE.warningColor : ARM_VISUAL_STYLE.color,
    widthM: ARM_VISUAL_STYLE.widthM * (input.failed ? ARM_VISUAL_STYLE.errorWidthScale : 1),
  };
}


/** Presentation-only opacity animation. Picking and robot selection remain independent. */
export class ArmMeshFade {
  private readonly values = new Map<string, number>();
  private previousTime: number | null = null;
  private context = "";
  private delta = 1 / 60;
  private gain = 1 - Math.exp(-1 / 60 / .08);
  beginFrame(now: number, context: string): void {
    if (context !== this.context) { this.reset(); this.context = context; }
    this.delta = this.previousTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, now - this.previousTime));
    this.previousTime = now;
    this.gain = 1 - Math.exp(-this.delta / .08);
  }
  sampleValue(previous: number, target: number): number {
    const next = previous + (target - previous) * this.gain;
    return Math.abs(next - target) < 0.0001 ? target : next;
  }
  sample(link: string, target: number): number {
    const value = this.sampleValue(this.values.get(link) ?? 0, target);
    this.values.set(link, value);
    return value;
  }
  reset(): void { this.values.clear(); this.previousTime = null; }
}

/** Surface-point displacement distinguishes the pivot from the end of a link. */
export function armPointWeight(point: Vec3, measured: ManipulationPose, proposed: ManipulationPose): number {
  const local = { position: point, orientation: [0, 0, 0, 1] as [number, number, number, number] };
  const a = composePose(measured, local).position, b = composePose(proposed, local).position;
  const t = Math.max(0, Math.min(1, (Math.hypot(...a.map((v, i) => v - b[i])) - 0.005) / 0.095));
  return t * t * (3 - 2 * t);
}

/** Resolve the two rigid transforms once per link, rather than once per vertex. */
export function armPointDisplacement(measured: ManipulationPose, proposed: ManipulationPose): (x: number, y: number, z: number) => number {
  const rotation = ([x,y,z,w]: readonly number[]) => [
    1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),
    2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),
    2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),
  ];
  const a = rotation(measured.orientation), b = rotation(proposed.orientation);
  const r = a.map((v,i) => v-b[i]), p = measured.position.map((v,i) => v-proposed.position[i]);
  if (r.every(v => Math.abs(v)<1e-12) && p.every(v => Math.abs(v)<1e-12)) return () => 0;
  return (x,y,z) => {
    const distance = Math.hypot(p[0]+r[0]*x+r[1]*y+r[2]*z,p[1]+r[3]*x+r[4]*y+r[5]*z,p[2]+r[6]*x+r[7]*y+r[8]*z);
    const t = Math.max(0,Math.min(1,(distance-.005)/.095));
    return t*t*(3-2*t);
  };
}

/** ROS roll/pitch/yaw relative to the robot base, in degrees. */
export function endEffectorAngles(base: ManipulationPose, ee: ManipulationPose): string {
  const [x,y,z,w] = composePose(inversePose(base), ee).orientation;
  const roll = Math.atan2(2*(w*x+y*z), 1-2*(x*x+y*y));
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2*(w*y-z*x))));
  const yaw = Math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z));
  return `R ${(roll*180/Math.PI).toFixed(1)}° P ${(pitch*180/Math.PI).toFixed(1)}° Y ${(yaw*180/Math.PI).toFixed(1)}°`;
}
