import type { ManipulationPose, ManipulationGroup, ManipulationModel, ManipulationPlan, ManipulationState } from "./ManipulationTypes";
import { gripperJointValues, samplePlan, composePose, inversePose } from "./ModelKinematics";
import type { Vec3 } from "../ClientContracts";
import type { ClientNotification } from "../presentation/NotificationCenter";

export const MANIPULATION_PLAN_INTERVAL_S = 0.05;
export function poseChanged(
  a: ManipulationPose,
  b: ManipulationPose,
  distance = 0.01,
  angle = Math.PI / 60,
): boolean {
  const separation = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
  const turn =
    2 *
    Math.acos(
      Math.min(
        1,
        Math.abs(
          a.orientation.reduce((sum, v, i) => sum + v * b.orientation[i], 0),
        ),
      ),
    );
  return separation >= distance || turn >= angle;
}

/** Hysteresis is based on raw observed poses, never on presentation smoothing. */
export function targetIsOffset(
  target: ManipulationPose | null,
  measured: ManipulationPose | null | undefined,
  wasOffset = false,
): boolean {
  return (
    !!target &&
    !!measured &&
    poseChanged(
      target,
      measured,
      wasOffset ? 0.005 : 0.01,
      wasOffset ? Math.PI / 120 : Math.PI / 60,
    )
  );
}

export interface ManipulationRejection {
  revision: number;
  pose: ManipulationPose;
  message: string;
  failedJoints?: string[];
}

export interface ManipulationSnapshot {
  readonly blocked?: boolean;
  readonly targetOffset: boolean;
  readonly hasDraft: boolean;
  readonly sharedDraft?: boolean;
  readonly dragging: boolean;
  readonly finishing?: boolean;
  readonly planning: boolean;
  readonly executing: boolean;
  readonly resetting: boolean;
  readonly stopped: boolean;
  readonly fresh: boolean;
  readonly retainingFeedback?: boolean;
  readonly activity: string;
  readonly canPreview: boolean;
  readonly canExecute: boolean;
  readonly canReset: boolean;
  readonly canManipulate: boolean;
  readonly canStop: boolean;
  readonly canResume: boolean;
}

export interface ManipulationFacts {
  available: boolean;
  fresh: boolean;
  selected: boolean;
  targetOffset: boolean;
  gripperDraft: boolean;
  dragging: boolean;
  planning: boolean;
  executing: boolean;
  resetting: boolean;
  stopped: boolean;
  stopConfirmed: boolean;
  pendingControl: boolean;
  following: boolean;
  followingSettled?: boolean;
  rejection: boolean;
  status: string;
  runtimeMessage?: string | null;
  readOnly?: boolean;
  finishing?: boolean;
}

export function deriveManipulationSnapshot(
  facts: ManipulationFacts,
): ManipulationSnapshot {
  const canManipulate =
    facts.available &&
    !facts.readOnly &&
    facts.fresh &&
    !facts.stopped &&
    !facts.executing &&
    !facts.resetting &&
    !facts.pendingControl;
  const ready = canManipulate && !facts.planning && !facts.dragging;
  const hasDraft = facts.targetOffset || facts.gripperDraft;
  let activity = "Idle";
  if (facts.readOnly) activity = "Recording";
  else if (!facts.fresh) activity = "No feedback";
  else if (facts.stopped) activity = "Stopped";
  else if (facts.resetting) activity = "Resetting";
  else if (facts.executing) activity = "Moving";
  else if (facts.rejection) activity = shortManipulationStatus(facts.status);
  else if (facts.followingSettled) activity = "Idle";
  else if (facts.runtimeMessage)
    activity = shortManipulationStatus(facts.runtimeMessage);
  else if (facts.following && facts.targetOffset) activity = "Moving";
  else if (facts.selected && hasDraft) activity = "Planning";
  return Object.freeze({
    targetOffset: facts.targetOffset,
    hasDraft,
    dragging: facts.dragging,
    finishing: facts.finishing === true,
    planning: facts.planning,
    executing: facts.executing,
    resetting: facts.resetting,
    stopped: facts.stopped,
    fresh: facts.fresh,
    activity,
    canPreview: facts.selected && facts.targetOffset && ready,
    canExecute: facts.selected && hasDraft && ready,
    canReset: ready,
    canManipulate,
    canStop: !facts.readOnly && !facts.stopped,
    canResume: !facts.readOnly && facts.stopped && facts.fresh && facts.stopConfirmed,
  });
}

/** Short world labels; detailed runtime messages remain available in diagnostics. */
export function shortManipulationStatus(message: string): string {
  const s = message.toLowerCase();
  if (/target not reached/.test(s)) return "Target not reached";
  if (/joint.?limit/.test(s)) return "Joint limit";
  if (/ik|unreachable|infeasible|no.solution|converge/.test(s))
    return "IK failed";
  if (/uncertain|fault/.test(s)) return "Check arm";
  if (/stale|feedback/.test(s)) return "No feedback";
  if (/timeout|timed out/.test(s)) return "Timed out";
  if (/planning|planned|feasible/.test(s)) return "Planning";
  if (/execut|following/.test(s)) return "Moving";
  if (/reset|zero/.test(s)) return "Resetting";
  if (/stop|abort|cancel/.test(s)) return "Stopped";
  if (/gripper.*(skipped|fail|confirm)|fail.*gripper/.test(s)) return "Gripper failed";
  if (/fail|reject/.test(s)) return "Plan failed";
  return "Idle";
}

export class ManipulationPreviewPlayback {
  previewRequested = false;
  private previewId: string | null = null;
  private started = 0;
  private sampledAt: number | null = null;
  hold(now: number): void { if(this.sampledAt!==null) this.started+=now-this.sampledAt; this.sampledAt=now; }
  private pendingStart = false;
  togglePreview(): void { this.previewRequested = !this.previewRequested; this.pendingStart = this.previewRequested; }
  reset(): void { this.previewRequested = false; this.previewId = null; this.pendingStart = false; }
  sample(plan: ManipulationPlan | null, now: number): { playing: boolean; time: number } {
    if (plan?.plan_id !== this.previewId || this.pendingStart) {
      this.previewId = plan?.plan_id ?? null; this.started = now; this.pendingStart = false;
    }
    this.sampledAt = now;
    const time = Math.max(0, now - this.started);
    const playing = this.previewRequested && !!plan && time <= plan.duration;
    if (plan && time > plan.duration) this.previewRequested = false;
    return { playing, time: playing ? time : plan?.duration ?? 0 };
  }
}

export function manipulationMenuRows(): string[] {
  return ["reset", "speed", "stop", "estop"];
}
export function manipulationButtonEnabled(key: string, intent: ManipulationSnapshot): boolean {
  switch (key) {
    case "estop": return intent.canStop || intent.canResume;
    case "stop": return intent.canStop;
    case "reset": return intent.canReset;
    case "execute": return intent.canExecute;
    case "plan": return intent.canPreview;
    default: return intent.canManipulate;
  }
}


/** The near-EE button represents the current interaction mode on both hosts. */
export function endEffectorAction(intent: ManipulationSnapshot,
  opening: number | null | undefined, hasGripper: boolean) {
  return { action: "gripper" as const, label: opening == null ? "Gripper —" : opening < 0.5 ? "Open" : "Close",
    available: hasGripper, enabled: intent.canManipulate && opening != null, allowDuringGrab: true };
}

export function manipulationPathOpacity(intent: ManipulationSnapshot,
  following: boolean, hasPlan: boolean): number {
  return !intent.stopped && (following || intent.finishing || intent.executing) ? 1 : hasPlan ? 0.7 : 0.5;
}

/** A reviewed endpoint cannot replace live IK while a new drag is active. */
export function manipulationPreviewPlan(
  plan: ManipulationPlan | null,
  selected: boolean,
  dragging: boolean,
  rejected: boolean,
): ManipulationPlan | null {
  return selected && !dragging && !rejected ? plan : null;
}


export function manipulationObservedJoints(
  model: ManipulationModel, state: ManipulationState, group: ManipulationGroup | undefined,
): Record<string, number> {
  const observed = group ? state.observations?.[group.id] : null;
  return Object.assign({}, ...Object.values(state.observations ?? {}).map(row => row.joints ?? {}),
    gripperJointValues(model, group, observed?.gripper));
}

export function manipulationActivePlan(state: ManipulationState, draft: ManipulationPlan | null,
  executing: boolean): ManipulationPlan | null {
  return state.stopped ? null : (executing ? state.plan : draft) ?? null;
}

/** Both renderers articulate the same measured base, live IK, reviewed endpoint and gripper draft. */
export function manipulationProposedJoints(
  model: ManipulationModel, group: ManipulationGroup | undefined, measured: Record<string, number>,
  input: {
    plan: ManipulationPlan | null;
    playback: { playing: boolean; time: number };
    selected: boolean;
    dragging: boolean;
    rejected: boolean;
    solution: Record<string, number> | null;
    opening: number | null | undefined;
  },
): Record<string, number> {
  const { plan, playback } = input;
  const configuration = playback.playing && plan ? samplePlan(plan, playback.time)
    : manipulationPreviewPlan(plan, input.selected, input.dragging, input.rejected) && plan
      ? samplePlan(plan, plan.duration) : input.solution;
  return { ...measured, ...configuration, ...gripperJointValues(model, group, input.opening) };
}

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

/** Resolve the two rigid transforms once per link, rather than once per vertex. */
export function armPointDisplacement(measured: ManipulationPose, proposed: ManipulationPose): (x: number, y: number, z: number) => number {
  const coefficients = armTransformDifference(measured, proposed);
  const r = coefficients.slice(0, 9), p = coefficients.slice(9);
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

/** A retained target is displayed only while its interaction is active. */
export function endEffectorDisplayPose(
  measured: ManipulationPose | null | undefined,
  target: ManipulationPose | null | undefined,
  input: { selected: boolean; following: boolean; dragging: boolean; finishing: boolean; offset: boolean; sharedDraft?: boolean },
): ManipulationPose | null | undefined {
  const active = input.selected || input.following || input.dragging || input.finishing || input.sharedDraft;
  return active && (input.offset || input.dragging) && target ? target : measured;
}

/** Latest-state sampling only: missed opacity samples never accumulate. */
export class ArmOpacityCadence {
  private last: number | null = null;
  sample(now: number): number | null {
    if (this.last !== null && now >= this.last && now - this.last < 0.1 - 1e-9) return null;
    const elapsed = this.last === null || now < this.last ? 0.1 : now - this.last;
    this.last = now;
    return elapsed;
  }
}

/** Difference of rigid transforms in the caller's coordinate and unit convention. */
export function armTransformDifference(measured: ManipulationPose, proposed: ManipulationPose): number[] {
  const rotation = ([x,y,z,w]: readonly number[]) => [
    1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),
    2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),
    2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),
  ];
  const a = rotation(measured.orientation), b = rotation(proposed.orientation);
  return [...a.map((v, i) => v - b[i]), ...measured.position.map((v, i) => v - proposed.position[i])];
}

export const END_EFFECTOR_STATUS_STYLE = {
  widthM: 0.16, heightM: 0.052, rightM: 0.16, upM: 0.01,
  fadeInS: 0.12, fadeOutS: 0.18,
} as const;

export interface EndEffectorStatusInput {
  blocked: boolean;
  fresh: boolean;
  stopped: boolean;
  moving: boolean;
  rejection: { message: string } | null;
}

function notification(input: EndEffectorStatusInput): ClientNotification | null {
  if (!input.fresh) return { key: "feedback", text: "No feedback", tone: "warning", glyph: "warning" };
  if (input.stopped) return null;
  if (input.moving) return { key: "moving", text: "Executing", tone: "neutral", glyph: "busy" };
  if (input.blocked) return { key: "in-use", text: "Arm in use", tone: "neutral", glyph: "stop" };
  if (input.rejection) return { key: `ik:${input.rejection.message}`, text: input.rejection.message,
    tone: "warning", glyph: "warning" };
  return null;
}

/** Packet revisions do not restart persistent status or its outline animation. */
export class EndEffectorStatus {
  private current: ClientNotification | null = null;
  private startedAt = 0;
  private clearedAt: number | null = null;
  private fadeFrom = 0;

  sample(input: EndEffectorStatusInput, now: number) {
    const next = notification(input);
    if (next && (next.key !== this.current?.key || this.clearedAt !== null)) {
      this.current = next;
      this.startedAt = now;
      this.clearedAt = null;
    } else if (!next && this.current && this.clearedAt === null) {
      this.fadeFrom = Math.min(1, Math.max(0, (now - this.startedAt) / END_EFFECTOR_STATUS_STYLE.fadeInS));
      this.clearedAt = now;
    }
    const elapsedS = Math.max(0, now - this.startedAt);
    const opacity = this.clearedAt === null
      ? Math.min(1, elapsedS / END_EFFECTOR_STATUS_STYLE.fadeInS)
      : this.fadeFrom * Math.max(0, 1 - (now - this.clearedAt) / END_EFFECTOR_STATUS_STYLE.fadeOutS);
    if (this.clearedAt !== null && opacity === 0) this.current = null;
    return { notification: this.current, elapsedS, opacity, scale: 0.9 + 0.1 * opacity };
  }
}
