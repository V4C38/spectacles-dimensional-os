import type { ReadonlyFacts, Vec3 } from "../ClientContracts";
import type { ManipulationModel, ManipulationPlan, ManipulationState, ManipulationGroup, ManipulationPose } from "./ManipulationTypes";
import type { ClientTrackingOrigin } from "../localization/ClientTracking";
import { jointDelta, linkPoses, manipulationPlanPath } from "./ModelKinematics";
import { manipulationObservedJoints, manipulationProposedJoints, manipulationActivePlan, endEffectorDisplayPose, manipulationPathOpacity, ManipulationPreviewPlayback, type ManipulationSnapshot, type ManipulationRejection, type EndEffectorStatusInput } from "./ManipulationPresentation";

/** Context changes describe a different coordinate system, never a new packet or UI mode. */
export function armMotionContext(revision: string, group: string | null, origin: ReadonlyFacts<ClientTrackingOrigin>): string {
  const sign = origin.orientation[3] < 0 ? -1 : 1;
  return JSON.stringify([revision, group, ...origin.position.map(v => Math.round(v * 1e6)),
    ...origin.orientation.map(v => Math.round(v * sign * 1e6))]);
}

/** Presentation-only Hermite interpolation. Raw feedback always controls motion/arrival. */
export class ArmJointFilter {
  constructor(private readonly defaultIntervalS = 1 / 30, private readonly maximumIntervalS = 0.15) {}
  private values: Record<string, number> = {};
  private from: Record<string, number> = {};
  private velocity: Record<string, number> = {};
  private fromVelocity: Record<string, number> = {};
  private goalVelocity: Record<string, number> = {};
  private goal: Record<string, number> = {};
  private raw: Record<string, number> = {};
  private key = "";
  private signature = "";
  private receivedAt: number | null = null;
  private duration = 1 / 30;
  private sampledAt: number | null = null;

  hold(now: number): void {
    if (this.receivedAt !== null && this.sampledAt !== null) this.receivedAt += now - this.sampledAt;
    this.sampledAt = now;
  }
  private playbackFrom: Record<string, number> | null = null;

  reset(): void {
    this.values = {}; this.from = {}; this.goal = {}; this.raw = {};
    this.velocity = {}; this.fromVelocity = {}; this.goalVelocity = {};
    this.signature = ""; this.receivedAt = null; this.playbackFrom = null; this.sampledAt = null;
  }

  sample(model: ReadonlyFacts<ManipulationModel>, target: Readonly<Record<string, number>>, key: string, now: number,
    initialIntervalS = this.defaultIntervalS, sampleId?: string | number,
    measuredVelocity?: Readonly<Record<string, number>>): Record<string, number> {
    this.playbackFrom = null;
    this.sampledAt = now;
    if (key !== this.key) { this.reset(); this.key = key; }
    const evaluate = () => {
      const elapsed = this.receivedAt === null ? this.duration : Math.max(0, now - this.receivedAt);
      const t = Math.min(1, elapsed / this.duration), h = this.duration;
      // Brake prediction to rest when packets stop, rather than cutting velocity
      // at every packet boundary. Total lead is bounded to 30 ms of velocity.
      const tail = Math.min(.03, Math.max(0, elapsed - h));
      for (const joint of model.joints) {
        const name = joint.name;
        if (this.goal[name] === undefined) continue;
        const p = this.from[name], q = this.goal[name];
        const v = this.fromVelocity[name] ?? 0, w = this.goalVelocity[name] ?? 0;
        this.values[name] = (2*t*t*t-3*t*t+1)*p + (t*t*t-2*t*t+t)*h*v
          + (-2*t*t*t+3*t*t)*q + (t*t*t-t*t)*h*w + w*tail*(1-tail/.03)**2;
        this.velocity[name] = t >= 1 ? w*(1-tail/.03)*(1-3*tail/.03)
          : ((6*t*t-6*t)*p+(-6*t*t+6*t)*q)/h+(3*t*t-4*t+1)*v+(3*t*t-2*t)*w;
        if (!measuredVelocity) {
          const bounded = q >= p ? Math.min(q, this.values[name]) : Math.max(q, this.values[name]);
          if (bounded !== this.values[name]) this.velocity[name] = 0;
          this.values[name] = bounded;
        }
        if (joint.limits && joint.kind !== "continuous") {
          const bounded = Math.max(joint.limits.lower, Math.min(joint.limits.upper, this.values[name]));
          if (bounded !== this.values[name]) this.velocity[name] = 0;
          this.values[name] = bounded;
        }
      }
    };
    evaluate();
    const signature = JSON.stringify([sampleId, target]);
    if (signature !== this.signature) {
      const first = this.receivedAt === null;
      const interval = first ? initialIntervalS : Math.max(.001, now - this.receivedAt!);
      this.duration = Math.max(.02, Math.min(this.maximumIntervalS, interval));
      this.receivedAt = now; this.signature = signature;
      for (const joint of model.joints) {
        const name = joint.name, value = target[name];
        if (!Number.isFinite(value)) continue;
        const previous = this.values[name] ?? value;
        const delta = jointDelta(this.raw[name] ?? value, value, joint.kind === "continuous");
        // Inferred tangents also keep advisory IK previews moving between solutions.
        // A sparse IK result supplies a new pose, not evidence of ongoing motion.
        // Infer a tangent only while samples arrive inside the presentation horizon.
        const speed = first ? 0 : measuredVelocity?.[name] ?? (interval <= .08 ? delta / interval : 0);
        const w = speed;
        this.fromVelocity[name] = first ? 0 : this.velocity[name] ?? 0;
        this.goalVelocity[name] = w;
        this.from[name] = first ? value : previous;
        this.goal[name] = previous + jointDelta(previous, value, joint.kind === "continuous")
          + (measuredVelocity ? w * Math.min(.015, this.duration / 2) : 0);
        this.raw[name] = value;
      }
      evaluate();
    }
    this.sampledAt = now;
    return {...this.values};
  }

  playback(model: ReadonlyFacts<ManipulationModel>, target: Readonly<Record<string, number>>, key: string, now: number, elapsed: number): Record<string, number> {
    if (key !== this.key) { this.reset(); this.key = key; }
    this.playbackFrom ??= {...this.values};
    const t = Math.max(0, Math.min(1, elapsed / .05));
    for (const joint of model.joints) {
      if (!Number.isFinite(target[joint.name])) continue;
      const from = this.playbackFrom[joint.name] ?? target[joint.name];
      this.values[joint.name] = from + jointDelta(from, target[joint.name], joint.kind === "continuous") * t;
    }
    this.from = {...this.values}; this.goal = {...this.values}; this.receivedAt = now;
    this.velocity = {}; this.goalVelocity = {}; this.fromVelocity = {};
    this.raw = {...target}; this.signature = "playback";
    this.sampledAt = now;
    return {...this.values};
  }
}

/** A monotonic local projection in joint space, so Cartesian crossings cannot skip ahead. */
export class ArmTrajectoryProgress {
  private key = "";
  private segment = 0;
  private fraction = 0;
  private elapsed = 0;
  get time(): number { return this.elapsed; }

  reset(): void {
    this.key = "";
    this.segment = this.fraction = this.elapsed = 0;
  }

  /** Identity changes retire progress even when no fresh measurement is available. */
  beginTrajectory(plan: ReadonlyFacts<ManipulationPlan>, operation: string): void {
    const key = `${operation}:${plan.plan_id}`;
    if (key !== this.key) {
      this.reset();
      this.key = key;
    }
  }

  advance(
    plan: ReadonlyFacts<ManipulationPlan>,
    measured: Readonly<Record<string, number>>,
    continuous: ReadonlySet<string>,
    operation: string,
  ): number {
    this.beginTrajectory(plan, operation);
    if (!plan.joint_names.every((name) => Number.isFinite(measured[name])))
      return this.elapsed;
    let best = Infinity;
    for (let i = this.segment; i < plan.trajectory.length - 1; i++) {
      const a = plan.trajectory[i],
        b = plan.trajectory[i + 1];
      const direction = plan.joint_names.map((name, j) =>
        jointDelta(a.positions[j], b.positions[j], continuous.has(name)),
      );
      const offset = plan.joint_names.map((name, j) =>
        jointDelta(a.positions[j], measured[name], continuous.has(name)),
      );
      const length = direction.reduce((sum, value) => sum + value * value, 0);
      // A stationary segment cannot establish progress from feedback.
      if (length < 1e-12) continue;
      const projection =
        offset.reduce((sum, value, j) => sum + value * direction[j], 0) /
        length;
      const fraction = Math.max(
        i === this.segment ? this.fraction : 0,
        Math.min(1, projection),
      );
      const error = offset.reduce(
        (sum, value, j) => sum + (value - fraction * direction[j]) ** 2,
        0,
      );
      if (error > best + 1e-8) break;
      if (error < best - 1e-10) {
        best = error;
        this.segment = i;
        this.fraction = fraction;
        this.elapsed = Math.max(this.elapsed, a.time + fraction * (b.time - a.time));
      }
    }
    return this.elapsed;
  }
}

/** Pose sampling only; host geometry, opacity and playback ownership remain separate. */
export class ArmPresentationSampler {
  private readonly measuredFilter = new ArmJointFilter();
  private readonly proposedFilter = new ArmJointFilter(0.15, 0.25);
  private context = "";
  private previousSolution: object | null = null;
  private solutionSequence = 0;

  reset(): void { this.measuredFilter.reset(); this.proposedFilter.reset(); this.context = ""; }
  hold(now: number): void { this.measuredFilter.hold(now); this.proposedFilter.hold(now); }

  sample(input: {
    model: ReadonlyFacts<ManipulationModel>; state: ReadonlyFacts<ManipulationState>; group: ReadonlyFacts<ManipulationGroup> | undefined;
    origin: ReadonlyFacts<ClientTrackingOrigin>; now: number; selected: boolean; dragging: boolean;
    rejected: boolean; solution: Readonly<Record<string, number>> | null; opening: number | null | undefined;
    plan: ReadonlyFacts<ManipulationPlan> | null; playback: { playing: boolean; time: number };
  }) {
    const { model, state, group, origin, now, selected, solution, plan, playback } = input;
    const context = armMotionContext(model.revision, group?.id ?? null, origin);
    const contextChanged = context !== this.context;
    if (contextChanged) { this.reset(); this.context = context; }
    const observed = group ? state.observations?.[group.id] : undefined;
    const observedValues = manipulationObservedJoints(model, state, group);
    const filtered = this.measuredFilter.sample(model, observedValues, context, now, .1,
      observed?.measured_at ?? undefined, observed?.joint_velocities);
    const values = manipulationProposedJoints(model, group, observedValues, input);
    if (solution !== this.previousSolution) { this.previousSolution = solution; this.solutionSequence++; }
    const source = selected ? `${plan?.plan_id ?? this.solutionSequence}` : `${this.solutionSequence}`;
    const proposed = playback.playing
      ? this.proposedFilter.playback(model, values, context, now, playback.time)
      : this.proposedFilter.sample(model, values, context, now, .1, source);
    return { observedValues, measured: linkPoses(model, filtered), proposed: linkPoses(model, proposed), contextChanged };
  }
}

export interface ArmPathInput {
  model: ReadonlyFacts<ManipulationModel>;
  plan: ReadonlyFacts<ManipulationPlan> | null;
  group: ReadonlyFacts<ManipulationGroup> | undefined;
  root: ReadonlyFacts<ManipulationPose>;
  observedValues: Readonly<Record<string, number>>;
  observedJoints: Readonly<Record<string, number>> | null | undefined;
  fresh: boolean;
  executing: boolean;
  displaced: boolean;
  playing: boolean;
  target: ReadonlyFacts<ManipulationPose> | null;
  observedPose: ReadonlyFacts<ManipulationPose> | null | undefined;
  operationId?: string | null;
}
export interface ArmPathFrame {
  readonly points: readonly Readonly<Vec3>[];
  readonly revision: number;
  readonly visible: boolean;
  readonly startDistanceM: number;
}

/** One odom-space trajectory cache and feedback projection shared by both renderers. */
export class ArmPathPresentation {
  private readonly progress = new ArmTrajectoryProgress();
  private key = "";
  private points: readonly Readonly<Vec3>[] = [];
  private distances: number[] = [];
  private revision = 0;

  reset(): void {
    this.progress.reset();
    this.key = "";
    this.points = [];
    this.distances = [];
    this.revision++;
  }
  sample(input: ArmPathInput): ArmPathFrame {
    const { model, plan, group, root } = input;
    if (!plan || !input.executing) this.progress.reset();
    let time = 0;
    if (plan && input.executing) {
      this.progress.beginTrajectory(plan, input.operationId ?? plan.plan_id);
      time = input.fresh && input.observedJoints
        ? this.progress.advance(plan, input.observedJoints,
          new Set(model.joints.filter(joint => joint.kind === "continuous").map(joint => joint.name)),
          input.operationId ?? plan.plan_id)
        : this.progress.time;
    }
    const hasTrajectory = !!plan && !!group?.tip_frame;
    const key = hasTrajectory
      ? JSON.stringify([plan.plan_id, model.revision, group.tip_frame, root])
      : JSON.stringify([input.displaced ? input.observedPose?.position : null,
        input.displaced ? input.target?.position : null]);
    if (key !== this.key) {
      this.key = key;
      if (hasTrajectory) this.points = manipulationPlanPath(model, plan, group.tip_frame, input.observedValues, root);
      else if (input.displaced && input.target && input.observedPose) {
        this.points = [[...input.observedPose.position], [...input.target.position]];
      } else this.points = [];
      this.distances = this.points.length ? [0] : [];
      for (let i = 1; i < this.points.length; i++) {
        const a = this.points[i - 1], b = this.points[i];
        this.distances.push(this.distances[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      this.revision++;
    }
    let startDistanceM = 0;
    if (plan && this.distances.length) {
      const cursor = Math.max(0, Math.min(this.distances.length - 1,
        time / Math.max(1e-6, plan.duration) * (this.distances.length - 1)));
      const lower = Math.floor(cursor), upper = Math.min(this.distances.length - 1, lower + 1);
      startDistanceM = this.distances[lower] + (this.distances[upper] - this.distances[lower]) * (cursor - lower);
    }
    return { points: this.points, revision: this.revision,
      visible: this.points.length >= 2 && (input.displaced || hasTrajectory && (input.playing || input.executing)),
      startDistanceM };
  }
}

export interface ManipulationFrameInput {
  model: ReadonlyFacts<ManipulationModel>;
  state: ReadonlyFacts<ManipulationState>;
  groupId: string | null;
  origin: ReadonlyFacts<ClientTrackingOrigin>;
  now: number;
  selected: boolean;
  intent: ManipulationSnapshot;
  target: ReadonlyFacts<ManipulationPose> | null;
  solution: Readonly<Record<string, number>> | null;
  plan: ReadonlyFacts<ManipulationPlan> | null;
  desiredGripper: number | null;
  rejection: ReadonlyFacts<ManipulationRejection> | null;
}

/** Orchestrates shared arm presentation; renderers convert poses and upload SDK resources. */
export class ManipulationFramePresenter {
  private readonly sampler = new ArmPresentationSampler();
  private readonly path = new ArmPathPresentation();
  private selectedBefore = false;
  constructor(readonly preview = new ManipulationPreviewPlayback()) {}

  hold(now: number): void { this.preview.hold(now); this.sampler.hold(now); }
  reset(): void {
    this.preview.reset();
    this.sampler.reset();
    this.path.reset();
    this.selectedBefore = false;
  }
  sample(input: ManipulationFrameInput) {
    const { model, state, origin, now, selected, intent } = input;
    const recorded = state.read_only === true;
    const group = state.groups?.find(candidate => candidate.id === input.groupId);
    const observed = group ? state.observations?.[group.id] : undefined;
    const root: ReadonlyFacts<ManipulationPose> = state.root_pose ?? {
      position: [0, 0, 0], orientation: [0, 0, 0, 1],
    };
    const activePlan = recorded ? null : manipulationActivePlan(state, input.plan, intent.executing);
    if (selected !== this.selectedBefore || intent.dragging || state.stopped || (!activePlan && !intent.planning)) {
      this.preview.setRequested(false);
    }
    this.selectedBefore = selected;
    const playback = this.preview.sample(activePlan, now);
    const sampled = this.sampler.sample({ model, state, group, origin, now, selected,
      dragging: intent.dragging, rejected: !!input.rejection, solution: recorded ? null : input.solution,
      opening: selected ? input.desiredGripper : observed?.gripper ?? null, plan: activePlan, playback });
    if (sampled.contextChanged) this.path.reset();
    const targetVisible = !recorded && !!input.target &&
      (selected || state.following === true || intent.dragging || intent.finishing === true || intent.sharedDraft === true);
    const displaced = targetVisible && intent.targetOffset;
    const path = this.path.sample({ model, plan: activePlan, group, root, observedValues: sampled.observedValues,
      observedJoints: observed?.joints, fresh: intent.fresh, executing: intent.executing, displaced,
      playing: playback.playing, target: input.target, observedPose: observed?.pose, operationId: state.operation_id });
    const endEffectorPose = endEffectorDisplayPose(observed?.pose, recorded ? null : input.target, {
      selected, following: state.following === true, dragging: intent.dragging,
      finishing: intent.finishing === true, offset: intent.targetOffset, sharedDraft: intent.sharedDraft,
    });
    const status: EndEffectorStatusInput = { blocked: intent.blocked === true, fresh: intent.fresh,
      stopped: intent.stopped, moving: intent.executing || intent.resetting, rejection: input.rejection };
    return { group, observed, root, activePlan, targetVisible, displaced, playback, ...sampled, path,
      pathOpacity: manipulationPathOpacity(intent, !selected && state.following === true && !input.rejection, !!activePlan),
      endEffectorPose, status };
  }
}
