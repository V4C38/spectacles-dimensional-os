import type { ARModuleSession } from "../websocket/arModuleSession";
import type {
  ManipulationAction,
  ManipulationPlan,
  ManipulationPose,
  ManipulationResult,
} from "./ManipulationTypes";
import { encodeManipulation } from "./ManipulationProtocol";

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

export interface ManipulationSnapshot {
  readonly blocked?: boolean;
  readonly targetOffset: boolean;
  readonly hasDraft: boolean;
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
  if (!facts.fresh) activity = "No feedback";
  else if (facts.readOnly) activity = "Recording";
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

/** Portable intent and correlation. Observed execution remains in ARModuleSession. */
export class ManipulationInteraction {
  private lastSourceTs: number | null = null;
  private lastSourceAt = 0;
  private lostAt: number | null = null;
  private feedbackHeld = false;
  get retainingFeedback(): boolean {
    return !this.feedbackFresh && this.lastSourceTs !== null && this.now() - (this.lostAt ?? this.lastSourceAt) <= 1;
  }
  private updateFeedback(): void {
    const view = this.session.view(), now = this.now();
    const state = view.manipulation;
    if (view.connection === "ready" && state && state.available !== false && this.feedbackFresh) {
      const ts = state.observations?.[this.groupId ?? ""]?.measured_at ?? null;
      if (ts !== this.lastSourceTs) { this.lastSourceTs = ts; this.lastSourceAt = now; }
      this.lostAt = null; return;
    }
    if (this.lastSourceTs === null) return;
    this.lostAt ??= view.connection !== "ready" || state?.available === false ? now : this.lastSourceAt;
  }
  private sequence = 0;
  private generation = 0;
  private episode = 0;
  private planGeneration = -1;
  private executedGeneration: number | null = null;
  private executedOperation: string | null = null;
  private executionLatch: { at: number; operation: string | null } | null =
    null;
  private lastFollowResult = -1;
  private followRequestFloor = 0;
  private pending = new Map<
    string,
    {
      action: ManipulationAction;
      order: number;
      generation: number;
      episode: number;
      epoch: string | null;
      lease: string | null;
      group: string;
      pose: ManipulationPose | null;
      speed: number;
      gripper: number | null;
      startedAt: number;
      deadline: number;
    }
  >();
  private retiredAcquisitions = new Map<string, string>();
  private unsubscribe: () => void;
  private token: string | null = null;
  private tokenSequence = 0;
  private lastUpdate = -Infinity;
  private lastEvaluation = -Infinity;
  private readonly advisoryTiming = { requests: 0, completions: 0, failures: 0, timeouts: 0, maximumDurationS: 0 };
  diagnostics() {
    let pendingAgeS = 0;
    for (const request of this.pending.values()) if (request.action === "evaluate")
      pendingAgeS = Math.max(pendingAgeS, this.now() - request.startedAt);
    return { ...this.advisoryTiming, pendingAgeS };
  }
  private evaluatedGeneration = -1;
  private planQueued = false;
  private offset = false;
  private stoppedBefore = false;
  private modelRevision: string | null = null;
  private sharedSpeedRevision: number | null = null;
  private discardedSharedRevision: number | null = null;
  private tailGeneration: number | null = null;
  private executeAfterPlan = false;
  private selected = false;
  private gesture: "planning" | "following" | null = null;
  groupId: string | null = null;
  target: ManipulationPose | null = null;
  solution: Record<string, number> | null = null;
  plan: ManipulationPlan | null = null;
  previewPlan: ManipulationPlan | null = null;
  status = "";
  speedScale = 0.5;
  desiredGripper: number | null = null;
  rejection: {
    revision: number;
    pose: ManipulationPose;
    message: string;
    failedJoints?: string[];
  } | null = null;
  private rejectionRevision = 0;
  private valid: { requested: ManipulationPose; pose: ManipulationPose; joints: Record<string, number>; validatedJoints: Record<string, number>; order: number } | null = null;
  private plannedGeneration = -1;
  private plannedJoints: Record<string, number> | null = null;
  private finishingAt: number | null = null;
  private arrivedAt: number | null = null;
  private followSamples = new Map<number, { id: string; pose: ManipulationPose }>();
  private releasedFollow: { token: string; episode: number; pose: ManipulationPose; epoch: string | null; lease: string | null;
    canonical: { pose: ManipulationPose; revision: number; sequence: number } | null; finalSequence: number | null } | null = null;
  private reconcilingTarget = false;
  private get lastValidTarget(): ManipulationPose | null { return this.valid?.pose ?? null; }
  private set lastValidTarget(pose: ManipulationPose | null) {
    if (!pose) this.valid = null;
    else this.rememberValid(pose, this.solution ?? this.observedJoints(), this.sequence);
  }
  get previewJoints(): Record<string, number> | null { return this.selected && !this.dragging && this.rejection && this.plannedJoints ? this.plannedJoints : this.valid?.joints ?? this.solution; }
  private observedJoints(): Record<string, number> {
    return Object.assign({}, ...Object.values(this.session.view().manipulation?.observations ?? {}).map(o => o.joints ?? {}));
  }
  private rememberValid(pose: ManipulationPose, joints: Record<string, number>, order: number, requested = pose): void {
    if (this.valid && order < this.valid.order) return;
    const values = { ...this.observedJoints(), ...joints };
    const endpoint = Object.freeze({ position: Object.freeze([...pose.position]),
      orientation: Object.freeze([...pose.orientation]) }) as unknown as ManipulationPose;
    this.valid = Object.freeze({ requested: { position: [...requested.position], orientation: [...requested.orientation] } as ManipulationPose,
      pose: endpoint, joints: Object.freeze(values), validatedJoints: Object.freeze({ ...joints }), order });
  }
  private get feedbackAvailable(): boolean { return this.session.view().manipulation?.available !== false; }

  private get followingAtTarget(): boolean {
    const state = this.session.view().manipulation;
    return state?.following === true && state.following_at_target === true && !!this.target && !!state.following_goal && this.feedbackFresh &&
      !poseChanged(this.target, state.following_goal, 0.001, Math.PI / 180);
  }

  /** Compare raw feedback to a backend-validated endpoint, never visual FK/filtering. */
  private reachedValidatedGoal(): boolean {
    if (this.followingAtTarget) return true;
    const state = this.session.view().manipulation, valid = this.valid;
    if (!this.target || !valid || !this.feedbackFresh || !this.feedbackAvailable) return false;
    const matches = (pose: ManipulationPose) => !poseChanged(this.target!, pose, 0.001, Math.PI / 180);
    if (!matches(valid.requested) && !matches(valid.pose)) return false;
    const observed = state?.observations?.[this.groupId ?? ""];
    if (observed?.pose && !poseChanged(valid.pose, observed.pose, 0.01, Math.PI / 60)) return true;
    const names = state?.groups?.find(g => g.id === this.groupId)?.joint_names ?? [];
    return names.length > 0 && names.every(name => {
      const current = observed?.joints?.[name], expected = valid.validatedJoints[name];
      if (current == null || !Number.isFinite(expected)) return false;
      const joint = state?.model?.joints.find(j => j.name === name);
      const delta = joint?.kind === "continuous"
        ? Math.atan2(Math.sin(current - expected), Math.cos(current - expected)) : current - expected;
      return Math.abs(delta) <= (joint?.kind === "prismatic" ? 0.002 : 0.02);
    });
  }

  private retireCompletedDraft(): void {
    this.episode++; this.generation++;
    this.target = null; this.valid = null; this.solution = null;
    this.plan = this.previewPlan = null;
    this.desiredGripper = null; this.rejection = null; this.rejectedTarget = null;
    this.planQueued = false; this.executeAfterPlan = false; this.offset = false; this.status = "";
  }

  readonly captureEvents: { reason: string; at: number; episode: number; sequence: number; status: string }[] = [];
  private traceCaptureEnd(reason: string): void {
    if (!this.dragging && this.finishingAt === null && !this.token) return;
    this.captureEvents.push({ reason, at: this.now(), episode: this.episode, sequence: this.tokenSequence, status: this.status });
    if (this.captureEvents.length > 32) this.captureEvents.shift();
  }
  interrupt(reason = "host interruption"): void { this.end(false, reason); }

  private releasedGeneration: number | null = null;
  private rejectedTarget: ManipulationPose | null = null;
  private deferredNative: { action: ManipulationAction; payload: Parameters<typeof encodeManipulation>[3] } | null = null;
  private transientAuthority = false;
  private recoveringAuthority = false;
  private lastDenial = 0;
  private hasPending(...actions: ManipulationAction[]): boolean {
    return !!this.deferredNative && actions.includes(this.deferredNative.action) || [...this.pending.values()].some((p) => actions.includes(p.action));
  }
  snapshot(): ManipulationSnapshot {
    const state = this.session.view().manipulation;
    const offset = !this.followingAtTarget && targetIsOffset(
      this.target,
      state?.observations?.[this.groupId ?? ""]?.pose,
      this.offset,
    );
    const planning = this.planQueued || this.hasPending("evaluate", "plan");
    const executing =
      this.executionLatch !== null ||
      this.hasPending("execute") ||
      !this.finishing && ["accepted", "executing"].includes(state?.execution ?? "");
    const resetting =
      !!state?.operation ||
      this.hasPending("reset_joints");
    const stopped = state?.stopped === true;
    const fresh = this.feedbackFresh;
    const observedGripper = state?.observations?.[this.groupId ?? ""]?.gripper;
    const gripperDraft =
      this.desiredGripper != null && Math.abs(this.desiredGripper - (state?.observations?.[this.groupId ?? ""]?.gripper_target ?? observedGripper ?? -1)) > .02;
    const blocked = this.session.collaboration?.snapshot("manipulation", this.groupId ?? undefined).blocked ?? false;
    return Object.freeze({ blocked, ...deriveManipulationSnapshot({
      readOnly: state?.read_only === true,
      available: this.available && this.feedbackAvailable && !blocked,
      fresh,
      selected: this.selected,
      targetOffset: offset,
      gripperDraft,
      dragging: this.dragging,
      finishing: this.finishing,
      planning,
      executing,
      resetting,
      stopped,
      stopConfirmed: state?.stop_confirmed === true && state?.protection?.state !== "fault" && (state?.protection?.state !== "paused" || state.protection.resumable === true),
      pendingControl: this.hasPending("cancel", "resume", "gripper"),
      following: this.following,
      followingSettled: this.followingAtTarget,
      rejection: this.rejection !== null,
      status: this.status,
      runtimeMessage: state?.message,
    }), retainingFeedback: this.retainingFeedback});
  }
  private updateOffset(): void {
    this.offset = targetIsOffset(
      this.target,
      this.session.view().manipulation?.observations?.[this.groupId ?? ""]
        ?.pose,
      this.offset,
    );
  }
  setSpeedScale(value: number): void {
    if (
      this.snapshot().blocked ||
      !Number.isFinite(value) ||
      this.snapshot().executing ||
      this.snapshot().resetting
    )
      return;
    const next = Math.max(0.05, Math.min(1, value));
    if (next === this.speedScale) return;
    this.speedScale = next;
    if (this.target) this.publishSettings();
    this.generation++;
    this.plan = null;
    this.planGeneration = -1;
    this.planQueued = this.selected && !this.dragging && this.target !== null;
    this.executeAfterPlan = false;
  }
  resetJoints(): void {
    if (!this.snapshot().canReset) return;
    this.discard("reset requested");
    this.status = "Returning to zero";
    this.send("reset_joints", { speed_scale: this.speedScale });
  }

  constructor(
    private readonly session: Pick<
      ARModuleSession,
      "view" | "sendText" | "subscribeOutbound"
    > & Partial<Pick<ARModuleSession, "collaboration" | "assetTransferDeadline">>,
    private readonly now: () => number,
  ) {
    this.unsubscribe = session.subscribeOutbound((message) => {
      if (message.type === "manipulation_result") this.accept(message);
    });
  }

  get dragging(): boolean {
    return this.gesture !== null;
  }
  get following(): boolean {
    return this.gesture === "following" || this.finishing;
  }
  get finishing(): boolean {
    const tail = this.session.view().manipulation?.following_tail;
    return this.finishingAt !== null || tail?.status === "finishing" && tail.group_id === this.groupId;
  }
  get busy(): boolean {
    return this.hasPending("plan", "execute", "reset_joints");
  }
  get feedbackFresh(): boolean {
    const view = this.session.view(),
      sync = view.hello?.time_sync;
    if (view.connection !== "ready" || view.manipulationError || view.manipulation?.available === false) return false;
    const observed = view.manipulation?.observations?.[this.groupId ?? ""];
    if (!observed?.joints || observed.measured_at == null) return false;
    const age =
      this.now() +
      (sync ? sync.ts_server - sync.ts_client : 0) -
      observed.measured_at;
    const group = view.manipulation?.groups?.find((g) => g.id === this.groupId);
    return (
      age >= -0.1 &&
      age <= 0.5 &&
      !!group?.joint_names.every((name) =>
        Number.isFinite(observed.joints![name]),
      )
    );
  }
  get available(): boolean {
    return this.session.view().capabilities?.manipulation?.available === true || this.retainingFeedback;
  }

  setSelected(selected: boolean): void {
    if (selected !== this.selected) {
      this.interrupt();
      this.episode++;
      this.generation++;
      this.executeAfterPlan = false;
      this.planQueued = false;
      this.plan = this.previewPlan = null;
      this.solution = null;
      this.plannedJoints = null;
      this.target = null;
      this.lastValidTarget = null;
      this.desiredGripper = null;
      this.rejection = null;
      this.rejectedTarget = null;
      this.offset = false;
    }
    this.selected = selected;
  }

  selectGroup(group: string): void {
    if (this.groupId === group) return;
    this.cancel();
    this.groupId = group;
    this.sharedSpeedRevision = null;
    this.discardedSharedRevision = null;
    this.target = null;
    this.lastValidTarget = null;
    this.solution = null;
  }

  begin(): boolean {
    if (this.reconcilingTarget) {
      this.session.collaboration?.cancel(["manipulation_planning"]);
      this.reconcilingTarget = false;
    }
    if (
      !this.available ||
      !this.feedbackAvailable ||
      !this.feedbackFresh ||
      !this.groupId ||
      this.gesture ||
      this.snapshot().stopped ||
      this.snapshot().executing ||
      this.snapshot().resetting ||
      this.hasPending("cancel", "resume") ||
      (!this.selected && this.hasPending("plan"))
    )
      return false;
    if (this.session.collaboration && !this.ensureAuthority(this.selected ? "manipulation_planning" : "manipulation_following")) return false;
    this.discardedSharedRevision = null;
    this.releasedFollow = null;
    this.transientAuthority = false;
    if (!this.token) this.episode++;
    this.lastValidTarget ??= this.session.view().manipulation?.observations?.[this.groupId]?.pose ?? null;
    this.releasedGeneration = null;
    this.planQueued = false;
    this.generation++;
    this.plan = null;
    this.planGeneration = -1;
    if (this.deferredNative?.action === "plan") this.deferredNative = null;
    this.gesture = this.selected ? "planning" : "following";
    if (this.gesture === "following") {
      const group = this.session
        .view()
        .manipulation?.groups?.find((g) => g.id === this.groupId);
      if (!group?.following) {
        this.gesture = null;
        this.status = "Following unavailable";
        return false;
      }
      this.plan = null;
      this.finishingAt = this.arrivedAt = null;
      if (!this.token) this.send("acquire");
    }
    return true;
  }

  aim(pose: ManipulationPose): void {
    if (!this.gesture) return;
    if (
      this.target &&
      Math.hypot(...pose.position.map((v, i) => v - this.target!.position[i])) <
        0.0005 &&
      Math.abs(
        pose.orientation.reduce(
          (s, v, i) => s + v * this.target!.orientation[i],
          0,
        ),
      ) > 0.999999
    )
      return;
    if (
      this.rejectedTarget &&
      pose.position.every(
        (v, i) => Math.abs(v - this.rejectedTarget!.position[i]) < 0.005,
      ) &&
      pose.orientation.every(
        (v, i) => Math.abs(v - this.rejectedTarget!.orientation[i]) < 0.01,
      )
    )
      return;
    this.rejectedTarget = null;
    this.target = {
      position: [...pose.position],
      orientation: [...pose.orientation],
    };
    this.session.collaboration?.update(this.target, this.sharedSettings());
    this.updateOffset();
    if (this.gesture === "planning") {
      this.generation++;
      this.plan = null;
      this.executeAfterPlan = false;
      if (
        !targetIsOffset(
          this.target,
          this.session.view().manipulation?.observations?.[this.groupId ?? ""]
            ?.pose,
          this.offset,
        )
      ) {
        this.status = "";
      }
    }
  }

  tick(): void {
    const now = this.now(),
      view = this.session.view();
    this.updateFeedback();
    if (this.retainingFeedback) {
      if (view.connection !== "ready" && this.gesture) this.recoveringAuthority = true;
      this.status = "No feedback";
      if (!this.feedbackHeld) {
        this.feedbackHeld = true;
        for (const [id, request] of this.pending) if (request.action === "acquire") this.retiredAcquisitions.set(id, request.group);
        if (this.token && view.connection === "ready") this.send("release", { token: this.token });
        if (view.connection === "ready" || !view.hello?.resume_token) this.token = null;
        this.followSamples.clear();
        this.episode++;
        for (const [id, request] of this.pending) if (request.action !== "release") this.pending.delete(id);
      }
      return;
    }
    const recovered = this.feedbackHeld && this.feedbackFresh;
    if (recovered) {
      this.feedbackHeld = false;
      this.generation++;
      this.plan = null;
      this.planGeneration = this.evaluatedGeneration = -1;
      this.executeAfterPlan = false;
      this.planQueued = this.selected && !this.dragging && this.target !== null;
      this.status = "";
    }
    if (view.connection !== "ready") {
      this.reset();
      return;
    }
    const revision = view.manipulation?.available === false ? this.modelRevision : view.manipulation?.model?.revision ?? null;
    if (revision !== this.modelRevision) {
      if (this.modelRevision !== null) this.cancel();
      this.modelRevision = revision;
    }
    const collaboration = this.session.collaboration;
    if (collaboration && this.groupId) {
      if (this.recoveringAuthority && this.gesture && !view.manipulation?.stopped && !collaboration.snapshot("manipulation", this.groupId).blocked) {
        this.ensureAuthority(this.gesture === "following" ? "manipulation_following" : "manipulation_planning");
      }
      const shared = collaboration.snapshot("manipulation", this.groupId);
      if (!shared.pending && !shared.ownsAuthority) this.reconcilingTarget = false;
      if (shared.ownsAuthority) this.recoveringAuthority = false;
      if (this.lastDenial !== collaboration.denialRevision || shared.blocked || this.gesture !== null && !shared.ownsAuthority && !shared.pending && !this.recoveringAuthority) {
        this.gesture = null; this.token = null; this.deferredNative = null;
        this.planQueued = false; this.executeAfterPlan = false;
      }
      this.lastDenial = collaboration.denialRevision;
      if (this.transientAuthority && this.deferredNative &&
          ["plan", "execute", "evaluate"].includes(this.deferredNative.action) &&
          shared.ownsAuthority && shared.rawTarget && !shared.settling) {
        // Preview/Execute operate on the exact checked target, never on the
        // observer's interpolated presentation pose.
        this.target = {
          position: [...shared.rawTarget.position],
          orientation: [...shared.rawTarget.orientation],
        };
      }
      if (!this.gesture && !shared.ownsAuthority && !shared.pending &&
          shared.rawTarget?.revision !== this.discardedSharedRevision) {
        const tail = view.manipulation?.following_tail;
        if (shared.target === null) this.target = null;
        else if (!this.target || poseChanged(this.target, shared.target, 1e-8, 1e-8)) this.target = shared.target;
        if (tail?.group_id === this.groupId && tail.position && tail.orientation) {
          this.target = { position: [...tail.position], orientation: [...tail.orientation] };
          if (tail.joints) this.solution = tail.joints;
        }
        // Repeated snapshots of the same target must not undo an idle slider edit.
        if (shared.settings.speed_scale !== undefined &&
            (shared.settling || shared.rawTarget?.revision !== this.sharedSpeedRevision))
          this.speedScale = shared.settings.speed_scale;
        if (shared.settings.gripper !== undefined) this.desiredGripper = shared.settings.gripper;
        const plan = view.manipulation?.plan;
        if (!shared.settling && plan && plan.target_revision === shared.rawTarget?.revision && (!plan.group_id || plan.group_id === this.groupId)) {
          this.plan = this.previewPlan = plan; this.planGeneration = this.generation;
        } else if (!this.busy) this.plan = this.previewPlan = null;
        const evaluation = view.manipulation?.evaluation;
        if (evaluation?.group_id === this.groupId && evaluation.target_revision === shared.rawTarget?.revision) {
          this.valid = null;
          this.solution = evaluation.joints;
          this.rejection = null;
        }
      }
      this.sharedSpeedRevision = shared.rawTarget?.revision ?? null;
      if (this.deferredNative && !shared.ownsAuthority && !shared.pending && !shared.blocked &&
          !shared.settling && !shared.authority) {
        const request = this.deferredNative; this.deferredNative = null;
        this.send(request.action, request.payload);
      }
      if (this.deferredNative && shared.ownsAuthority) {
        const request = this.deferredNative; this.deferredNative = null;
        if ((request.action === "plan" || request.action === "evaluate") && this.target)
          request.payload = { ...request.payload, ...this.target, speed_scale: this.speedScale };
        this.send(request.action, request.payload);
      }
    }
    const tail = view.manipulation?.following_tail;
    if (tail?.group_id === this.groupId && !this.gesture && tail.position && tail.orientation) {
      if (this.tailGeneration !== tail.generation) this.valid = null;
      this.tailGeneration = tail.generation;
      this.target = { position: [...tail.position], orientation: [...tail.orientation] };
      this.solution = tail.joints ?? this.solution; this.rejection = null;
    }
    const groups = view.manipulation?.groups ?? [];
    if (!this.groupId && groups.length === 1) this.groupId = groups[0].id;
    if (view.manipulation?.available !== false && this.groupId && !groups.some((g) => g.id === this.groupId))
      this.reset();
    if (
      this.executionLatch &&
      view.manipulation?.ts != null &&
      view.manipulation.ts > this.executionLatch.at &&
      (!this.executionLatch.operation ||
        !view.manipulation.operation_id ||
        view.manipulation.operation_id === this.executionLatch.operation) &&
      !["accepted", "executing"].includes(view.manipulation.execution ?? "")
    )
      this.executionLatch = null;
    if (this.selected && !this.dragging && view.manipulation?.execution === "completed" &&
        this.executionLatch === null && !this.hasPending("execute") && this.executedGeneration === this.generation && ((this.executedOperation !== null && view.manipulation?.operation_id === this.executedOperation) || this.reachedValidatedGoal())) {
      this.retireCompletedDraft(); this.executedGeneration = null;
    }
    if (view.manipulation?.execution === "aborted" && this.executedOperation !== null &&
        view.manipulation.operation_id === this.executedOperation && !this.hasPending("execute")) {
      // Cancellation invalidates the server's checked plan, but the draft remains editable.
      this.plan = this.previewPlan = null;
      this.executeAfterPlan = false;
      this.executedGeneration = null; this.executedOperation = null;
      this.status = view.manipulation.message ?? "Target not reached";
    }
    if (this.gesture === "following" && !this.token && this.feedbackFresh && !view.manipulation?.stopped && !this.hasPending("acquire", "release")) this.send("acquire");
    const stopped = view.manipulation?.stopped === true;
    if (stopped && !this.stoppedBefore && !recovered) this.discard("server stopped");
    this.stoppedBefore = stopped;
    for (const [id, request] of this.pending) {
      if (now < Math.max(request.deadline, this.session.assetTransferDeadline?.(id) ?? 0)) continue;
      this.pending.delete(id);
      if (request.action === "evaluate") {
        this.advisoryTiming.timeouts++;
        this.advisoryTiming.maximumDurationS = Math.max(this.advisoryTiming.maximumDurationS, now - request.startedAt);
      }
      if (request.action === "release") {
        this.gesture = null;
        this.status = "Following release timed out";
      }
      if (request.action === "acquire")
        this.retiredAcquisitions.set(id, request.group);
      if (request.episode !== this.episode) continue;
      this.status =
        request.action === "execute"
          ? "Execution response timed out; checking robot state"
          : "Request timed out";
      if (["plan","evaluate"].includes(request.action) && request.generation === this.generation && this.target) {
        this.evaluatedGeneration = this.generation;
        // Advisory planning cannot move hardware. A missing RPC result is not a
        // reason to tear down a held grab or reset its end-effector marker.
        this.executeAfterPlan = false;
        this.planQueued = false;
        this.rejectedTarget = this.target;
        this.rejection = { revision: ++this.rejectionRevision, pose: this.target, message: this.status };
      }
    }
    if ((this.gesture !== null || this.finishingAt !== null) && !this.feedbackFresh) {
      this.status = "Joint feedback is stale";
      this.cancel("feedback stale");
    }
    if (
      this.feedbackAvailable &&
      this.token &&
      this.target &&
      this.following &&
      this.gesture === "following" &&
      !view.hello?.server_follow_stream &&
      now - this.lastUpdate >= 1 / 30
    ) {
      const id = `follow-${++this.sequence}`;
      const sampleSequence = ++this.tokenSequence;
      this.followSamples.set(sampleSequence, { id, pose: this.target });
      while (this.followSamples.size > 128) this.followSamples.delete(this.followSamples.keys().next().value!);
      this.session.sendText(
        encodeManipulation(
          id,
          "update",
          this.groupId!,
          {
            ...this.target,
            speed_scale: this.speedScale,
            token: this.token,
            ts: now,
            ...this.authorityFields(),
            sequence: sampleSequence,
          },
        ),
      );
      this.lastUpdate = now;
    }
    if (this.finishingAt !== null) {
      const reached = this.reachedValidatedGoal();
      this.arrivedAt = reached ? this.arrivedAt ?? now : null;
      if (this.arrivedAt !== null && now - this.arrivedAt >= 0.5) { this.interrupt("target reached"); this.status = ""; }
      else if (now - this.finishingAt >= 55) { this.cancel("target timeout"); this.status = "Target timed out"; }
    }
    this.updateOffset();
    const intent = this.snapshot();
    if (
      !intent.hasDraft &&
      !this.dragging &&
      !intent.executing &&
      !intent.resetting
    ) {
      this.plan = this.previewPlan = null;
      this.planQueued = false;
      this.executeAfterPlan = false;
    }
    if (
      this.planQueued && !this.dragging &&
      !this.snapshot().blocked &&
      this.selected &&
      this.feedbackAvailable &&
      this.feedbackFresh &&
      !stopped &&
      !intent.executing &&
      !intent.resetting &&
      !this.hasPending("plan", "cancel", "resume")
    ) {
      this.planQueued = false;
      if (this.target) {
        this.status = "Planning";
        this.send("plan", {
          ...this.target,
          speed_scale: this.speedScale,
          ...(this.desiredGripper == null
            ? {}
            : { final_gripper: this.desiredGripper }),
        });
      }
    }
    if (
      this.selected &&
      !this.snapshot().blocked &&
      this.target &&
      intent.targetOffset &&
      this.planGeneration !== this.generation &&
      this.feedbackAvailable &&
      this.feedbackFresh &&
      !stopped &&
      !intent.executing &&
      !intent.resetting &&
      (!this.planQueued || this.dragging) &&
      (this.dragging || !this.hasPending("plan")) &&

      this.gesture !== "following" &&
      !this.deferredNative &&
      this.evaluatedGeneration !== this.generation &&
      now - this.lastEvaluation >= MANIPULATION_PLAN_INTERVAL_S &&
      ![...this.pending.values()].some((p) =>
        ["evaluate", "cancel", "resume"].includes(p.action),
      )
    ) {
      this.evaluatedGeneration = this.generation;
      this.send("evaluate", this.target);
      this.lastEvaluation = now;
    }
  }

  end(complete = true, reason = complete ? "input released" : "interrupted"): void {
    this.traceCaptureEnd(reason);
    if (complete && this.gesture === null) return;
    const following = this.gesture === "following";
    const failed = this.rejectedTarget === this.target || this.rejection?.pose === this.target;
    if (complete && failed && this.target) this.restoreValidTarget();
    if (complete && !this.session.collaboration && this.following && this.token && this.target && this.feedbackFresh) {
      if (failed) {
        this.end(false, "rejected release");
        return;
      }
      this.finishingAt ??= this.now();
      this.arrivedAt = null;
      this.gesture = null;
      return;
    }
    this.finishingAt = this.arrivedAt = null;
    this.followSamples.clear();
    const planOnRelease = this.gesture === "planning" && !!this.target;
    if (planOnRelease) {
      this.releasedGeneration = this.generation;
      if (this.rejectedTarget === this.target) this.restoreValidTarget();
    }
    const token = this.token;
    const authority = this.session.collaboration?.snapshot("manipulation", this.groupId ?? undefined).authority;
    const canonical = this.session.collaboration?.snapshot("manipulation", this.groupId ?? undefined).rawTarget;
    this.releasedFollow = complete && following && token && this.target ? {
      token, episode: this.episode, pose: this.target,
      epoch: this.session.collaboration?.raw()?.epoch ?? null, lease: authority?.lease_id ?? null,
      canonical: canonical ? { pose: canonical, revision: canonical.revision, sequence: canonical.sequence } : null,
      finalSequence: null,
    } : null;
    this.gesture = null;
    this.followSamples.clear();
    this.deferredNative = null;
    this.token = null;
    if (complete) {
      // The server atomically hands its validated endpoint to a takeoverable tail.
      // Retire editing rights immediately: no post-release native token heartbeat.
      const finalSequence = this.session.collaboration?.release(this.target ?? undefined, ["manipulation_planning", "manipulation_following"]);
      if (this.releasedFollow) this.releasedFollow.finalSequence = finalSequence ?? null;
      if (!this.session.collaboration && following && token) this.send("release", { token });
    } else {
      this.session.collaboration?.cancel(["manipulation_planning", "manipulation_following"]);
      this.reconcilingTarget = false;
      if (!this.session.collaboration && token) this.send("release", { token });
    }
    if (planOnRelease && complete && this.snapshot().hasDraft && this.feedbackFresh && this.planGeneration !== this.generation) { this.planQueued = true; this.status = "Planning"; }
    for (const [id, request] of this.pending) if (request.action === "acquire") {
      this.retiredAcquisitions.set(id, request.group); this.pending.delete(id);
    }
  }

  requestPlan(): void {
    if (
      !this.selected ||
      this.snapshot().blocked ||
      !this.target ||
      !this.snapshot().hasDraft ||
      this.snapshot().blocked ||
      !this.feedbackFresh ||
      this.snapshot().stopped ||
      this.snapshot().executing ||
      this.snapshot().resetting ||
      this.following
    )
      return;
    if (this.dragging) this.interrupt();
    this.executeAfterPlan = false;
    this.plan = null;
    this.planQueued = true;
    this.status = "Planning";
  }
  execute(): void {
    const intent = this.snapshot();
    if (
      !this.selected ||
      intent.blocked ||
      !intent.hasDraft ||
      !this.feedbackFresh ||
      intent.stopped ||
      intent.executing ||
      intent.resetting ||
      this.dragging ||
      this.hasPending("cancel", "resume")
    )
      return;
    if (!intent.targetOffset && this.desiredGripper != null) {
      this.send("gripper", { value: this.desiredGripper });
      return;
    }
    if (!this.plan || this.planGeneration !== this.generation) {
      this.requestPlan();
      this.executeAfterPlan = this.planQueued || this.hasPending("plan");
      return;
    }
    this.status = "Moving";
    this.planQueued = false;
    this.executionLatch = { at: this.serverNow(), operation: null };
    this.executedGeneration = this.generation;
    this.send("execute", { plan_id: this.plan.plan_id });
  }
  cancel(reason = "cancel requested"): void {
    this.discard(reason);
    if (this.groupId && this.available && !this.hasPending("cancel"))
      this.send("cancel");
  }
  /** Retire local intent immediately; emergency stop itself uses the session command. */
  discard(reason = "intent discarded"): void {
    this.discardedSharedRevision = this.session.collaboration?.snapshot("manipulation", this.groupId ?? undefined).rawTarget?.revision ?? null;
    this.lastSourceTs = null; this.lostAt = null; this.feedbackHeld = false; this.recoveringAuthority = false;
    this.interrupt(reason);
    this.episode++;
    this.executionLatch = null;
    this.executedGeneration = null;
    this.generation++;
    this.executeAfterPlan = false;
    this.planQueued = false;
    this.plan = this.previewPlan = null;
    this.solution = null;
    this.plannedJoints = null; this.plannedGeneration = -1;
    this.target = null;
    this.lastValidTarget = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.rejectedTarget = null;
    this.offset = false;
    this.status = "";
  }
  invalidateTarget(): void {
    if (this.session.collaboration &&
        !this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined).ownsAuthority) {
      this.discard("observer suspended");
      this.discardedSharedRevision = null;
      return;
    }
    this.cancel();
    this.target = null;
    this.lastValidTarget = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.rejectedTarget = null;
  }
  resume(): void {
    this.send("resume");
  }
  setGripper(value: number): void {
    if (
      !Number.isFinite(value) || value < 0 || value > 1 ||
      this.snapshot().blocked ||
      !this.feedbackFresh ||
      this.snapshot().stopped ||
      this.snapshot().executing ||
      this.snapshot().resetting
    )
      return;
    this.generation++;
    this.plan = null;
    if (this.selected) {
      this.target ??=
        this.session.view().manipulation?.observations?.[this.groupId ?? ""]
          ?.pose ?? null;
      this.updateOffset();
      this.desiredGripper = value;
      if (this.target) this.publishSettings();
      this.planQueued = this.snapshot().targetOffset && this.target !== null && this.gesture === null;
      this.executeAfterPlan = false;
      return;
    }
    if (this.session.collaboration) {
      this.desiredGripper = value;
      this.target ??= this.session.view().manipulation?.observations?.[this.groupId ?? ""]?.pose ?? null;
      if (this.target) this.session.collaboration.update(this.target, this.sharedSettings());
    }
    this.send("gripper", { value });
  }
  reset(): void {
    if (this.reconcilingTarget) this.session.collaboration?.cancel(["manipulation_planning"]);
    this.reconcilingTarget = false;
    this.releasedFollow = null;
    this.lastSourceTs = null; this.lostAt = null; this.feedbackHeld = false; this.recoveringAuthority = false;
    this.finishingAt = this.arrivedAt = null;
    this.followSamples.clear();
    this.modelRevision = null;
    this.sharedSpeedRevision = null;
    this.discardedSharedRevision = null;
    this.gesture = null;
    this.token = null;
    this.episode++;
    this.executionLatch = null;
    this.executedGeneration = null;
    this.generation++;
    this.executeAfterPlan = false;
    this.planQueued = false;
    this.plan = this.previewPlan = null;
    this.plannedJoints = null;
    this.pending.clear();
    this.retiredAcquisitions.clear();
    this.deferredNative = null; this.transientAuthority = false;
    this.solution = null;
    this.plannedJoints = null; this.plannedGeneration = -1;
    this.target = null;
    this.lastValidTarget = null;
    this.groupId = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.status = "";
    this.offset = false;
    this.stoppedBefore = false;
  }
  dispose(): void {
    this.interrupt();
    this.unsubscribe();
    this.reset();
  }

  private publishSettings(): void {
    const collaboration = this.session.collaboration;
    if (!collaboration || !this.target) return;
    if (!this.ensureAuthority("manipulation_planning")) return;
    collaboration.update(this.target, this.sharedSettings());
    if (!this.dragging) collaboration.release(this.target, ["manipulation_planning"]);
  }
  private sharedSettings() {
    return { group_id: this.groupId ?? undefined, speed_scale: this.speedScale,
      ...(this.desiredGripper === null ? {} : { gripper: this.desiredGripper }) };
  }
  private ensureAuthority(kind: "manipulation_planning" | "manipulation_following", targetDependent = true): boolean {
    const collaboration = this.session.collaboration;
    if (!collaboration || collaboration.snapshot("manipulation", this.groupId ?? undefined).ownsAuthority) return true;
    const measured = this.session.view().manipulation?.observations?.[this.groupId ?? ""]?.pose;
    const shared = collaboration.snapshot("manipulation", this.groupId ?? undefined);
    // An existing target survives acquisition. Sending a rendered pose here
    // could replace it while it is still interpolating or awaiting a final ACK.
    const initial = !targetDependent ? undefined
      : shared.rawTarget ? undefined : this.target ?? measured ?? undefined;
    return collaboration.begin(kind, `manipulation:${this.groupId}`, initial, this.sharedSettings());
  }
  private authorityFields() {
    const collaboration = this.session.collaboration;
    if (!collaboration) return {};
    const credentials = collaboration.credentials();
    const target = collaboration.snapshot("manipulation", this.groupId ?? undefined).rawTarget;
    return { ...credentials, ...(target ? { target_revision: target.revision } : {}) };
  }
  private restoreValidTarget(): void {
    const collaboration = this.session.collaboration;
    const shared = collaboration?.snapshot("manipulation", this.groupId ?? undefined);
    if (shared?.blocked || this.session.view().manipulation?.stopped) return;
    this.target = this.lastValidTarget;
    this.solution = this.valid?.joints ?? null;
    this.episode++;
    this.generation++;
    this.plan = this.previewPlan = null;
    this.rejection = null;
    this.rejectedTarget = null;
    this.executeAfterPlan = false;
    this.planQueued = this.selected && this.target !== null && this.snapshot().hasDraft;
    this.releasedGeneration = null;
    this.releasedFollow = null;
    if (collaboration && !this.dragging && !shared?.ownsAuthority && this.target &&
        this.ensureAuthority("manipulation_planning")) {
      // Reconcile a released invalid draft through editing authority. This
      // carries no native following/update command and cannot move the arm.
      collaboration.release(this.target, ["manipulation_planning"]);
      this.reconcilingTarget = true;
    }
  }

  private serverNow(): number {
    const sync = this.session.view().hello?.time_sync;
    return this.now() + (sync ? sync.ts_server - sync.ts_client : 0);
  }
  private send(
    action: ManipulationAction,
    payload: Parameters<typeof encodeManipulation>[3] = {},
  ): void {
    if (this.session.view().hello?.source?.read_only || this.session.view().manipulation?.read_only) return;
    if (!this.groupId || this.session.view().connection !== "ready") return;
    const collaboration = this.session.collaboration;
    const unownedCancel = action === "cancel" && collaboration?.raw()?.authority === null;
    if (collaboration && !unownedCancel && !collaboration.snapshot("manipulation", this.groupId).ownsAuthority) {
      if (action === "release") { collaboration.cancel(["manipulation_planning", "manipulation_following"]); return; }
      if (!this.ensureAuthority(this.gesture === "following" ? "manipulation_following" : "manipulation_planning",
          ["plan", "evaluate", "execute", "gripper", "acquire", "update"].includes(action))) return;
      this.transientAuthority = this.gesture === null;
      this.deferredNative = { action, payload };
      return;
    }
    let advisoryPreviousSample = false;
    if (collaboration && (["plan", "execute"].includes(action) || action === "gripper" && this.selected ||
        action === "evaluate" && !this.session.view().hello?.independent_ik)) {
      const shared = collaboration.snapshot("manipulation", this.groupId);
      const desired = this.target ?? this.session.view().manipulation?.observations?.[this.groupId]?.pose;
      const canonical = shared.rawTarget;
      const agrees = desired && canonical && !poseChanged(desired, canonical, 1e-6, 1e-6) &&
        Math.abs((canonical.speed_scale ?? this.speedScale) - this.speedScale) < 1e-8 &&
        (this.desiredGripper === null || canonical.gripper === this.desiredGripper);
      if (!agrees) {
        if (canonical && this.dragging && ["plan", "evaluate"].includes(action)) {
          payload = { ...payload, position: canonical.position, orientation: canonical.orientation,
            speed_scale: canonical.speed_scale ?? this.speedScale };
          if (canonical.gripper !== undefined) payload.final_gripper = canonical.gripper;
          else delete payload.final_gripper;
          advisoryPreviousSample = true;
        } else {
          if (desired) collaboration.update(desired, this.sharedSettings());
          this.deferredNative = { action, payload }; return;
        }
      }
    }
    // An advisory result for the previous ACK must not mark the newest aim as checked.
    if (advisoryPreviousSample && action === "evaluate") this.evaluatedGeneration = this.generation - 1;
    const id = `manipulation-${++this.sequence}`;
    if (action === "evaluate") this.advisoryTiming.requests++;
    this.pending.set(id, {
      action,
      order: this.sequence,
      generation: this.generation - (advisoryPreviousSample ? 1 : 0),
      episode: this.episode,
      epoch: collaboration?.raw()?.epoch ?? null,
      lease: collaboration?.snapshot("manipulation", this.groupId).authority?.lease_id ?? null,
      group: this.groupId,
      speed: this.speedScale,
      gripper: this.desiredGripper,
      startedAt: this.now(),
      pose: payload.position && payload.orientation ? { position: [...payload.position], orientation: [...payload.orientation] } : this.target,
      deadline:
        this.now() +
        (action === "reset_joints" || action === "prepare_shutdown"
          ? 65
          : action === "plan"
            ? 20
            : 5),
    });
    this.session.sendText(
      encodeManipulation(id, action, this.groupId, { ...payload, ...this.authorityFields(),
        ...(unownedCancel ? { epoch: collaboration!.raw()!.epoch, lease_id: "unowned", sequence: ++this.sequence } : {}) }),
    );
  }
  private accept(result: ManipulationResult): void {
    const retiredGroup = this.retiredAcquisitions.get(result.request_id);
    if (retiredGroup) {
      this.retiredAcquisitions.delete(result.request_id);
      if (result.token && !this.session.collaboration)
        this.session.sendText(
          encodeManipulation(
            `release-${++this.sequence}`,
            "release",
            retiredGroup,
            { token: result.token },
          ),
        );
      return;
    }
    const released = this.releasedFollow;
    const shared = this.session.collaboration?.snapshot("manipulation", this.groupId ?? undefined);
    const canonical = shared?.rawTarget;
    const sameReleasedTarget = !!released && !!canonical && !!released.canonical && (
      canonical.revision === released.canonical.revision && canonical.sequence === released.canonical.sequence &&
        !poseChanged(canonical, released.canonical.pose, 1e-6, 1e-6) ||
      canonical.sequence === released.finalSequence && canonical.revision <= released.canonical.revision + 1 &&
        !poseChanged(canonical, released.pose, 1e-6, 1e-6)
    );
    const releasedCurrent = released && released.episode === this.episode && !this.gesture &&
      !this.session.view().manipulation?.stopped && sameReleasedTarget &&
      this.target && !poseChanged(released.pose, this.target, 1e-6, 1e-6) &&
      released.epoch === (this.session.collaboration?.raw()?.epoch ?? null) &&
      (!shared?.authority || shared.authority.lease_id === released.lease);
    const followingToken = this.token ?? (releasedCurrent ? released.token : null);
    if (result.action === "update" && followingToken &&
        result.request_id.startsWith(`shared-follow-${followingToken}-`) &&
        result.group_id === this.groupId && result.sequence != null &&
        result.sequence > this.lastFollowResult) {
      this.lastFollowResult = result.sequence;
      const sample = result.sample_pose ?? result.pose;
      const currentSample = !!sample && !!this.target && !poseChanged(sample, this.target, 0.005, Math.PI / 120);
      if (result.status === "feasible" && result.joints && result.pose) {
        this.rememberValid(result.pose, result.joints, ++this.sequence, sample ?? result.pose);
        this.solution = this.valid!.joints;
        if (currentSample) { this.rejection = null; this.rejectedTarget = null; }
      }
      if (currentSample && (result.status === "infeasible" ||
          ["ik_failed", "joint_limit", "collision"].includes(result.code ?? ""))) {
        this.status = shortManipulationStatus(result.code || result.message || "IK failed");
        this.rejectedTarget = this.target;
        this.rejection = { revision: ++this.rejectionRevision, pose: this.target!,
          message: this.status, failedJoints: result.failed_joints };
        if (releasedCurrent) this.restoreValidTarget();
      }
      if (result.status === "rejected" && result.code === "retired" &&
          this.gesture === "following" && !this.session.view().manipulation?.stopped &&
          this.session.collaboration?.snapshot("manipulation", this.groupId ?? undefined).ownsAuthority) {
        this.token = null;
        this.lastFollowResult = -1;
      }
      return;
    }
    if (
      result.action === "update" &&
      !this.retainingFeedback &&
      this.token &&
      result.group_id === this.groupId
    ) {
      const requestNumber = Number(result.request_id.replace(/^follow-/, ""));
      if (
        !result.request_id.startsWith("follow-") ||
        !Number.isSafeInteger(requestNumber) ||
        requestNumber <= this.followRequestFloor
      )
        return;
      if (result.sequence == null || result.sequence <= this.lastFollowResult)
        return;
      const sample = this.followSamples.get(result.sequence);
      if (!sample || sample.id !== result.request_id) return;
      for (const key of this.followSamples.keys()) if (key <= result.sequence) this.followSamples.delete(key);
      this.lastFollowResult = result.sequence;
      if (result.status === "feasible") {
        if (result.joints) {
          this.rememberValid(result.pose ?? sample.pose, result.joints, requestNumber, sample.pose);
          this.solution = this.valid!.joints;
        }
        if (this.target && !poseChanged(sample.pose, this.target, 0.005, Math.PI / 120)) this.rejection = null;
        this.status = "Moving";
      } else if (result.status === "infeasible" || ["ik_failed", "joint_limit", "collision"].includes(result.code ?? "")) {
        this.status = shortManipulationStatus(
          result.code || result.message || "IK failed",
        );
        if (!this.target || poseChanged(sample.pose, this.target, 0.005, Math.PI / 120)) return;
        if (this.target)
          this.rejection = {
            revision: ++this.rejectionRevision,
            pose: this.target,
            message: this.status,
            failedJoints: result.failed_joints,
          };
        if (this.finishingAt !== null) {
          this.end(false, "release validation failed");
        }
      } else if (result.status === "rejected" && !["ik_failed", "joint_limit", "collision"].includes(result.code ?? "")) {
        this.status = shortManipulationStatus(result.message || "Check arm");
        this.interrupt(`server rejected: ${result.code || result.message || "unknown"}`);
      }
      return;
    }
    if (this.retainingFeedback && result.action !== "release") return;
    const request = this.pending.get(result.request_id);
    if (
      !request ||
      request.action !== result.action ||
      request.group !== result.group_id
    )
      return;
    this.pending.delete(result.request_id);
    if (request.action === "evaluate") {
      this.advisoryTiming.completions++;
      if (result.status !== "feasible") this.advisoryTiming.failures++;
      this.advisoryTiming.maximumDurationS = Math.max(this.advisoryTiming.maximumDurationS, this.now() - request.startedAt);
    }
    if (request.episode !== this.episode) return;
    if (this.session.collaboration &&
        (request.epoch !== this.session.collaboration.raw()?.epoch ||
         shared?.authority && shared.authority.lease_id !== request.lease)) return;
    if (this.session.collaboration && ["evaluate", "plan"].includes(result.action) &&
        (request.epoch !== this.session.collaboration.raw()?.epoch ||
         shared?.authority && shared.authority.lease_id !== request.lease ||
         this.session.view().manipulation?.stopped ||
         !this.gesture && !shared?.ownsAuthority && !!this.target &&
           (!shared?.rawTarget || poseChanged(this.target, shared.rawTarget, 1e-6, 1e-6)))) return;
    if (result.action === "plan" && this.session.collaboration &&
        (!shared?.ownsAuthority || shared.authority?.lease_id !== request.lease)) return;
    if (result.action === "plan" && (request.generation !== this.generation ||
        request.speed !== this.speedScale || request.gripper !== this.desiredGripper ||
        shared?.settling)) return;
    if (result.action === "release") {
      if (result.status !== "released" && result.code !== "retired") {
        this.gesture = null;
        this.status = "Following release failed";
      }
    }
    if (this.session.collaboration && (result.action === "release" && !this.feedbackHeld || this.transientAuthority && !this.gesture)) {
      if (["reset_joints", "resume", "cancel", "prepare_shutdown"].includes(result.action))
        this.session.collaboration.cancel(["manipulation_planning", "manipulation_following"]);
      else this.session.collaboration.release(this.target ?? undefined, ["manipulation_planning", "manipulation_following"]);
      this.transientAuthority = false;
    }
    if (result.action === "release") return;
    if (request.episode !== this.episode) return;
    if (
      request.generation !== this.generation &&
      !["plan", "evaluate"].includes(result.action) &&
      !(result.action === "acquire" && this.following)
    ) {
      if (result.token && !this.session.collaboration)
        this.session.sendText(
          encodeManipulation(
            `release-${++this.sequence}`,
            "release",
            request.group,
            { token: result.token },
          ),
        );
      return;
    }
    if (request.generation === this.generation)
      this.status = shortManipulationStatus(
        result.code || result.message || result.status,
      );
    if (
      result.action === "acquire" &&
      result.token &&
      this.gesture === "following"
    ) {
      this.token = result.token;
      this.tokenSequence = 0;
      this.lastFollowResult = -1;
      this.followRequestFloor = this.sequence;
    }
    if (request.order >= (this.valid?.order ?? -1) &&
        ((result.action === "evaluate" && result.status === "feasible") || (result.action === "plan" && result.plan_id))) {
      const endpoint = result.trajectory?.[result.trajectory.length - 1];
      const joints = result.joints ?? (endpoint && result.joint_names
        ? Object.fromEntries(result.joint_names.map((name, i) => [name, endpoint.positions[i]])) : null);
      if (request.pose && joints) this.rememberValid(result.pose ?? request.pose, joints, request.order, result.sample_pose ?? request.pose);
      if (request.generation === this.generation) this.rejectedTarget = null;
    }
    if (request.generation === this.generation && ["evaluate", "plan"].includes(result.action) &&
        (result.status === "infeasible" || ["ik_failed", "joint_limit", "collision"].includes(result.code ?? ""))) {
      this.rejectedTarget = this.target;
      if (this.releasedGeneration === this.generation) { this.restoreValidTarget(); return; }
    }
    if (result.action === "evaluate" && request.generation === this.generation) {
      if (result.status === "feasible") {
        this.solution = result.joints ?? this.solution;
        this.rejection = null;
        this.rejectedTarget = null;
      }
      if (result.status !== "feasible") {
        this.rejectedTarget = this.target;
        if (this.target)
          this.rejection = {
            revision: ++this.rejectionRevision,
            pose: this.target,
            failedJoints: result.failed_joints,
            message: shortManipulationStatus(
              result.code || result.message || "IK failed",
            ),
          };
        this.evaluatedGeneration = this.generation;
        this.executeAfterPlan = false;
      }
    }
    if (
      result.action === "plan" &&
      result.plan_id &&
      result.joint_names &&
      result.trajectory &&
      result.duration !== undefined
    ) {
      if (request.generation >= this.plannedGeneration) {
        this.plannedGeneration = request.generation;
        this.plannedJoints = { ...this.observedJoints(), ...Object.fromEntries(result.joint_names.map((name, i) => [name, result.trajectory![result.trajectory!.length - 1].positions[i]])) };
      }
      if (request.generation < this.planGeneration) return;
      this.previewPlan = {
        plan_id: result.plan_id,
        joint_names: result.joint_names,
        trajectory: result.trajectory,
        duration: result.duration,
        target_revision: result.target_revision, group_id: result.group_id,
      };
      this.plan =
        request.generation === this.generation ? this.previewPlan : null;
      this.planGeneration = request.generation;
      if (request.generation === this.generation) {
        this.planQueued = false;
        this.rejection = null;
      } else if (!this.dragging && this.snapshot().hasDraft)
        this.planQueued = true;
      if (this.executeAfterPlan && request.generation === this.generation) {
        this.executeAfterPlan = false;
        this.execute();
      }
    }
    if (
      result.action === "plan" &&
      !result.plan_id &&
      request.generation === this.generation
    ) {
      this.executeAfterPlan = false;
      if (this.target)
        this.rejection = {
          revision: ++this.rejectionRevision,
          pose: this.target,
          failedJoints: result.failed_joints,
          message: shortManipulationStatus(
            result.code || result.message || "Plan failed",
          ),
        };
    }
    if (result.action === "execute") {
      if (result.status === "accepted") {
        if (this.executionLatch) {
          this.executionLatch.operation = result.operation_id ?? null;
          this.executedOperation = result.operation_id ?? null;
          this.executionLatch.at = this.serverNow();
        }
        this.plan = null;
      } else this.executionLatch = null;
    }
    if (result.action === "gripper" && result.status === "completed") this.desiredGripper = null;
    if (result.action === "acquire" && !result.token) this.gesture = null;
  }
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
