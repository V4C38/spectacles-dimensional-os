import type { ARModuleSession } from "../websocket/arModuleSession";
import type {
  ManipulationAction,
  ManipulationPlan,
  ManipulationPose,
  ManipulationResult,
} from "./ManipulationTypes";
import { encodeManipulation } from "./ManipulationProtocol";

export const MANIPULATION_PLAN_INTERVAL_S = 0.35;
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
  readonly planning: boolean;
  readonly executing: boolean;
  readonly resetting: boolean;
  readonly stopped: boolean;
  readonly fresh: boolean;
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
  rejection: boolean;
  status: string;
  runtimeMessage?: string | null;
}

export function deriveManipulationSnapshot(
  facts: ManipulationFacts,
): ManipulationSnapshot {
  const canManipulate =
    facts.available &&
    facts.fresh &&
    !facts.stopped &&
    !facts.executing &&
    !facts.resetting &&
    !facts.pendingControl;
  const ready = canManipulate && !facts.planning && !facts.dragging;
  const hasDraft = facts.targetOffset || facts.gripperDraft;
  let activity = "Idle";
  if (!facts.fresh) activity = "No feedback";
  else if (facts.stopped) activity = "Stopped";
  else if (facts.resetting) activity = "Resetting";
  else if (facts.executing) activity = "Moving";
  else if (facts.rejection) activity = shortManipulationStatus(facts.status);
  else if (facts.runtimeMessage)
    activity = shortManipulationStatus(facts.runtimeMessage);
  else if (facts.following) activity = "Moving";
  else if (hasDraft) activity = "Planning";
  return Object.freeze({
    targetOffset: facts.targetOffset,
    hasDraft,
    dragging: facts.dragging,
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
    canStop: !facts.stopped,
    canResume: facts.stopped && facts.fresh && facts.stopConfirmed,
  });
}

/** Portable intent and correlation. Observed execution remains in ARModuleSession. */
export class ManipulationInteraction {
  private sequence = 0;
  private generation = 0;
  private episode = 0;
  private planGeneration = -1;
  private executionLatch: { at: number; operation: string | null } | null =
    null;
  private lastFollowResult = -1;
  private followRequestFloor = 0;
  private pending = new Map<
    string,
    {
      action: ManipulationAction;
      generation: number;
      episode: number;
      group: string;
      deadline: number;
    }
  >();
  private retiredAcquisitions = new Map<string, string>();
  private unsubscribe: () => void;
  private token: string | null = null;
  private tokenSequence = 0;
  private lastUpdate = -Infinity;
  private lastEvaluation = -Infinity;
  private evaluatedGeneration = -1;
  private planQueued = false;
  private lastPlanAt = -Infinity;
  private lastPlanTarget: ManipulationPose | null = null;
  private attemptedGeneration = -1;
  private offset = false;
  private stoppedBefore = false;
  private executeAfterPlan = false;
  private selected = false;
  private gesture: "planning" | "following" | null = null;
  groupId: string | null = null;
  target: ManipulationPose | null = null;
  solution: Record<string, number> | null = null;
  plan: ManipulationPlan | null = null;
  previewPlan: ManipulationPlan | null = null;
  status = "";
  speedScale = 0.2;
  desiredGripper: number | null = null;
  rejection: {
    revision: number;
    pose: ManipulationPose;
    message: string;
  } | null = null;
  private rejectionRevision = 0;
  private rejectedTarget: ManipulationPose | null = null;
  private deferredNative: { action: ManipulationAction; payload: Parameters<typeof encodeManipulation>[3] } | null = null;
  private transientAuthority = false;
  private lastDenial = 0;
  private hasPending(...actions: ManipulationAction[]): boolean {
    return !!this.deferredNative && actions.includes(this.deferredNative.action) || [...this.pending.values()].some((p) => actions.includes(p.action));
  }
  snapshot(): ManipulationSnapshot {
    const state = this.session.view().manipulation;
    const offset = targetIsOffset(
      this.target,
      state?.observations?.[this.groupId ?? ""]?.pose,
      this.offset,
    );
    const planning = this.planQueued || this.hasPending("evaluate", "plan");
    const executing =
      this.executionLatch !== null ||
      this.hasPending("execute") ||
      ["accepted", "executing"].includes(state?.execution ?? "");
    const resetting =
      !!state?.operation ||
      [...this.pending.values()].some(
        (p) => p.action === "reset_joints" && p.generation === this.generation,
      );
    const stopped = state?.stopped === true;
    const fresh = this.feedbackFresh;
    const observedGripper = state?.observations?.[this.groupId ?? ""]?.gripper;
    const gripperDraft =
      this.desiredGripper != null && this.desiredGripper !== observedGripper;
    const blocked = this.session.collaboration?.snapshot("manipulation", this.groupId ?? undefined).blocked ?? false;
    return Object.freeze({ blocked, ...deriveManipulationSnapshot({
      available: this.available && !blocked,
      fresh,
      selected: this.selected,
      targetOffset: offset,
      gripperDraft,
      dragging: this.dragging,
      planning,
      executing,
      resetting,
      stopped,
      stopConfirmed: state?.stop_confirmed === true,
      pendingControl: this.hasPending("cancel", "resume"),
      following: this.following,
      rejection: this.rejection !== null,
      status: this.status,
      runtimeMessage: state?.message,
    }) });
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
    if (this.target) this.session.collaboration?.update(this.target, this.sharedSettings());
    this.generation++;
    this.plan = null;
    this.planGeneration = -1;
    this.planQueued = this.selected && this.target !== null;
    this.executeAfterPlan = false;
  }
  resetJoints(): void {
    if (!this.snapshot().canReset) return;
    this.end();
    this.generation++;
    this.plan = null;
    this.target = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.solution = null;
    this.planQueued = false;
    this.executeAfterPlan = false;
    this.status = "Returning to zero";
    this.send("reset_joints", { speed_scale: this.speedScale });
  }

  constructor(
    private readonly session: Pick<
      ARModuleSession,
      "view" | "sendText" | "subscribeOutbound"
    > & Partial<Pick<ARModuleSession, "collaboration">>,
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
    return this.gesture === "following";
  }
  get busy(): boolean {
    return [...this.pending.values()].some(
      (p) =>
        p.action === "plan" ||
        p.action === "execute" ||
        p.action === "reset_joints",
    );
  }
  get feedbackFresh(): boolean {
    const view = this.session.view(),
      sync = view.hello?.time_sync;
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
    return this.session.view().capabilities?.manipulation?.available === true;
  }

  setSelected(selected: boolean): void {
    if (selected !== this.selected) {
      this.end();
      this.episode++;
      this.generation++;
      this.executeAfterPlan = false;
      this.planQueued = false;
      this.plan = this.previewPlan = null;
      this.solution = null;
      this.target = null;
      this.desiredGripper = null;
      this.rejection = null;
      this.rejectedTarget = null;
      this.offset = false;
      this.lastPlanAt = -Infinity;
      this.lastPlanTarget = null;
    }
    this.selected = selected;
  }

  selectGroup(group: string): void {
    if (this.groupId === group) return;
    this.cancel();
    this.groupId = group;
    this.target = null;
    this.solution = null;
  }

  begin(): boolean {
    if (
      !this.available ||
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
    this.transientAuthority = false;
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
      this.send("acquire");
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
        this.rejection = null;
        this.status = "";
      }
    }
  }

  tick(): void {
    const now = this.now(),
      view = this.session.view();
    if (view.connection !== "ready") {
      this.reset();
      return;
    }
    const collaboration = this.session.collaboration;
    if (collaboration && this.groupId) {
      const shared = collaboration.snapshot("manipulation", this.groupId);
      if (this.lastDenial !== collaboration.denialRevision || shared.blocked || this.gesture !== null && !shared.ownsAuthority && !shared.pending) {
        this.gesture = null; this.token = null; this.deferredNative = null;
        this.planQueued = false; this.executeAfterPlan = false;
      }
      this.lastDenial = collaboration.denialRevision;
      if (this.transientAuthority && shared.ownsAuthority && shared.rawTarget) {
        // Preview/Execute operate on the exact checked target, never on the
        // observer's interpolated presentation pose.
        this.target = {
          position: [...shared.rawTarget.position],
          orientation: [...shared.rawTarget.orientation],
        };
      }
      if (!this.gesture && !shared.ownsAuthority && !shared.pending) {
        if (shared.target === null) this.target = null;
        else if (!this.target || poseChanged(this.target, shared.target, 1e-8, 1e-8)) this.target = shared.target;
        if (shared.rawTarget?.speed_scale !== undefined) this.speedScale = shared.rawTarget.speed_scale;
        if (shared.rawTarget?.gripper !== undefined) this.desiredGripper = shared.rawTarget.gripper;
        const plan = view.manipulation?.plan;
        if (plan && plan.target_revision === shared.rawTarget?.revision && (!plan.group_id || plan.group_id === this.groupId)) {
          this.plan = this.previewPlan = plan; this.planGeneration = this.generation;
        } else if (!this.busy) this.plan = this.previewPlan = null;
      }
      if (this.deferredNative && shared.ownsAuthority) {
        const request = this.deferredNative; this.deferredNative = null;
        if ((request.action === "plan" || request.action === "evaluate") && this.target)
          request.payload = { ...request.payload, ...this.target, speed_scale: this.speedScale };
        this.send(request.action, request.payload);
      }
    }
    const groups = view.manipulation?.groups ?? [];
    if (!this.groupId && groups.length === 1) this.groupId = groups[0].id;
    if (this.groupId && !groups.some((g) => g.id === this.groupId))
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
    const stopped = view.manipulation?.stopped === true;
    if (stopped && !this.stoppedBefore) this.discard();
    this.stoppedBefore = stopped;
    for (const [id, request] of this.pending) {
      if (now < request.deadline) continue;
      this.pending.delete(id);
      if (request.action === "acquire")
        this.retiredAcquisitions.set(id, request.group);
      this.status =
        request.action === "execute"
          ? "Execution response timed out; checking robot state"
          : "Request timed out";
      if (request.action === "plan") this.cancel();
    }
    if (this.gesture !== null && !this.feedbackFresh) {
      this.status = "Joint feedback is stale";
      this.cancel();
    }
    if (
      this.token &&
      this.target &&
      this.gesture === "following" &&
      now - this.lastUpdate >= 1 / 30
    ) {
      this.session.sendText(
        encodeManipulation(
          `follow-${++this.sequence}`,
          "update",
          this.groupId!,
          {
            ...this.target,
            speed_scale: this.speedScale,
            token: this.token,
            sequence: ++this.tokenSequence,
            ts: now,
            ...this.authorityFields(),
          },
        ),
      );
      this.lastUpdate = now;
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
    const livePlanNeeded =
      intent.hasDraft &&
      this.gesture === "planning" &&
      this.target &&
      this.attemptedGeneration !== this.generation &&
      (!this.lastPlanTarget || poseChanged(this.target, this.lastPlanTarget));
    const livePlan =
      livePlanNeeded && now - this.lastPlanAt >= MANIPULATION_PLAN_INTERVAL_S;
    if (
      (this.planQueued || livePlan) &&
      !this.snapshot().blocked &&
      this.selected &&
      this.feedbackFresh &&
      !stopped &&
      !intent.executing &&
      !intent.resetting &&
      !this.hasPending("evaluate", "plan", "cancel", "resume")
    ) {
      this.planQueued = false;
      if (this.target) {
        this.lastPlanAt = now;
        this.lastPlanTarget = this.target;
        this.attemptedGeneration = this.generation;
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
      intent.hasDraft &&
      this.planGeneration !== this.generation &&
      this.feedbackFresh &&
      !stopped &&
      !intent.executing &&
      !intent.resetting &&
      !this.planQueued &&
      !livePlanNeeded &&
      this.gesture !== "following" &&
      !this.deferredNative &&
      this.evaluatedGeneration !== this.generation &&
      now - this.lastEvaluation >= 0.15 &&
      ![...this.pending.values()].some((p) =>
        ["evaluate", "plan", "cancel", "resume"].includes(p.action),
      )
    ) {
      this.send("evaluate", this.target);
      this.evaluatedGeneration = this.generation;
      this.lastEvaluation = now;
    }
  }

  end(): void {
    const planOnRelease = this.gesture === "planning" && !!this.target;
    const following = this.following;
    const wasDragging = this.dragging;
    if (following) {
      this.target = null;
      this.solution = null;
      this.rejection = null;
    }
    this.gesture = null;
    if (following && this.deferredNative?.action === "acquire") this.deferredNative = null;
    if (
      planOnRelease &&
      this.snapshot().hasDraft &&
      this.feedbackFresh &&
      this.planGeneration !== this.generation &&
      ![...this.pending.values()].some(
        (p) => p.action === "plan" && p.generation === this.generation,
      )
    ) {
      this.planQueued = true;
      this.status = "Planning";
    }
    if (this.token) {
      if (this.session.view().connection === "ready") this.send("release", { token: this.token });
      this.token = null;
    }
    if (wasDragging && !following) this.session.collaboration?.release(this.target ?? undefined, ["manipulation_planning", "manipulation_following"]);
    if (wasDragging && following && !this.hasPending("release")) this.session.collaboration?.cancel(["manipulation_planning", "manipulation_following"]);
    for (const [id, request] of this.pending) {
      if (request.action === "acquire") {
        this.retiredAcquisitions.set(id, request.group);
        this.pending.delete(id);
      }
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
    this.end();
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
    if (!this.plan || this.planGeneration !== this.generation) {
      this.requestPlan();
      this.executeAfterPlan = this.planQueued || this.hasPending("plan");
      return;
    }
    this.status = "Moving";
    this.planQueued = false;
    this.executionLatch = { at: this.serverNow(), operation: null };
    this.send("execute", { plan_id: this.plan.plan_id });
  }
  cancel(): void {
    this.discard();
    if (this.groupId && this.available && !this.hasPending("cancel"))
      this.send("cancel");
  }
  /** Retire local intent immediately; emergency stop itself uses the session command. */
  discard(): void {
    this.end();
    this.episode++;
    this.executionLatch = null;
    this.generation++;
    this.executeAfterPlan = false;
    this.planQueued = false;
    this.plan = this.previewPlan = null;
    this.solution = null;
    this.target = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.rejectedTarget = null;
    this.offset = false;
    this.lastPlanTarget = null;
    this.lastPlanAt = -Infinity;
    this.status = "";
  }
  invalidateTarget(): void {
    this.cancel();
    this.target = null;
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
    this.solution = null;
    if (this.selected) {
      this.target ??=
        this.session.view().manipulation?.observations?.[this.groupId ?? ""]
          ?.pose ?? null;
      this.updateOffset();
      this.desiredGripper = value;
      if (this.target) this.session.collaboration?.update(this.target, this.sharedSettings());
      this.planQueued = false;
      this.executeAfterPlan = false;
      if (!this.snapshot().targetOffset) {
        if (!this.session.collaboration) this.desiredGripper = null;
        this.send("gripper", { value });
      } else {
        this.planQueued = this.target !== null && this.gesture === null;
        this.executeAfterPlan = true;
      }
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
    this.gesture = null;
    this.token = null;
    this.episode++;
    this.executionLatch = null;
    this.generation++;
    this.executeAfterPlan = false;
    this.planQueued = false;
    this.plan = this.previewPlan = null;
    this.pending.clear();
    this.retiredAcquisitions.clear();
    this.deferredNative = null; this.transientAuthority = false;
    this.solution = null;
    this.target = null;
    this.groupId = null;
    this.desiredGripper = null;
    this.rejection = null;
    this.status = "";
    this.offset = false;
    this.lastPlanTarget = null;
    this.lastPlanAt = -Infinity;
    this.stoppedBefore = false;
  }
  dispose(): void {
    this.end();
    this.unsubscribe();
    this.reset();
  }

  private sharedSettings() {
    return { group_id: this.groupId ?? undefined, speed_scale: this.speedScale,
      ...(this.desiredGripper === null ? {} : { gripper: this.desiredGripper }) };
  }
  private ensureAuthority(kind: "manipulation_planning" | "manipulation_following"): boolean {
    const collaboration = this.session.collaboration;
    if (!collaboration || collaboration.snapshot("manipulation", this.groupId ?? undefined).ownsAuthority) return true;
    const measured = this.session.view().manipulation?.observations?.[this.groupId ?? ""]?.pose;
    const shared = collaboration.snapshot("manipulation", this.groupId ?? undefined);
    // An existing target survives acquisition. Sending a rendered pose here
    // could replace it while it is still interpolating or awaiting a final ACK.
    const initial = shared.rawTarget ? undefined : this.target ?? measured ?? undefined;
    return collaboration.begin(kind, `manipulation:${this.groupId}`, initial, this.sharedSettings());
  }
  private authorityFields() {
    const collaboration = this.session.collaboration;
    if (!collaboration) return {};
    const credentials = collaboration.credentials();
    const target = collaboration.snapshot("manipulation", this.groupId ?? undefined).rawTarget;
    return { ...credentials, ...(target ? { target_revision: target.revision } : {}) };
  }
  private serverNow(): number {
    const sync = this.session.view().hello?.time_sync;
    return this.now() + (sync ? sync.ts_server - sync.ts_client : 0);
  }
  private send(
    action: ManipulationAction,
    payload: Parameters<typeof encodeManipulation>[3] = {},
  ): void {
    if (!this.groupId || this.session.view().connection !== "ready") return;
    const collaboration = this.session.collaboration;
    if (collaboration && !collaboration.snapshot("manipulation", this.groupId).ownsAuthority) {
      if (action === "release") { collaboration.cancel(["manipulation_planning", "manipulation_following"]); return; }
      if (!this.ensureAuthority(this.gesture === "following" ? "manipulation_following" : "manipulation_planning")) return;
      this.transientAuthority = this.gesture === null;
      this.deferredNative = { action, payload };
      return;
    }
    if (collaboration && ["plan", "evaluate", "execute", "gripper"].includes(action)) {
      const shared = collaboration.snapshot("manipulation", this.groupId);
      const desired = this.target ?? this.session.view().manipulation?.observations?.[this.groupId]?.pose;
      const canonical = shared.rawTarget;
      const agrees = desired && canonical && !poseChanged(desired, canonical, 1e-6, 1e-6) &&
        Math.abs((canonical.speed_scale ?? this.speedScale) - this.speedScale) < 1e-8 &&
        (this.desiredGripper === null || canonical.gripper === this.desiredGripper);
      if (!agrees) {
        if (desired) collaboration.update(desired, this.sharedSettings());
        this.deferredNative = { action, payload };
        return;
      }
    }
    const id = `manipulation-${++this.sequence}`;
    this.pending.set(id, {
      action,
      generation: this.generation,
      episode: this.episode,
      group: this.groupId,
      deadline:
        this.now() +
        (action === "reset_joints" || action === "prepare_shutdown"
          ? 65
          : action === "plan"
            ? 20
            : 5),
    });
    this.session.sendText(
      encodeManipulation(id, action, this.groupId, { ...payload, ...this.authorityFields() }),
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
    if (
      result.action === "update" &&
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
      this.lastFollowResult = result.sequence;
      if (result.status === "feasible") {
        this.solution = result.joints ?? this.solution;
        this.rejection = null;
        this.status = "Moving";
      } else if (result.status === "infeasible") {
        this.status = shortManipulationStatus(
          result.code || result.message || "IK failed",
        );
        if (this.target)
          this.rejection = {
            revision: ++this.rejectionRevision,
            pose: this.target,
            message: this.status,
          };
      } else if (result.status === "rejected") {
        this.status = shortManipulationStatus(result.message || "Check arm");
        this.end();
      }
      return;
    }
    const request = this.pending.get(result.request_id);
    if (
      !request ||
      request.action !== result.action ||
      request.group !== result.group_id
    )
      return;
    this.pending.delete(result.request_id);
    if (this.session.collaboration && (result.action === "release" || this.transientAuthority && !this.gesture)) {
      this.session.collaboration.release(this.target ?? undefined, ["manipulation_planning", "manipulation_following"]);
      this.transientAuthority = false;
    }
    if (request.episode !== this.episode) return;
    if (
      request.generation !== this.generation &&
      result.action !== "plan" &&
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
    if (result.action === "evaluate") {
      if (result.status === "feasible")
        this.solution = result.joints ?? this.solution;
      if (result.status !== "feasible") {
        this.rejectedTarget = this.target;
        if (this.target)
          this.rejection = {
            revision: ++this.rejectionRevision,
            pose: this.target,
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
          message: shortManipulationStatus(
            result.code || result.message || "Plan failed",
          ),
        };
    }
    if (result.action === "execute") {
      if (result.status === "accepted") {
        if (this.executionLatch) {
          this.executionLatch.operation = result.operation_id ?? null;
          this.executionLatch.at = this.serverNow();
        }
        this.plan = null;
      } else this.executionLatch = null;
    }
    if (result.action === "acquire" && !result.token) this.gesture = null;
  }
}

/** Short world labels; detailed runtime messages remain available in diagnostics. */
export function shortManipulationStatus(message: string): string {
  const s = message.toLowerCase();
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
  if (/gripper.*(skipped|fail|confirm)/.test(s)) return "Gripper failed";
  if (/fail|reject/.test(s)) return "Plan failed";
  return "Idle";
}
