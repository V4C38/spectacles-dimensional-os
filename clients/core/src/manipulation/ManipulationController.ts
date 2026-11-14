import type { ManipulationAction, ManipulationPose, ManipulationResult, ManipulationPlan } from "./ManipulationTypes";
import type { InteractionAuthorityPort, ReadonlyFacts } from "../ClientContracts";
import type { ARModuleSession, ARModuleSessionState } from "../websocket/ARModuleSession";
import { encodeManipulation } from "./ManipulationProtocol";
import { poseCoordinatesEqual } from "../localization/ClientTracking";
import { MANIPULATION_PLAN_INTERVAL_S, poseChanged, targetIsOffset, deriveManipulationSnapshot, shortManipulationStatus, type ManipulationSnapshot, type ManipulationRejection, ManipulationPreviewPlayback } from "./ManipulationPresentation";

export interface ManipulationRequest {
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

/** Owns RPC correlation, transfer-aware deadlines and acquisition retirement. */
export class ManipulationRequests {
  private readonly pending = new Map<string, ManipulationRequest>();
  private readonly timing = { requests: 0, completions: 0, failures: 0, timeouts: 0, maximumDurationS: 0 };

  constructor(private readonly now: () => number,
    private readonly transferDeadline: (id: string) => number | null | undefined) {}

  track(id: string, request: Omit<ManipulationRequest, "startedAt" | "deadline">): void {
    const startedAt = this.now();
    const timeout = request.action === "reset_joints" || request.action === "prepare_shutdown" ? 65
      : request.action === "plan" ? 20 : 5;
    this.pending.set(id, { ...request, startedAt, deadline: startedAt + timeout });
    if (request.action === "evaluate") this.timing.requests++;
  }

  has(...actions: ManipulationAction[]): boolean {
    for (const request of this.pending.values()) if (actions.includes(request.action)) return true;
    return false;
  }

  take(result: ManipulationResult): ManipulationRequest | null {
    const request = this.pending.get(result.request_id);
    if (!request || request.action !== result.action || request.group !== result.group_id) return null;
    this.pending.delete(result.request_id);
    if (request.action === "evaluate") {
      this.timing.completions++;
      if (result.status !== "feasible") this.timing.failures++;
      this.recordDuration(request);
    }
    return request;
  }

  expired(): ManipulationRequest[] {
    const expired: ManipulationRequest[] = [];
    for (const [id, request] of this.pending) {
      if (this.now() < Math.max(request.deadline, this.transferDeadline(id) ?? 0)) continue;
      this.pending.delete(id);
      if (request.action === "evaluate") { this.timing.timeouts++; this.recordDuration(request); }
      expired.push(request);
    }
    return expired;
  }

  retireAcquisitions(): void {
    for (const [id, request] of this.pending) if (request.action === "acquire") {
      this.pending.delete(id);
    }
  }

  retainRelease(): void {
    this.retireAcquisitions();
    for (const [id, request] of this.pending) if (request.action !== "release") this.pending.delete(id);
  }

  clear(): void { this.pending.clear(); }

  diagnostics() {
    let pendingAgeS = 0;
    for (const request of this.pending.values()) if (request.action === "evaluate")
      pendingAgeS = Math.max(pendingAgeS, this.now() - request.startedAt);
    return { ...this.timing, pendingAgeS };
  }

  private recordDuration(request: ManipulationRequest): void {
    this.timing.maximumDurationS = Math.max(this.timing.maximumDurationS, this.now() - request.startedAt);
  }
}

type DraftState = {
  generation: number;
  planGeneration: number;
  lastEvaluation: number;
  evaluatedGeneration: number;
  planQueued: boolean;
  offset: boolean;
  discardedSharedRevision: number | null;
  tailGeneration: number | null;
  rejectionRevision: number;
  plannedGeneration: number;
  plannedJoints: Record<string, number> | null;
  releasedGeneration: number | null;
  rejectedTarget: ManipulationPose | null;
  target: ManipulationPose | null;
  solution: Record<string, number> | null;
  plan: ManipulationPlan | null;
  speedScale: number;
  desiredGripper: number | null;
  rejection: ManipulationRejection | null;
  valid: { requested: ManipulationPose; pose: ManipulationPose; joints: Record<string, number>;
    validatedJoints: Record<string, number>; order: number } | null;
};

/** Draft artifacts are versioned independently of pending RPCs. */
class ManipulationDraft {
  private readonly state: DraftState = {
    generation: 0, planGeneration: -1, lastEvaluation: -Infinity, evaluatedGeneration: -1,
    planQueued: false, offset: false, discardedSharedRevision: null, tailGeneration: null,
    rejectionRevision: 0, plannedGeneration: -1, plannedJoints: null, releasedGeneration: null,
    rejectedTarget: null, target: null, solution: null, plan: null, speedScale: .5,
    desiredGripper: null, rejection: null, valid: null,
  };
  get view(): ReadonlyFacts<DraftState> { return this.state; }

  private invalidatePlan(): void {
    this.state.generation++;
    this.state.plan = null;
  }

  clear(): void {
    this.invalidatePlan();
    Object.assign(this.state, {
      target: null, valid: null, solution: null, planGeneration: -1, evaluatedGeneration: -1,
      plannedGeneration: -1, plannedJoints: null, desiredGripper: null, rejection: null,
      rejectedTarget: null, releasedGeneration: null, planQueued: false, offset: false,
    });
  }

  suppressShared(revision: number | null): void { this.state.discardedSharedRevision = revision; }

  changeGroup(): void {
    this.state.discardedSharedRevision = null;
    this.state.target = null;
    this.state.valid = null;
    this.state.solution = null;
  }

  updateOffset(observed: ManipulationPose | null | undefined): void {
    this.state.offset = targetIsOffset(this.state.target, observed, this.state.offset);
  }

  changeSpeed(value: number, queuePlan: boolean): void {
    this.state.speedScale = value;
    this.invalidatePlan();
    this.state.planGeneration = -1;
    this.state.planQueued = queuePlan && this.state.target !== null;
  }

  beginGesture(observed: ManipulationPose | null, joints: Readonly<Record<string, number>>, order: number): void {
    this.state.discardedSharedRevision = null;
    if (!this.state.valid && observed) this.rememberValid(observed, joints, order, observed, joints);
    this.state.releasedGeneration = null;
    this.state.planQueued = false;
    this.invalidatePlan();
    this.state.planGeneration = -1;
  }

  aim(pose: ManipulationPose, planning: boolean): void {
    this.state.rejectedTarget = null;
    this.state.target = { position: [...pose.position], orientation: [...pose.orientation] };
    if (planning) this.invalidatePlan();
  }

  feedbackRecovered(queuePlan: boolean): void {
    this.invalidatePlan();
    this.state.planGeneration = -1;
    this.state.evaluatedGeneration = -1;
    this.state.planQueued = queuePlan && this.state.target !== null;
  }

  observeTail(tail: NonNullable<ARModuleSessionState["interaction"]>["following_tail"]): void {
    if (!tail?.position || !tail.orientation) return;
    if (this.state.tailGeneration !== tail.generation) this.state.valid = null;
    this.state.tailGeneration = tail.generation;
    this.state.target = { position: [...tail.position], orientation: [...tail.orientation] };
    this.state.solution = tail.joints ?? this.state.solution;
    this.state.rejection = null;
  }

  retirePlan(): void { this.state.plan = null; }
  abandonPlanning(): void { this.state.plan = null; this.state.planQueued = false; }
  cancelQueuedPlan(): void { this.state.planQueued = false; }
  requestPlan(): void { this.state.plan = null; this.state.planQueued = true; }
  queueReleasedPlan(): void { this.state.planQueued = true; }
  consumePlanIntent(): void { this.state.planQueued = false; }
  recordRelease(): void { this.state.releasedGeneration = this.state.generation; }

  evaluated(now: number): void {
    this.state.evaluatedGeneration = this.state.generation;
    this.state.lastEvaluation = now;
  }

  advisoryTimedOut(generation: number, message: string): boolean {
    if (generation !== this.state.generation || !this.state.target) return false;
    this.state.evaluatedGeneration = this.state.generation;
    this.state.planQueued = false;
    this.rejectTarget(message);
    return true;
  }

  adoptCanonical(pose: ManipulationPose): void {
    this.state.target = { position: [...pose.position], orientation: [...pose.orientation] };
  }

  observeShared(shared: ReturnType<InteractionAuthorityPort["snapshot"]>,
    manipulation: ARModuleSessionState["manipulation"], group: string, busy: boolean,
    updateSpeed: boolean): void {
    if (shared.target === null) this.state.target = null;
    else if (!this.state.target || poseChanged(this.state.target, shared.target, 1e-8, 1e-8)) this.state.target = shared.target;
    if (shared.settings.speed_scale !== undefined && updateSpeed) this.state.speedScale = shared.settings.speed_scale;
    if (shared.settings.gripper !== undefined) this.state.desiredGripper = shared.settings.gripper;
    const plan = manipulation?.plan;
    if (!shared.settling && plan && plan.target_revision === shared.rawTarget?.revision && (!plan.group_id || plan.group_id === group)) {
      this.state.plan = plan;
      this.state.planGeneration = this.state.generation;
    } else if (!busy) this.state.plan = null;
    const evaluation = manipulation?.evaluation;
    if (evaluation?.group_id === group && evaluation.target_revision === shared.rawTarget?.revision) {
      this.state.valid = null;
      this.state.solution = evaluation.joints;
      this.state.rejection = null;
    }
  }

  invalidateTarget(): void {
    this.state.target = null;
    this.state.valid = null;
    this.state.desiredGripper = null;
    this.state.rejection = null;
    this.state.rejectedTarget = null;
  }

  changeGripper(value: number, observed: ManipulationPose | null): void {
    this.invalidatePlan();
    this.state.desiredGripper = value;
    this.state.target ??= observed;
  }

  planGripperChange(queue: boolean): void { this.state.planQueued = queue; }
  completeGripper(): void { this.state.desiredGripper = null; }

  restoreValidTarget(): void {
    this.state.target = this.state.valid?.pose ?? null;
    this.state.solution = this.state.valid?.joints ?? null;
    this.invalidatePlan();
    this.state.rejection = null;
    this.state.rejectedTarget = null;
    this.state.releasedGeneration = null;
  }

  planRestoredTarget(queue: boolean): void { this.state.planQueued = queue && this.state.target !== null; }

  rememberValid(pose: ManipulationPose, joints: Readonly<Record<string, number>>, order: number,
    requested: ManipulationPose, observed: Readonly<Record<string, number>>): void {
    if (this.state.valid && order < this.state.valid.order) return;
    const endpoint: ManipulationPose = Object.freeze({ position: Object.freeze([...pose.position] as [number, number, number]),
      orientation: Object.freeze([...pose.orientation] as [number, number, number, number]) });
    this.state.valid = Object.freeze({ requested: { position: [...requested.position] as [number, number, number], orientation: [...requested.orientation] as [number, number, number, number] },
      pose: endpoint, joints: Object.freeze({ ...observed, ...joints }), validatedJoints: Object.freeze({ ...joints }), order });
  }

  acceptFollowResult(result: ManipulationResult, order: number, currentSample: boolean,
    observed: Readonly<Record<string, number>>): void {
    if (result.status !== "feasible" || !result.joints || !result.pose) return;
    this.rememberValid(result.pose, result.joints, order, result.sample_pose ?? result.pose, observed);
    this.state.solution = this.state.valid!.joints;
    if (currentSample) this.clearRejection();
  }

  rejectTarget(message: string, failedJoints?: string[]): void {
    this.state.rejectedTarget = this.state.target;
    this.recordRejection(message, failedJoints);
  }

  private recordRejection(message: string, failedJoints?: string[]): void {
    if (this.state.target) this.state.rejection = {
      revision: ++this.state.rejectionRevision, pose: this.state.target, message, failedJoints,
    };
  }

  private clearRejection(): void {
    this.state.rejection = null;
    this.state.rejectedTarget = null;
  }

  acceptAdvisory(result: ManipulationResult, request: ManipulationRequest,
    observed: Readonly<Record<string, number>>): { restoreReleased: boolean; failed: boolean } {
    const current = request.generation === this.state.generation;
    const successful = result.action === "evaluate" && result.status === "feasible" || result.action === "plan" && !!result.plan_id;
    if (successful && request.order >= (this.state.valid?.order ?? -1)) {
      const endpoint = result.trajectory?.[result.trajectory.length - 1];
      const joints = result.joints ?? (endpoint && result.joint_names
        ? Object.fromEntries(result.joint_names.map((name, i) => [name, endpoint.positions[i]])) : null);
      if (request.pose && joints) this.rememberValid(result.pose ?? request.pose, joints, request.order, result.sample_pose ?? request.pose, observed);
      if (current) this.state.rejectedTarget = null;
    }
    const rejected = current && ["evaluate", "plan"].includes(result.action) &&
      (result.status === "infeasible" || ["ik_failed", "joint_limit", "collision"].includes(result.code ?? ""));
    if (rejected) {
      this.state.rejectedTarget = this.state.target;
      if (this.state.releasedGeneration === this.state.generation) return { restoreReleased: true, failed: true };
    }
    if (result.action !== "evaluate" || !current) return { restoreReleased: false, failed: false };
    if (result.status === "feasible") {
      this.state.solution = result.joints ?? this.state.solution;
      this.clearRejection();
      return { restoreReleased: false, failed: false };
    }
    this.rejectTarget(shortManipulationStatus(result.code || result.message || "IK failed"), result.failed_joints);
    this.state.evaluatedGeneration = this.state.generation;
    return { restoreReleased: false, failed: true };
  }

  acceptPlan(result: ManipulationResult, request: ManipulationRequest,
    observed: Readonly<Record<string, number>>, queueObsolete: boolean): "current" | "obsolete" | "failed" | "ignored" {
    if (result.plan_id && result.joint_names && result.trajectory && result.duration !== undefined) {
      if (request.generation >= this.state.plannedGeneration) {
        this.state.plannedGeneration = request.generation;
        const endpoint = result.trajectory[result.trajectory.length - 1];
        this.state.plannedJoints = { ...observed, ...Object.fromEntries(result.joint_names.map((name, i) => [name, endpoint.positions[i]])) };
      }
      if (request.generation < this.state.planGeneration) return "ignored";
      const current = request.generation === this.state.generation;
      this.state.plan = current ? {
        plan_id: result.plan_id, joint_names: result.joint_names, trajectory: result.trajectory,
        duration: result.duration, target_revision: result.target_revision, group_id: result.group_id,
      } : null;
      this.state.planGeneration = request.generation;
      if (current) {
        this.state.planQueued = false;
        this.state.rejection = null;
      } else if (queueObsolete) this.state.planQueued = true;
      return current ? "current" : "obsolete";
    }
    if (!result.plan_id && request.generation === this.state.generation) {
      this.recordRejection(shortManipulationStatus(result.code || result.message || "Plan failed"), result.failed_joints);
      return "failed";
    }
    return "ignored";
  }
}

type ReleasedFollow = { token: string; episode: number; pose: ManipulationPose; epoch: string | null; lease: string | null;
  canonical: { pose: ManipulationPose; revision: number; sequence: number } | null; finalSequence: number | null };
type FollowState = {
  episode: number; lastFollowResult: number; token: string | null; gesture: "planning" | "following" | null;
  releasedFollow: ReleasedFollow | null; recoveringAuthority: boolean; feedbackHeld: boolean;
};

/** Native following token and feedback retention; shared leases belong to collaboration. */
class ManipulationFollowSession {
  private readonly state: FollowState = { episode: 0, lastFollowResult: -1, token: null, gesture: null,
    releasedFollow: null, recoveringAuthority: false, feedbackHeld: false };
  private lastSourceTs: number | null = null;
  private lostAt: number | null = null;
  get view(): ReadonlyFacts<FollowState> { return this.state; }

  advanceEpisode(): void { this.state.episode++; }
  begin(selected: boolean): void {
    this.state.releasedFollow = null;
    if (!this.state.token) this.advanceEpisode();
    this.state.gesture = selected ? "planning" : "following";
  }
  stopGesture(): void { this.state.gesture = null; }
  forgetToken(): void { this.state.token = null; }
  authorityLost(): void { this.state.gesture = null; this.state.token = null; }
  authorityRestored(): void { this.state.recoveringAuthority = false; }
  retireReleasedTarget(): void { this.state.releasedFollow = null; this.advanceEpisode(); }

  retainingFeedback(fresh: boolean, now: number): boolean {
    return !fresh && this.lastSourceTs !== null && now - (this.lostAt ?? now) <= 2;
  }
  updateFeedback(view: ARModuleSessionState, group: string | null, fresh: boolean, now: number): void {
    const state = view.manipulation;
    if (view.connection === "ready" && state && state.available !== false && fresh) {
      const ts = state.observations?.[group ?? ""]?.measured_at ?? null;
      if (ts !== this.lastSourceTs) {
        this.lastSourceTs = ts;
      }
      this.lostAt = null;
      return;
    }
    if (this.lastSourceTs === null) return;
    // Freshness remains a native admission guard. The presentation grace starts
    // when loss is observed, rather than spending it on the last sample's age.
    this.lostAt ??= now;
  }

  holdFeedback(disconnected: boolean): { first: boolean; releaseToken: string | null } {
    if (disconnected && this.state.gesture) this.state.recoveringAuthority = true;
    if (this.state.feedbackHeld) return { first: false, releaseToken: null };
    this.state.feedbackHeld = true;
    return { first: true, releaseToken: disconnected ? null : this.state.token };
  }

  feedbackReleaseSent(): void {
    this.state.token = null;
    this.advanceEpisode();
  }

  recoverFeedback(fresh: boolean): boolean {
    if (!this.state.feedbackHeld || !fresh) return false;
    this.state.feedbackHeld = false;
    return true;
  }

  clearFeedback(): void {
    this.lastSourceTs = null;
    this.lostAt = null;
    this.state.feedbackHeld = false;
    this.state.recoveringAuthority = false;
  }

  finish(complete: boolean, target: ManipulationPose | null, epoch: string | null,
    shared: ReturnType<InteractionAuthorityPort["snapshot"]>): void {
    const canonical = shared.rawTarget;
    this.state.releasedFollow = complete && this.state.gesture === "following" && this.state.token && target ? {
      token: this.state.token, episode: this.state.episode, pose: target, epoch,
      lease: shared.authority?.lease_id ?? null,
      canonical: canonical ? { pose: canonical, revision: canonical.revision, sequence: canonical.sequence } : null,
      finalSequence: null,
    } : null;
    this.state.gesture = null;
    this.state.token = null;
  }

  released(finalSequence: number | null): void {
    if (this.state.releasedFollow) this.state.releasedFollow.finalSequence = finalSequence;
  }

  resultScope(shared: ReturnType<InteractionAuthorityPort["snapshot"]>, target: ManipulationPose | null,
    epoch: string | null, stopped: boolean): { token: string | null; releasedCurrent: boolean } {
    const released = this.state.releasedFollow;
    const canonical = shared.rawTarget;
    const sameTarget = !!released && !!canonical && !!released.canonical && (
      canonical.revision === released.canonical.revision && canonical.sequence === released.canonical.sequence &&
        !poseChanged(canonical, released.canonical.pose, 1e-6, 1e-6) ||
      canonical.sequence === released.finalSequence && canonical.revision <= released.canonical.revision + 1 &&
        !poseChanged(canonical, released.pose, 1e-6, 1e-6));
    const releasedCurrent = !!released && released.episode === this.state.episode && !this.state.gesture &&
      !stopped && sameTarget && !!target && !poseChanged(released.pose, target, 1e-6, 1e-6) &&
      released.epoch === epoch && (!shared.authority || shared.authority.lease_id === released.lease);
    return { token: this.state.token ?? (releasedCurrent ? released!.token : null), releasedCurrent };
  }

  acceptUpdate(result: ManipulationResult, token: string | null, group: string | null): boolean {
    if (!token || !result.request_id.startsWith(`shared-follow-${token}-`) || result.group_id !== group ||
      result.sequence == null || result.sequence <= this.state.lastFollowResult) return false;
    this.state.lastFollowResult = result.sequence;
    return true;
  }

  tokenRetired(): void { this.state.token = null; this.state.lastFollowResult = -1; }
  acceptAcquire(token: string | undefined): void {
    if (!token) this.stopGesture();
    else if (this.state.gesture === "following") {
      this.state.token = token;
      this.state.lastFollowResult = -1;
    }
  }

  reset(): void {
    this.state.releasedFollow = null;
    this.authorityLost();
    this.clearFeedback();
  }
}

/** Local execution correlation only; observed robot execution remains a session fact. */
class ManipulationExecutionIntent {
  private readonly state: { generation: number | null; operation: string | null;
    latch: { at: number; operation: string | null } | null; afterPlan: boolean } = {
      generation: null, operation: null, latch: null, afterPlan: false,
    };
  get view(): ReadonlyFacts<typeof this.state> { return this.state; }
  cancelAutomaticExecution(): void { this.state.afterPlan = false; }
  awaitPlan(pending: boolean): void { this.state.afterPlan = pending; }
  begin(generation: number, at: number): void {
    this.state.latch = { at, operation: null };
    this.state.generation = generation;
  }
  reset(): void {
    this.state.latch = null;
    this.state.generation = null;
    this.state.operation = null;
    this.state.afterPlan = false;
  }

  observe(state: ARModuleSessionState["manipulation"], pending: boolean, draftGeneration: number,
    canComplete: boolean, reachedGoal: boolean): "completed" | "aborted" | null {
    const latch = this.state.latch;
    if (latch && !pending && state?.ts != null && state.ts > latch.at &&
      (!latch.operation || !state.operation_id || state.operation_id === latch.operation) &&
      !["accepted", "executing"].includes(state.execution ?? "")) this.state.latch = null;
    if (canComplete && state?.execution === "completed" && this.state.latch === null && !pending &&
      this.state.generation === draftGeneration &&
      (this.state.operation !== null && state.operation_id === this.state.operation || reachedGoal)) {
      this.state.generation = null;
      return "completed";
    }
    if (state?.execution === "aborted" && this.state.operation !== null &&
      state.operation_id === this.state.operation && !pending) {
      this.state.afterPlan = false;
      this.state.generation = null;
      this.state.operation = null;
      return "aborted";
    }
    return null;
  }

  accept(result: ManipulationResult, now: number): boolean {
    if (result.status !== "accepted") {
      this.state.latch = null;
      return false;
    }
    if (this.state.latch) {
      this.state.latch = { operation: result.operation_id ?? null, at: now };
      this.state.operation = result.operation_id ?? null;
    }
    return true;
  }
}

/** Portable intent and correlation. Observed execution remains in ARModuleSession. */
export class ManipulationInteraction {
  private readonly draft = new ManipulationDraft();
  private readonly follow = new ManipulationFollowSession();
  private readonly execution = new ManipulationExecutionIntent();
  get retainingFeedback(): boolean {
    const view = this.session.view(), native = view.manipulation;
    if (view.state?.safety?.stopped || native?.stopped || native?.protection?.state === "paused" || native?.protection?.state === "fault") return false;
    return this.follow.retainingFeedback(this.feedbackFresh, this.now());
  }
  private updateFeedback(): void {
    this.follow.updateFeedback(this.session.view(), this.groupId, this.feedbackFresh, this.now());
  }
  private sequence = 0;
  private readonly requests: ManipulationRequests;
  private unsubscribe: () => void;
  diagnostics() { return this.requests.diagnostics(); }
  private stoppedBefore = false;
  private modelRevision: string | null = null;
  private sharedSpeedRevision: number | null = null;
  private selected = false;
  private _groupId: string | null = null;
  get groupId(): string | null { return this._groupId; }
  private set groupId(value: string | null) { this._groupId = value; }
  get target(): ReadonlyFacts<ManipulationPose> | null { return this.draft.view.target; }
  get solution(): Readonly<Record<string, number>> | null { return this.draft.view.solution; }
  get plan(): ReadonlyFacts<ManipulationPlan> | null { return this.draft.view.plan; }
  private _status: string = "";
  get status(): string { return this._status; }
  private set status(value: string) { this._status = value; }
  get speedScale(): number { return this.draft.view.speedScale; }
  get desiredGripper(): number | null { return this.draft.view.desiredGripper; }
  get rejection(): ReadonlyFacts<ManipulationRejection> | null { return this.draft.view.rejection; }
  private reconcilingTarget = false;
  get previewJoints(): Readonly<Record<string, number>> | null { return this.selected && !this.dragging && this.rejection && this.draft.view.plannedJoints ? this.draft.view.plannedJoints : this.draft.view.valid?.joints ?? this.solution; }
  private observedJoints(): Record<string, number> {
    return Object.assign({}, ...Object.values(this.session.view().manipulation?.observations ?? {}).map(o => o.joints ?? {}));
  }
  private get readOnly(): boolean { const view = this.session.view(); return view.manipulation?.read_only === true || view.hello?.source?.read_only === true; }
  private get feedbackAvailable(): boolean { return this.session.view().manipulation?.available !== false; }

  private get followingAtTarget(): boolean {
    const state = this.session.view().manipulation;
    return state?.following === true && state.following_at_target === true && !!this.target && !!state.following_goal && this.feedbackFresh &&
      !poseChanged(this.target, state.following_goal, 0.001, Math.PI / 180);
  }

  /** Compare raw feedback to a backend-validated endpoint, never visual FK/filtering. */
  private reachedValidatedGoal(): boolean {
    if (this.followingAtTarget) return true;
    const state = this.session.view().manipulation, valid = this.draft.view.valid;
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

  private clearDraft(): void {
    this.follow.advanceEpisode();
    this.draft.clear();
    this.execution.cancelAutomaticExecution();
    this.status = "";
  }

  private retireCompletedDraft(): void {
    this.draft.suppressShared(this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined).rawTarget?.revision ?? null);
    this.clearDraft();
  }

  private readonly captureEventLog: { reason: string; at: number; episode: number; sequence: number; status: string }[] = [];
  get captureEvents(): readonly Readonly<{ reason: string; at: number; episode: number; sequence: number; status: string }>[] {
    return this.captureEventLog;
  }
  private traceCaptureEnd(reason: string): void {
    if (!this.dragging && !this.follow.view.token) return;
    this.captureEventLog.push({ reason, at: this.now(), episode: this.follow.view.episode, sequence: this.follow.view.lastFollowResult, status: this.status });
    if (this.captureEventLog.length > 32) this.captureEventLog.shift();
  }
  interrupt(reason = "host interruption"): void { this.end(false, reason); }

  private deferredNative: { action: ManipulationAction; payload: Parameters<typeof encodeManipulation>[3] } | null = null;
  private transientAuthority = false;
  private lastDenial = 0;
  private hasPending(...actions: ManipulationAction[]): boolean {
    return !!this.deferredNative && actions.includes(this.deferredNative.action) || this.requests.has(...actions);
  }
  snapshot(): ManipulationSnapshot {
    const view = this.session.view(), state = view.manipulation, safety = view.state?.safety;
    const offset = !this.followingAtTarget && targetIsOffset(
      this.target,
      state?.observations?.[this.groupId ?? ""]?.pose,
      this.draft.view.offset,
    );
    const planning = this.draft.view.planQueued || this.hasPending("evaluate", "plan");
    const executing =
      this.execution.view.latch !== null ||
      this.hasPending("execute") ||
      !this.finishing && ["accepted", "executing"].includes(state?.execution ?? "");
    const resetting =
      !!state?.operation ||
      this.hasPending("reset_joints");
    const stopped = safety?.stopped === true || state?.stopped === true;
    const fresh = this.feedbackFresh;
    const observedGripper = state?.observations?.[this.groupId ?? ""]?.gripper;
    const gripperDraft =
      this.desiredGripper != null && Math.abs(this.desiredGripper - (state?.observations?.[this.groupId ?? ""]?.gripper_target ?? observedGripper ?? -1)) > .02;
    const shared = this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined);
    const sharedDraft = !!this.target && shared.rawTarget?.phase === "draft" &&
      shared.rawTarget.revision !== this.draft.view.discardedSharedRevision && !this.followingTail;
    return Object.freeze({ blocked: shared.blocked, sharedDraft, ...deriveManipulationSnapshot({
      readOnly: this.readOnly,
      available: this.available && this.feedbackAvailable && !shared.blocked,
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
      stopConfirmed: safety ? safety.can_resume : state?.stop_confirmed === true && state?.protection?.state !== "fault" && (state?.protection?.state !== "paused" || state.protection.resumable === true),
      pendingControl: this.hasPending("cancel", "resume", "gripper"),
      following: this.following,
      followingSettled: this.followingAtTarget,
      rejection: this.rejection !== null,
      status: this.status,
      runtimeMessage: state?.message,
    }), retainingFeedback: this.retainingFeedback});
  }
  private updateOffset(): void {
    this.draft.updateOffset(this.session.view().manipulation?.observations?.[this.groupId ?? ""]?.pose);
  }
  setSpeedScale(value: number): void {
    if (this.readOnly) return;
    if (
      this.snapshot().blocked ||
      !Number.isFinite(value) ||
      this.snapshot().executing ||
      this.snapshot().resetting
    )
      return;
    const next = Math.max(0.05, Math.min(1, value));
    if (next === this.speedScale) return;
    this.draft.changeSpeed(next, this.selected && !this.dragging);
    if (this.target) this.publishSettings();
    this.execution.cancelAutomaticExecution();
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
    > & Partial<Pick<ARModuleSession, "assetTransferDeadline" | "requestResumeOperation">> & { collaboration: InteractionAuthorityPort },
    private readonly now: () => number,
  ) {
    if (!session.collaboration) throw new Error("Manipulation requires interaction authority");
    this.requests = new ManipulationRequests(now, id => session.assetTransferDeadline?.(id));
    this.unsubscribe = session.subscribeOutbound((message) => {
      if (message.type === "manipulation_result") this.accept(message);
    });
  }

  get dragging(): boolean {
    return this.follow.view.gesture !== null;
  }
  get following(): boolean {
    return this.follow.view.gesture === "following" || this.finishing;
  }
  get finishing(): boolean {
    return this.followingTail?.status === "finishing";
  }
  private get followingTail() {
    const shared = this.session.collaboration.raw();
    const tail = shared?.following_tail;
    return !this.follow.view.gesture && !shared?.authority && tail?.group_id === this.groupId ? tail : null;
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
      this.clearDraft();
    }
    this.selected = selected;
  }

  selectGroup(group: string): void {
    if (this.groupId === group) return;
    this.cancel();
    this.groupId = group;
    this.sharedSpeedRevision = null;
    this.draft.changeGroup();
  }

  begin(): boolean {
    if (this.readOnly) return false;
    if (this.reconcilingTarget) {
      this.session.collaboration.cancel(["manipulation_planning"]);
      this.reconcilingTarget = false;
    }
    if (
      !this.available ||
      !this.feedbackAvailable ||
      !this.feedbackFresh ||
      !this.groupId ||
      this.follow.view.gesture ||
      this.snapshot().stopped ||
      this.snapshot().executing ||
      this.snapshot().resetting ||
      this.hasPending("cancel", "resume") ||
      (!this.selected && this.hasPending("plan"))
    )
      return false;
    if (!this.selected && !this.session.view().manipulation?.groups?.find(group => group.id === this.groupId)?.following) {
      this.status = "Following unavailable";
      return false;
    }
    if (!this.ensureAuthority(this.selected ? "manipulation_planning" : "manipulation_following")) return false;
    this.transientAuthority = false;
    this.follow.begin(this.selected);
    this.draft.beginGesture(this.session.view().manipulation?.observations?.[this.groupId]?.pose ?? null,
      this.solution ?? this.observedJoints(), this.sequence);
    if (this.deferredNative?.action === "plan") this.deferredNative = null;
    if (this.follow.view.gesture === "following" && !this.follow.view.token) this.send("acquire");
    return true;
  }

  aim(pose: ManipulationPose): void {
    if (!this.follow.view.gesture) return;
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
      this.draft.view.rejectedTarget &&
      pose.position.every(
        (v, i) => Math.abs(v - this.draft.view.rejectedTarget!.position[i]) < 0.005,
      ) &&
      pose.orientation.every(
        (v, i) => Math.abs(v - this.draft.view.rejectedTarget!.orientation[i]) < 0.01,
      )
    )
      return;
    this.draft.aim(pose, this.follow.view.gesture === "planning");
    this.session.collaboration.update(pose, this.sharedSettings());
    this.updateOffset();
    if (this.follow.view.gesture === "planning") {
      this.execution.cancelAutomaticExecution();
      if (
        !targetIsOffset(
          this.target,
          this.session.view().manipulation?.observations?.[this.groupId ?? ""]
            ?.pose,
          this.draft.view.offset,
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
      this.status = "No feedback";
      const hold = this.follow.holdFeedback(view.connection !== "ready");
      if (hold.first) {
        this.requests.retireAcquisitions();
        if (hold.releaseToken) this.send("release", { token: hold.releaseToken });
        this.follow.feedbackReleaseSent();
        this.requests.retainRelease();
      }
      return;
    }
    const recovered = this.follow.recoverFeedback(this.feedbackFresh);
    if (recovered) {
      this.draft.feedbackRecovered(this.selected && !this.dragging);
      this.execution.cancelAutomaticExecution();
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
    this.reconcileSharedTarget(view);
    this.draft.observeTail(this.followingTail);
    const groups = view.manipulation?.groups ?? [];
    if (!this.groupId && groups.length === 1) this.groupId = groups[0].id;
    if (view.manipulation?.available !== false && this.groupId && !groups.some((g) => g.id === this.groupId))
      this.reset();
    const execution = this.execution.observe(view.manipulation, this.hasPending("execute"),
      this.draft.view.generation, this.selected && !this.dragging, this.reachedValidatedGoal());
    if (execution === "completed") this.retireCompletedDraft();
    if (execution === "aborted") {
      this.draft.retirePlan();
      this.status = view.manipulation?.message ?? "Target not reached";
    }
    if (this.follow.view.gesture === "following" && !this.follow.view.token && this.feedbackFresh && !view.state?.safety?.stopped && !view.manipulation?.stopped && !this.hasPending("acquire", "release")) this.send("acquire");
    const stopped = view.state?.safety?.stopped === true || view.manipulation?.stopped === true;
    if (stopped && !this.stoppedBefore) this.discard("server stopped");
    this.stoppedBefore = stopped;
    for (const request of this.requests.expired()) {
      if (request.action === "release") {
        this.follow.stopGesture();
        this.status = "Following release timed out";
      }
      if (request.episode !== this.follow.view.episode) continue;
      this.status =
        request.action === "execute"
          ? "Execution response timed out; checking robot state"
          : "Request timed out";
      if (["plan", "evaluate"].includes(request.action) && this.draft.advisoryTimedOut(request.generation, this.status)) {
        // Advisory failures retire planning intent without ending a held gesture.
        this.execution.cancelAutomaticExecution();
      }
    }
    if (this.follow.view.gesture !== null && !this.feedbackFresh) {
      this.status = "Joint feedback is stale";
      this.cancel("feedback stale");
    }
    this.updateOffset();
    const intent = this.snapshot();
    if (
      !intent.hasDraft &&
      !this.dragging &&
      !intent.executing &&
      !intent.resetting
    ) {
      this.draft.abandonPlanning();
      this.execution.cancelAutomaticExecution();
    }
    if (
      this.draft.view.planQueued && !this.dragging &&
      !this.snapshot().blocked &&
      this.selected &&
      this.feedbackAvailable &&
      this.feedbackFresh &&
      !stopped &&
      !intent.executing &&
      !intent.resetting &&
      !this.hasPending("plan", "cancel", "resume")
    ) {
      this.draft.consumePlanIntent();
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
      this.draft.view.planGeneration !== this.draft.view.generation &&
      this.feedbackAvailable &&
      this.feedbackFresh &&
      !stopped &&
      !intent.executing &&
      !intent.resetting &&
      (!this.draft.view.planQueued || this.dragging) &&
      (this.dragging || !this.hasPending("plan")) &&

      this.follow.view.gesture !== "following" &&
      !this.deferredNative &&
      this.draft.view.evaluatedGeneration !== this.draft.view.generation &&
      now - this.draft.view.lastEvaluation >= MANIPULATION_PLAN_INTERVAL_S &&
      !this.requests.has("evaluate", "cancel", "resume")
    ) {
      this.draft.evaluated(now);
      this.send("evaluate", this.target);
    }
  }

  private reconcileSharedTarget(view: ARModuleSessionState): void {
    const collaboration = this.session.collaboration;
    if (this.groupId) {
      if (this.follow.view.recoveringAuthority && this.follow.view.gesture && !view.manipulation?.stopped && !collaboration.snapshot("manipulation", this.groupId).blocked) {
        this.ensureAuthority(this.follow.view.gesture === "following" ? "manipulation_following" : "manipulation_planning");
      }
      const shared = collaboration.snapshot("manipulation", this.groupId);
      if (!shared.pending && !shared.ownsAuthority) this.reconcilingTarget = false;
      if (shared.ownsAuthority) this.follow.authorityRestored();
      if (this.lastDenial !== collaboration.denialRevision || shared.blocked || this.follow.view.gesture !== null && !shared.ownsAuthority && !shared.pending && !this.follow.view.recoveringAuthority) {
        this.follow.authorityLost();
        this.deferredNative = null;
        this.draft.cancelQueuedPlan();
        this.execution.cancelAutomaticExecution();
      }
      this.lastDenial = collaboration.denialRevision;
      if (this.transientAuthority && this.deferredNative &&
          ["plan", "execute", "evaluate"].includes(this.deferredNative.action) &&
          shared.ownsAuthority && shared.rawTarget && !shared.settling) {
        // Preview/Execute operate on the exact checked target, never on the
        // observer's interpolated presentation pose.
        this.draft.adoptCanonical(shared.rawTarget);
      }
      if (!this.follow.view.gesture && !shared.ownsAuthority && !shared.pending &&
          shared.rawTarget?.revision !== this.draft.view.discardedSharedRevision) {
        this.draft.observeShared(shared, view.manipulation, this.groupId, this.busy,
          shared.settling || shared.rawTarget?.revision !== this.sharedSpeedRevision);
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
  }

  end(complete = true, reason = complete ? "input released" : "interrupted"): void {
    this.traceCaptureEnd(reason);
    if (complete && this.follow.view.gesture === null) return;
    const failed = this.draft.view.rejectedTarget === this.target || this.rejection?.pose === this.target;
    if (complete && failed && this.target) this.restoreValidTarget();
    const planOnRelease = this.follow.view.gesture === "planning" && !!this.target;
    if (planOnRelease) {
      this.draft.recordRelease();
      if (this.draft.view.rejectedTarget === this.target) this.restoreValidTarget();
    }
    const shared = this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined);
    this.follow.finish(complete, this.target, this.session.collaboration.raw()?.epoch ?? null, shared);
    this.deferredNative = null;
    if (complete) {
      // The server atomically hands its validated endpoint to a takeoverable tail.
      // Retire editing rights immediately: no post-release native token heartbeat.
      const finalSequence = this.session.collaboration.release(this.target ?? undefined, ["manipulation_planning", "manipulation_following"]);
      this.follow.released(finalSequence ?? null);
    } else {
      this.session.collaboration.cancel(["manipulation_planning", "manipulation_following"]);
      this.reconcilingTarget = false;
    }
    if (planOnRelease && complete && this.snapshot().hasDraft && this.feedbackFresh && this.draft.view.planGeneration !== this.draft.view.generation) {
      this.draft.queueReleasedPlan();
      this.status = "Planning";
    }
    this.requests.retireAcquisitions();
  }

  requestPlan(): void {
    if (this.readOnly) return;
    if (
      !this.selected ||
      this.snapshot().blocked ||
      !this.target ||
      !this.snapshot().hasDraft ||
      !this.feedbackFresh ||
      this.snapshot().stopped ||
      this.snapshot().executing ||
      this.snapshot().resetting ||
      this.following
    )
      return;
    if (this.dragging) this.interrupt();
    this.execution.cancelAutomaticExecution();
    this.draft.requestPlan();
    this.status = "Planning";
  }
  execute(): void {
    if (this.readOnly) return;
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
    if (!this.plan || this.draft.view.planGeneration !== this.draft.view.generation) {
      this.requestPlan();
      this.execution.awaitPlan(this.draft.view.planQueued || this.hasPending("plan"));
      return;
    }
    this.status = "Moving";
    this.draft.consumePlanIntent();
    this.execution.begin(this.draft.view.generation, this.serverNow());
    this.send("execute", { plan_id: this.plan.plan_id });
  }
  cancel(reason = "cancel requested"): void {
    this.discard(reason);
    if (this.groupId && this.available && !this.hasPending("cancel"))
      this.send("cancel");
  }
  /** Retire local intent immediately; emergency stop itself uses the session command. */
  discard(reason = "intent discarded"): void {
    this.draft.suppressShared(this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined).rawTarget?.revision ?? null);
    this.follow.clearFeedback();
    this.interrupt(reason);
    this.execution.reset();
    this.clearDraft();
  }
  invalidateTarget(): void {
    if (
        !this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined).ownsAuthority) {
      this.discard("observer suspended");
      this.draft.suppressShared(null);
      return;
    }
    this.cancel();
    this.draft.invalidateTarget();
  }
  resume(): void {
    this.follow.forgetToken();
    if (this.session.view().state?.safety) this.session.requestResumeOperation?.();
    else this.send("resume");
  }
  setGripper(value: number): void {
    if (this.readOnly) return;
    if (
      !Number.isFinite(value) || value < 0 || value > 1 ||
      this.snapshot().blocked ||
      !this.feedbackFresh ||
      this.snapshot().stopped ||
      this.snapshot().executing ||
      this.snapshot().resetting
    )
      return;
    this.draft.changeGripper(value, this.session.view().manipulation?.observations?.[this.groupId ?? ""]?.pose ?? null);
    if (this.selected) {
      this.updateOffset();
      if (this.target) this.publishSettings();
      this.draft.planGripperChange(this.snapshot().targetOffset && this.target !== null && this.follow.view.gesture === null);
      this.execution.cancelAutomaticExecution();
      return;
    }
    if (this.target) this.session.collaboration.update(this.target, this.sharedSettings());
    this.send("gripper", { value });
  }
  reset(): void {
    if (this.reconcilingTarget) this.session.collaboration.cancel(["manipulation_planning"]);
    this.reconcilingTarget = false;
    this.follow.reset();
    this.modelRevision = null;
    this.sharedSpeedRevision = null;
    this.draft.suppressShared(null);
    this.execution.reset();
    this.requests.clear();
    this.deferredNative = null; this.transientAuthority = false;
    this.clearDraft();
    this.groupId = null;
    this.stoppedBefore = false;
  }
  dispose(): void {
    this.interrupt();
    this.unsubscribe();
    this.reset();
  }

  private publishSettings(): void {
    const collaboration = this.session.collaboration;
    if (!this.target) return;
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
    if (collaboration.snapshot("manipulation", this.groupId ?? undefined).ownsAuthority) return true;
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
    const credentials = collaboration.credentials();
    if (!credentials) throw new Error("Manipulation command requires interaction authority");
    const target = collaboration.snapshot("manipulation", this.groupId ?? undefined).rawTarget;
    return { ...credentials, ...(target ? { target_revision: target.revision } : {}) };
  }
  private restoreValidTarget(): void {
    const collaboration = this.session.collaboration;
    const shared = collaboration.snapshot("manipulation", this.groupId ?? undefined);
    if (shared.blocked || this.session.view().manipulation?.stopped) return;
    this.draft.restoreValidTarget();
    this.follow.retireReleasedTarget();
    this.execution.cancelAutomaticExecution();
    this.draft.planRestoredTarget(this.selected && this.snapshot().hasDraft);
    if (!this.dragging && !shared.ownsAuthority && this.target &&
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
    const unownedCancel = action === "cancel" && collaboration.raw()?.authority === null;
    if (!unownedCancel && !collaboration.snapshot("manipulation", this.groupId).ownsAuthority) {
      if (action === "release") { collaboration.cancel(["manipulation_planning", "manipulation_following"]); return; }
      if (!this.ensureAuthority(this.follow.view.gesture === "following" ? "manipulation_following" : "manipulation_planning",
          ["plan", "evaluate", "execute", "gripper", "acquire", "update"].includes(action))) return;
      this.transientAuthority = this.follow.view.gesture === null;
      this.deferredNative = { action, payload };
      return;
    }
    if (["plan", "execute"].includes(action) || action === "gripper" && this.selected) {
      const shared = collaboration.snapshot("manipulation", this.groupId);
      const desired = this.target ?? this.session.view().manipulation?.observations?.[this.groupId]?.pose;
      const canonical = shared.rawTarget;
      const agrees = desired && canonical && !poseChanged(desired, canonical, 1e-6, 1e-6) &&
        Math.abs((canonical.speed_scale ?? this.speedScale) - this.speedScale) < 1e-8 &&
        (this.desiredGripper === null || canonical.gripper === this.desiredGripper);
      if (!agrees) {
        if (desired) collaboration.update(desired, this.sharedSettings());
        this.deferredNative = { action, payload }; return;
      }
    }
    const id = `manipulation-${++this.sequence}`;
    this.requests.track(id, {
      action,
      order: this.sequence,
      generation: this.draft.view.generation,
      episode: this.follow.view.episode,
      epoch: collaboration.raw()?.epoch ?? null,
      lease: collaboration.snapshot("manipulation", this.groupId).authority?.lease_id ?? null,
      group: this.groupId,
      speed: this.speedScale,
      gripper: this.desiredGripper,
      pose: payload.position && payload.orientation ? { position: [...payload.position], orientation: [...payload.orientation] } : this.target,
    });
    this.session.sendText(
      encodeManipulation(id, action, this.groupId, { ...payload, ...(unownedCancel
        ? { epoch: collaboration.raw()!.epoch, lease_id: "unowned", sequence: ++this.sequence }
        : this.authorityFields()) }),
    );
  }
  private accept(result: ManipulationResult): void {
    const shared = this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined);
    const scope = this.follow.resultScope(shared, this.target, this.session.collaboration.raw()?.epoch ?? null,
      this.session.view().manipulation?.stopped === true);
    if (result.action === "update" && this.follow.acceptUpdate(result, scope.token, this.groupId)) {
      const sample = result.sample_pose ?? result.pose;
      const currentSample = !!sample && !!this.target && !poseChanged(sample, this.target, 0.005, Math.PI / 120);
      if (result.status === "feasible" && result.joints && result.pose) {
        this.draft.acceptFollowResult(result, ++this.sequence, currentSample, this.observedJoints());
      }
      if (currentSample && (result.status === "infeasible" ||
          ["ik_failed", "joint_limit", "collision"].includes(result.code ?? ""))) {
        this.status = shortManipulationStatus(result.code || result.message || "IK failed");
        this.draft.rejectTarget(this.status, result.failed_joints);
        if (scope.releasedCurrent) this.restoreValidTarget();
      }
      if (result.status === "rejected" && result.code === "retired" &&
          this.follow.view.gesture === "following" && !this.session.view().manipulation?.stopped &&
          this.session.collaboration.snapshot("manipulation", this.groupId ?? undefined).ownsAuthority) {
        this.follow.tokenRetired();
      }
      return;
    }
    if (this.retainingFeedback && result.action !== "release") return;
    const request = this.requests.take(result);
    if (!request) return;
    if (request.episode !== this.follow.view.episode) return;
    if (request.epoch !== this.session.collaboration.raw()?.epoch ||
        shared.authority && shared.authority.lease_id !== request.lease) return;
    if (["evaluate", "plan"].includes(result.action) &&
        (request.epoch !== this.session.collaboration.raw()?.epoch ||
         shared.authority && shared.authority.lease_id !== request.lease ||
         this.session.view().manipulation?.stopped ||
         !this.follow.view.gesture && !shared.ownsAuthority && !!this.target &&
           (!shared.rawTarget || poseChanged(this.target, shared.rawTarget, 1e-6, 1e-6)))) return;
    if (result.action === "plan" &&
        (!shared.ownsAuthority || shared.authority?.lease_id !== request.lease)) return;
    if (result.action === "plan" && (request.generation !== this.draft.view.generation ||
        request.speed !== this.speedScale || request.gripper !== this.desiredGripper ||
        shared.settling)) return;
    if (result.action === "release") {
      if (result.status !== "released" && result.code !== "retired") {
        this.follow.stopGesture();
        this.status = "Following release failed";
      }
    }
    if (result.action === "release" && !this.follow.view.feedbackHeld || this.transientAuthority && !this.follow.view.gesture) {
      if (["reset_joints", "resume", "cancel", "prepare_shutdown"].includes(result.action))
        this.session.collaboration.cancel(["manipulation_planning", "manipulation_following"]);
      else this.session.collaboration.release(this.target ?? undefined, ["manipulation_planning", "manipulation_following"]);
      this.transientAuthority = false;
    }
    if (result.action === "release") return;
    if (request.episode !== this.follow.view.episode) return;
    if (
      request.generation !== this.draft.view.generation &&
      !["plan", "evaluate"].includes(result.action) &&
      !(result.action === "acquire" && this.following)
    ) {
      return;
    }
    if (request.generation === this.draft.view.generation)
      this.status = shortManipulationStatus(
        result.code || result.message || result.status,
      );
    if (result.action === "acquire" && result.token) this.follow.acceptAcquire(result.token);
    const advisory = this.draft.acceptAdvisory(result, request, this.observedJoints());
    if (advisory.restoreReleased) {
      this.restoreValidTarget();
      return;
    }
    if (advisory.failed) this.execution.cancelAutomaticExecution();
    if (result.action === "plan") { this.acceptPlan(result, request); return; }
    if (result.action === "execute" && this.execution.accept(result, this.serverNow())) this.draft.retirePlan();
    if (result.action === "gripper" && result.status === "completed") this.draft.completeGripper();
    if (result.action === "acquire" && !result.token) this.follow.acceptAcquire(undefined);
  }
  private acceptPlan(result: ManipulationResult, request: ManipulationRequest): void {
    const accepted = this.draft.acceptPlan(result, request, this.observedJoints(), !this.dragging && this.snapshot().hasDraft);
    if (accepted === "failed") this.execution.cancelAutomaticExecution();
    if (accepted === "current" && this.execution.view.afterPlan) {
      this.execution.cancelAutomaticExecution();
      this.execute();
    }
  }

}

export type ManipulationControlAction = "reset" | "estop" | "plan" | "execute" | "cancel" | "stop" | "resume" | "group" | "gripper";

/** Shared user commands; session observations remain the execution authority. */
export class ManipulationController {
  readonly interaction: ManipulationInteraction;
  readonly presentation = new ManipulationPreviewPlayback();
  private selected = false;
  private suspended = false;
  private target: ReadonlyFacts<ManipulationPose> | null = null;
  private speed = 0.5;
  private group: string | null = null;
  private readonly unsubscribeHealth?: () => void;
  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText" | "subscribeOutbound" | "requestEstop"> & Partial<Pick<ARModuleSession, "subscribeView">> & { collaboration: InteractionAuthorityPort },
    now: () => number, private readonly stop: () => void = () => session.requestEstop()) {
    this.interaction = new ManipulationInteraction(session, now);
    this.unsubscribeHealth = session.subscribeView?.(view => { if (view.manipulationError && !this.interaction.retainingFeedback) this.suspend(); });
  }
  setSelected(selected: boolean): void {
    if (selected !== this.selected) this.presentation.reset();
    this.selected = selected; this.interaction.setSelected(selected);
  }
  action(action: ManipulationControlAction): void {
    const interaction = this.interaction;
    switch (action) {
      case "estop": this.presentation.reset(); interaction.discard(); this.stop(); break;
      case "reset": this.presentation.reset(); interaction.resetJoints(); break;
      case "plan": if (!interaction.snapshot().canPreview) break; this.presentation.togglePreview(); if (this.presentation.previewRequested && !interaction.plan) interaction.requestPlan(); break;
      case "execute": this.presentation.reset(); interaction.execute(); break;
      case "stop":
      case "cancel": this.presentation.reset(); interaction.cancel(); break;
      case "resume": interaction.resume(); break;
      case "group": {
        const groups = this.session.view().manipulation?.groups ?? [];
        const index = groups.findIndex(group => group.id === interaction.groupId);
        if (groups.length) { this.presentation.reset(); interaction.selectGroup(groups[(index + 1) % groups.length].id); }
        break;
      }
      case "gripper": {
        const opening = interaction.desiredGripper != null ? interaction.desiredGripper
          : this.session.view().manipulation?.observations?.[interaction.groupId ?? ""]?.gripper_target ?? this.session.view().manipulation?.observations?.[interaction.groupId ?? ""]?.gripper;
        if (opening != null) { this.presentation.reset(); interaction.setGripper(opening < 0.5 ? 1 : 0); }
        break;
      }
    }
  }
  tick(enabled = true): void {
    if (this.session.view().manipulationError) enabled = false;
    if (!enabled && this.interaction.retainingFeedback) { this.interaction.tick(); return; }
    if (!enabled) { this.suspend(); this.interaction.tick(); return; }
    this.suspended = false;
    const interaction = this.interaction;
    const target = interaction.target;
    const targetChanged = this.target === null || target === null ? this.target !== target
      : !poseCoordinatesEqual(this.target, target, 0);
    if (targetChanged || this.speed !== interaction.speedScale || this.group !== interaction.groupId) this.presentation.reset();
    this.target = target;
    this.speed = interaction.speedScale;
    this.group = interaction.groupId;
    interaction.tick();
  }
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.presentation.reset();
    if (this.interaction.dragging || this.interaction.busy || this.interaction.target || this.interaction.plan)
      this.interaction.invalidateTarget();
    else this.interaction.interrupt();
  }
  dispose(): void { this.unsubscribeHealth?.(); this.suspend(); this.interaction.dispose(); }
}
