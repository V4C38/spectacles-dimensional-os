import type { InteractionCredentials, InteractionKind, InteractionPose, InteractionResult, InteractionState, InteractionSettings, InteractionTarget } from "./CollaborationTypes";
import type { Quat } from "../websocket/protocolTypes";

export const TARGET_SEND_INTERVAL_S = 0.05;
export const AUTHORITY_RENEW_INTERVAL_S = 0.1;
export const REMOTE_INTERPOLATION_S = 0.1;
export const ACTIVE_TARGET_STALE_S = 0.25;
export interface CollaborationPort {
  ready(): boolean; clientId(): string | null; now(): number; send(text: string): void;
}
/** Exact shared facts and presentation-only prediction/interpolation have separate owners. */
export class CollaborationController {
  private state: InteractionState | null = null;
  private serial = 0;
  private sequence = 0;
  private acquisition: string | null = null;
  private acquireRequest: string | null = null;
  private grantRevision: number | null = null;
  private lease: string | null = null;
  private kind: InteractionKind | null = null;
  private prediction: InteractionPose | null = null;
  private queued: InteractionPose | null = null;
  private lastSent = -Infinity;
  private lastRenewed = -Infinity;
  private readonly histories = new Map<string, { samples: { at: number; pose: InteractionPose }[]; revision: number; newestTs: number }>();
  private settings: InteractionSettings = {};
  private lastStateAt = -Infinity;
  private sampleOffset: number | null = null;
  private cancelled = new Set<string>();
  private deferred: { action: "release" | "confirm"; pose?: InteractionPose; targetRevision?: number; grantRevision?: number } | null = null;
  private denial = 0;
  private settling: { acceptedRevision?: number; settings: InteractionSettings; pose: InteractionPose; sequence: number; key: string; requestId: string; epoch: string } | null = null;
  constructor(private readonly port: CollaborationPort) {}

  raw(): InteractionState | null { return this.state; }
  completeAssets(state: InteractionState): boolean {
    if (!this.state || this.state.epoch !== state.epoch || this.state.revision !== state.revision) return false;
    this.state = { ...this.state, preview: state.preview, active_goal: state.active_goal };
    return true;
  }
  get denialRevision(): number { return this.denial; }
  snapshot(nowOrDomain: number | "navigation" | "manipulation" = this.port.now(), groupId?: string) {
    const domain = typeof nowOrDomain === "string" ? nowOrDomain : "navigation";
    const now = typeof nowOrDomain === "number" ? nowOrDomain : this.port.now();
    const rawTarget = this.targetFor(domain, groupId);
    const key = this.targetKey(domain, groupId);
    const predicting = this.domain() === domain && (domain === "navigation" || this.settings.group_id === groupId);
    const authority = this.state?.authority ?? null;
    const sameScope = !!authority && (authority.kind.startsWith("manipulation") ? "manipulation" : "navigation") === domain &&
      (domain === "navigation" || authority.group_id === groupId);
    const ownsAuthority = this.owns() && sameScope;
    const blocked = this.state?.mode === "agent" || this.state?.motion_busy === true ||
      !!authority && (authority.client_id !== this.port.clientId() || !sameScope) || !!this.acquisition && !predicting;
    const target = this.settling?.key === key ? clone(this.settling.pose) : (predicting && this.prediction && (this.acquisition !== null || ownsAuthority))
      ? clone(this.prediction) : this.interpolate(key, now, rawTarget);
    return { blocked, pending: predicting && (this.acquireRequest !== null || this.lease !== null && !ownsAuthority), ownsAuthority, authority,
      planning: authority?.kind === "navigation_planning", mode: this.state?.mode ?? "manual",
      settings: this.settling?.key === key ? { ...this.settling.settings }
        : predicting && this.acquisition !== null ? { ...this.settings }
        : { speed_scale: rawTarget?.speed_scale, gripper: rawTarget?.gripper },
      settling: this.settling?.key === key,
      target, rawTarget, phase: rawTarget?.phase ?? null,
      stale: !!authority?.held && now - this.lastStateAt > ACTIVE_TARGET_STALE_S,
      preview: this.state?.preview ?? null, activeGoal: this.state?.active_goal ?? null };
  }
  apply(state: InteractionState): boolean {
    const previous = this.state;
    if (previous && previous.epoch === state.epoch && state.revision <= previous.revision) return false;
    if (previous && previous.epoch === state.epoch &&
        this.grantRevision !== null && state.revision < this.grantRevision) return false;
    if (previous && previous.epoch !== state.epoch) this.reset();
    if (state.authority && state.authority.client_id !== this.port.clientId() && this.acquisition !== null) {
      if (this.acquireRequest) {
        this.cancelled.add(this.acquireRequest);
        if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.values().next().value!);
      }
      this.clearLocal();
    }
    this.state = state;
    this.lastStateAt = this.port.now();
    const targets = state.targets ?? (state.target ? [state.target] : []);
    for (const target of targets) {
      const key = this.targetKey(target.domain ?? "navigation", target.group_id);
      let history = this.histories.get(key);
      if (!history) { history = { samples: [], revision: -1, newestTs: -Infinity }; this.histories.set(key, history); }
      if (history.revision === target.revision) continue;
      history.revision = target.revision;
      const stamp = target.sample_ts;
      if (stamp >= history.newestTs) {
        const offset = this.port.now() - stamp;
        if (this.sampleOffset === null) this.sampleOffset = offset;
        else if (offset < this.sampleOffset) {
          // A late join may first receive a parked target with an old timestamp.
          // Rebase all samples when a fresher sample provides a tighter clock bound.
          const correction = offset - this.sampleOffset;
          for (const entry of this.histories.values()) for (const sample of entry.samples) sample.at += correction;
          this.sampleOffset = offset;
        }
        history.newestTs = stamp;
        history.samples.push({ at: stamp + this.sampleOffset, pose: clone(target) });
        if (history.samples.length > 8) history.samples.shift();
      }
    }
    if (this.settling && !state.authority) {
      const final = targets.find(target => this.targetKey(target.domain ?? "navigation", target.group_id) === this.settling!.key);
      if (!final && (!this.settling.key.startsWith("manipulation:") ||
          this.settling.acceptedRevision !== undefined && state.revision >= this.settling.acceptedRevision)) this.settling = null;
      else if (final && final.sequence >= this.settling.sequence &&
          (samePose(final, this.settling.pose) || state.following_tail?.group_id === final.group_id) &&
          (this.settling.settings.speed_scale === undefined || final.speed_scale === this.settling.settings.speed_scale) &&
          (this.settling.settings.gripper === undefined || final.gripper === this.settling.settings.gripper)) {
        const history = this.histories.get(this.settling.key);
        if (history) history.samples = [{ at: this.port.now() - REMOTE_INTERPOLATION_S, pose: clone(final) }];
        this.settling = null;
      }
    }
    for (const key of this.histories.keys()) {
      if (!targets.some(t => this.targetKey(t.domain ?? "navigation", t.group_id) === key)) this.histories.delete(key);
    }
    if (this.settling && state.authority && state.authority.client_id !== this.port.clientId()) this.settling = null;
    if (state.authority?.client_id === this.port.clientId() && state.authority.acquisition_id === this.acquisition) {
      this.lease = state.authority.lease_id;
      this.sequence = Math.max(this.sequence, state.authority.sequence);
    } else if (this.lease && !this.acquireRequest &&
        !(this.grantRevision !== null && state.revision < this.grantRevision)) {
      this.clearLocal();
    }
    if (this.grantRevision !== null && state.revision >= this.grantRevision) this.grantRevision = null;
    this.finishDeferred();
    return true;
  }
  accept(result: InteractionResult): void {
    if (this.cancelled.delete(result.request_id)) {
      if (result.status === "accepted" && result.lease_id)
        this.send({ action: "cancel", epoch: result.epoch, lease_id: result.lease_id });
      return;
    }
    if (this.settling?.requestId === result.request_id && this.settling.epoch === result.epoch) {
      if (result.status !== "accepted") { this.settling = null; this.denial++; }
      else if (this.state && this.state.revision >= result.revision &&
          !this.targetFor(this.settling!.key.startsWith("manipulation:") ? "manipulation" : "navigation", this.settling!.settings.group_id)) this.settling = null;
      else this.settling!.acceptedRevision = result.revision;
      return;
    }
    if (result.request_id !== this.acquireRequest) return;
    this.acquireRequest = null;
    if (result.status !== "accepted" || !result.lease_id) {
      this.clearLocal(); this.denial++; return;
    }
    if (this.state && this.state.epoch !== result.epoch) { this.clearLocal(); return; }
    if (this.state && this.state.revision >= result.revision &&
        (this.state.authority?.client_id !== this.port.clientId() ||
         this.state.authority.acquisition_id !== this.acquisition ||
         this.state.authority.lease_id !== result.lease_id)) {
      this.clearLocal(); this.denial++; return;
    }
    this.lease = result.lease_id;
    this.grantRevision = result.revision;
    if (this.deferred) {
      this.deferred.grantRevision = result.revision;
      this.finishDeferred();
    } else this.flush(true);
  }
  begin(kind: InteractionKind, sourceId: string, pose?: InteractionPose, settings: InteractionSettings = {}): boolean {
    if (!this.port.ready() || !this.state || this.snapshot(kind.startsWith("manipulation") ? "manipulation" : "navigation", settings.group_id).blocked) return false;
    if (this.acquisition !== null) return this.kind === kind && this.settings.group_id === settings.group_id;
    this.kind = kind; this.sequence = 0; this.settling = null; this.settings = { ...settings };
    const request = this.id(); this.acquisition = request; this.acquireRequest = request;
    if (pose) this.prediction = clone(pose);
    this.port.send(JSON.stringify({ type: "interaction_request", request_id: request,
      action: "acquire", epoch: this.state.epoch, acquisition_id: request,
      source_id: sourceId, kind, ...this.settings, ...(pose ? clone(pose) : {}) }) + "\n");
    return true;
  }
  update(pose: InteractionPose, settings?: InteractionSettings): void {
    if (this.acquisition === null) return;
    const settingsChanged = settings !== undefined && JSON.stringify({ ...this.settings, ...settings }) !== JSON.stringify(this.settings);
    if (settings) this.settings = { ...this.settings, ...settings };
    if (!settingsChanged && this.prediction && samePose(this.prediction, pose)) return;
    this.prediction = clone(pose); this.queued = clone(pose); this.flush();
  }
  credentials(): InteractionCredentials | null {
    if (!this.lease || !this.state || !this.owns()) return null;
    return { epoch: this.state.epoch, lease_id: this.lease, sequence: ++this.sequence };
  }
  release(pose?: InteractionPose, kinds?: readonly InteractionKind[]): number | null { return this.matchesKinds(kinds) ? this.finish("release", pose) : null; }
  confirm(pose?: InteractionPose, kinds?: readonly InteractionKind[]): void { if (this.matchesKinds(kinds)) this.finish("confirm", pose); }
  cancel(kinds?: readonly InteractionKind[]): void {
    if (!this.matchesKinds(kinds)) return;
    this.settling = null;
    if (this.acquireRequest) {
      this.cancelled.add(this.acquireRequest);
      if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.values().next().value!);
      this.send({ action: "cancel_acquire", acquisition_id: this.acquisition });
    } else if (this.lease && this.state) this.send({ action: "cancel", epoch: this.state.epoch, lease_id: this.lease });
    this.clearLocal();
  }
  setMode(mode: "manual" | "agent"): void {
    if (this.state?.mode !== mode && this.acquisition !== null) this.cancel();
    this.send({ action: "mode", mode });
  }
  requestSnapshot(): void { this.send({ action: "snapshot" }); }
  tick(): void {
    if (!this.port.ready()) return;
    const now = this.port.now();
    this.flush();
    if (this.lease && this.state && now - this.lastRenewed >= AUTHORITY_RENEW_INTERVAL_S) {
      this.send({ action: "renew", epoch: this.state.epoch, lease_id: this.lease });
      this.lastRenewed = now;
    }
    this.flush();
  }
  reset(): void { this.settling = null; this.clearLocal(); this.state = null; this.histories.clear(); this.sampleOffset = null; this.lastStateAt = -Infinity; this.cancelled.clear(); }
  private owns(): boolean {
    return !!this.state?.authority && this.state.authority.client_id === this.port.clientId() &&
      (this.lease === this.state.authority.lease_id || this.acquisition === this.state.authority.acquisition_id);
  }
  private matchesKinds(kinds?: readonly InteractionKind[]): boolean { return kinds === undefined || this.kind !== null && kinds.includes(this.kind); }
  private finishDeferred(): void {
    const pending = this.deferred;
    if (!pending || !this.lease || pending.grantRevision === undefined) return;
    if (pending.targetRevision !== undefined) {
      if (!this.state || this.state.revision < pending.grantRevision) return;
      if (!this.owns() || this.targetFor(this.domain(), this.settings.group_id)?.revision !== pending.targetRevision) {
        this.send({ action: "cancel", epoch: this.state.epoch, lease_id: this.lease });
        this.clearLocal(); this.denial++; return;
      }
    }
    this.deferred = null;
    this.finish(pending.action, pending.pose);
  }
  private finish(action: "release" | "confirm", pose?: InteractionPose): number | null {
    const finalPose = pose ?? this.prediction ?? undefined;
    if (finalPose) this.prediction = clone(finalPose);
    if (this.acquireRequest) {
      if (action === "release" && this.kind !== "navigation_planning" && this.kind !== "manipulation_planning") this.cancel();
      else this.deferred = { action, pose: finalPose,
        ...(this.kind === "manipulation_planning"
          ? { targetRevision: this.targetFor("manipulation", this.settings.group_id)?.revision }
          : {}) };
      return null;
    }
    if (!this.lease || !this.state) return null;
    this.queued = null;
    const finalSequence = ++this.sequence;
    const requestId = this.id();
    const terminal = action === "confirm" || this.kind !== "navigation_planning";
    if (terminal && finalPose) this.settling = { settings: { ...this.settings }, pose: clone(finalPose), sequence: finalSequence,
      key: this.targetKey(this.domain(), this.settings.group_id), requestId, epoch: this.state.epoch };
    this.send({ request_id: requestId, action, epoch: this.state.epoch, lease_id: this.lease, sequence: finalSequence,
      ...this.settings, ...(finalPose ? clone(finalPose) : {}) });
    if (terminal) this.clearLocal();
    return finalSequence;
  }
  private flush(force = false): void {
    if (!this.queued || !this.lease || !this.state || this.acquireRequest ||
        !force && this.port.now() - this.lastSent < TARGET_SEND_INTERVAL_S) return;
    this.send({ action: "update", epoch: this.state.epoch, lease_id: this.lease,
      sequence: ++this.sequence, ...this.settings, ...clone(this.queued) });
    this.queued = null; this.lastSent = this.lastRenewed = this.port.now();
  }
  private clearLocal(): void {
    this.acquisition = this.acquireRequest = this.lease = this.kind = null;
    this.grantRevision = null;
    this.prediction = this.queued = null; this.deferred = null;
    this.lastSent = this.lastRenewed = -Infinity;
  }
  private id(): string { return `interaction-${++this.serial}`; }
  private send(body: Record<string, unknown>): void {
    if (!this.port.ready()) return;
    this.port.send(JSON.stringify({ type: "interaction_request", request_id: body.request_id ?? this.id(), epoch: this.state?.epoch, ...body }) + "\n");
  }
  private domain(): "navigation" | "manipulation" { return this.kind?.startsWith("manipulation") ? "manipulation" : "navigation"; }
  private targetKey(domain: string, group?: string): string { return `${domain}:${group ?? ""}`; }
  private targetFor(domain: string, group?: string): InteractionTarget | null {
    return (this.state?.targets ?? (this.state?.target ? [this.state.target] : []))
      .find(t => (t.domain ?? "navigation") === domain && (domain === "navigation" || t.group_id === group)) ?? null;
  }
  private interpolate(key: string, now: number, target: InteractionTarget | null): InteractionPose | null {
    const samples = this.histories.get(key)?.samples ?? [];
    if (!samples.length) return target ? clone(target) : null;
    const t = now - REMOTE_INTERPOLATION_S;
    let a = samples[0];
    for (const b of samples) {
      if (b.at >= t) {
        const fraction = b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 0;
        return { position: a.pose.position.map((v, i) => v + (b.pose.position[i] - v) * fraction) as InteractionPose["position"],
          orientation: slerp(a.pose.orientation, b.pose.orientation, fraction) };
      }
      a = b;
    }
    return clone(a.pose);
  }
}
function clone(pose: InteractionPose): InteractionPose { return { position: [...pose.position], orientation: [...pose.orientation] }; }
function slerp(a: Quat, input: Quat, t: number): Quat {
  let b = input, dot = a.reduce((v, x, i) => v + x * b[i], 0);
  if (dot < 0) { b = b.map(v => -v) as Quat; dot = -dot; }
  const angle = Math.acos(Math.min(1, dot)), den = Math.sin(angle);
  const l = den > 1e-6 ? Math.sin((1 - t) * angle) / den : 1 - t;
  const r = den > 1e-6 ? Math.sin(t * angle) / den : t;
  const q = a.map((v, i) => v * l + b[i] * r) as Quat, n = Math.hypot(...q);
  return q.map(v => v / n) as Quat;
}

function samePose(a: InteractionPose, b: InteractionPose): boolean { return a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-8) && a.orientation.every((v, i) => Math.abs(v - b.orientation[i]) < 1e-8); }
