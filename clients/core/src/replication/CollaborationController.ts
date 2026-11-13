import type { InteractionCredentials, InteractionKind, InteractionPose, InteractionResult, InteractionState, InteractionSettings, InteractionTarget, InteractionSnapshot, InteractionDomain, ReadonlyFacts } from "../ClientContracts";

import { lerpVec3, slerpQuat, poseCoordinatesEqual, type ReadonlyPose } from "../localization/ClientTracking";

export const TARGET_SEND_INTERVAL_S = 0.05;
export const AUTHORITY_RENEW_INTERVAL_S = 0.1;
export const REMOTE_INTERPOLATION_S = 0.1;
export const ACTIVE_TARGET_STALE_S = 0.25;
export interface CollaborationPort {
  ready(): boolean; clientId(): string | null; now(): number; send(text: string): void;
}
interface DeferredFinish {
  action: "release" | "confirm";
  pose?: ReadonlyPose;
  targetRevision?: number;
  grantRevision?: number;
}
/** A null local session is idle. A pending request and an observed lease may coexist. */
interface LocalAuthoritySession {
  acquisitionId: string;
  awaitingGrant: boolean;
  grantRevision: number | null;
  lease: string | null;
  kind: InteractionKind;
  sequence: number;
  settings: InteractionSettings;
  queued: InteractionPose | null;
  deferred: DeferredFinish | null;
  lastSent: number;
  lastRenewed: number;
}
interface SettlingTarget {
  acceptedRevision?: number;
  settings: InteractionSettings;
  pose: ReadonlyPose;
  sequence: number;
  key: string;
  requestId: string;
  epoch: string;
}

/** Owns shared facts and local authority; presentation interpolation has a separate owner. */
export class CollaborationController {
  private state: ReadonlyFacts<InteractionState> | null = null;
  private local: LocalAuthoritySession | null = null;
  private serial = 0;
  private readonly presentation = new TargetPresentation();
  private lastStateAt = -Infinity;
  private readonly cancelled = new Set<string>();
  private denial = 0;
  private settling: SettlingTarget | null = null;
  constructor(private readonly port: CollaborationPort) {}

  raw(): ReadonlyFacts<InteractionState> | null { return this.state; }
  navigation(): ReadonlyFacts<Pick<InteractionState, "preview" | "active_goal">> {
    return { preview: this.state?.preview ?? null, active_goal: this.state?.active_goal ?? null };
  }
  clearNavigation(): void {
    if (this.state) this.state = { ...this.state, preview: null, active_goal: null };
  }
  completeAssets(state: ReadonlyFacts<InteractionState>): boolean {
    if (!this.state || this.state.epoch !== state.epoch || this.state.revision !== state.revision) return false;
    this.state = { ...this.state, preview: state.preview, active_goal: state.active_goal };
    return true;
  }
  get denialRevision(): number { return this.denial; }
  snapshot(domain: InteractionDomain = "navigation", groupId?: string, now = this.port.now()): InteractionSnapshot {
    const rawTarget = this.targetFor(domain, groupId);
    const key = targetKey(domain, groupId);
    const local = this.local;
    const predicting = this.domain() === domain && (domain === "navigation" || local?.settings.group_id === groupId);
    const authority = this.state?.authority ?? null;
    const sameScope = !!authority && interactionDomain(authority.kind) === domain &&
      (domain === "navigation" || authority.group_id === groupId);
    const ownsAuthority = this.owns() && sameScope;
    const foreignAuthority = !!authority && (authority.client_id !== this.port.clientId() || !sameScope);
    const blocked = this.state?.mode === "agent" || this.state?.motion_busy === true ||
      foreignAuthority || !!local && !predicting;
    const settling = this.settling?.key === key ? this.settling : null;
    let target: InteractionPose | null;
    if (settling) target = clone(settling.pose);
    else if (predicting && this.presentation.prediction && (local || ownsAuthority)) target = clone(this.presentation.prediction);
    else target = this.presentation.interpolate(key, now, rawTarget);
    let settings: InteractionSettings;
    if (settling) settings = { ...settling.settings };
    else if (predicting && local) settings = { ...local.settings };
    else settings = { speed_scale: rawTarget?.speed_scale, gripper: rawTarget?.gripper };
    return {
      blocked,
      pending: predicting && !!local && (local.awaitingGrant || local.lease !== null && !ownsAuthority),
      ownsAuthority, authority, planning: authority?.kind === "navigation_planning",
      mode: this.state?.mode ?? "manual", settings, settling: !!settling,
      target, rawTarget, phase: rawTarget?.phase ?? null,
      stale: !!authority?.held && now - this.lastStateAt > ACTIVE_TARGET_STALE_S,
      preview: this.state?.preview ?? null, activeGoal: this.state?.active_goal ?? null,
    };
  }
  apply(state: ReadonlyFacts<InteractionState>): boolean {
    const previous = this.state;
    if (previous?.epoch === state.epoch) {
      if (state.revision <= previous.revision) return false;
      if (this.local?.grantRevision != null && state.revision < this.local.grantRevision) return false;
    } else if (previous) this.reset();
    if (state.authority && state.authority.client_id !== this.port.clientId() && this.local) {
      if (this.local.awaitingGrant) this.retireAcquisition(this.local.acquisitionId);
      this.clearLocal();
    }
    this.state = state;
    this.lastStateAt = this.port.now();
    this.presentation.apply(state.targets, this.port.now());
    this.reconcileSettling(state);
    const local = this.local;
    if (local) {
      const authority = state.authority;
      const matchingAcquisition = authority?.client_id === this.port.clientId() && authority.acquisition_id === local.acquisitionId;
      if (matchingAcquisition) {
        local.lease = authority.lease_id;
        local.sequence = Math.max(local.sequence, authority.sequence);
      } else if (local.lease && !local.awaitingGrant &&
          !(local.grantRevision !== null && state.revision < local.grantRevision)) this.clearLocal();
      if (local.grantRevision !== null && state.revision >= local.grantRevision) local.grantRevision = null;
    }
    this.finishDeferred();
    return true;
  }
  private reconcileSettling(state: ReadonlyFacts<InteractionState>): void {
    const settling = this.settling;
    if (!settling) return;
    if (state.authority) {
      if (state.authority.client_id !== this.port.clientId()) this.settling = null;
      return;
    }
    const final = state.targets.find(target => targetKey(target.domain, target.group_id) === settling.key);
    const accepted = settling.acceptedRevision !== undefined && state.revision >= settling.acceptedRevision;
    if (!final && (!settling.key.startsWith("manipulation:") || accepted)) {
      this.settling = null;
      return;
    }
    if (!final || final.sequence < settling.sequence) return;
    const endpointSettled = poseCoordinatesEqual(final, settling.pose) || state.following_tail?.group_id === final.group_id;
    const speedSettled = settling.settings.speed_scale === undefined || final.speed_scale === settling.settings.speed_scale;
    const gripperSettled = settling.settings.gripper === undefined || final.gripper === settling.settings.gripper;
    if (endpointSettled && speedSettled && gripperSettled) {
      this.presentation.settle(settling.key, final, this.port.now());
      this.settling = null;
    }
  }
  accept(result: InteractionResult): void {
    if (this.cancelled.delete(result.request_id)) {
      if (result.status === "accepted" && result.lease_id) {
        this.send({ action: "cancel", epoch: result.epoch, lease_id: result.lease_id });
      }
      return;
    }
    const settling = this.settling;
    if (settling?.requestId === result.request_id && settling.epoch === result.epoch) {
      if (result.status !== "accepted") {
        this.settling = null;
        this.denial++;
      } else if (this.state && this.state.revision >= result.revision &&
          !this.targetFor(settling.key.startsWith("manipulation:") ? "manipulation" : "navigation", settling.settings.group_id)) {
        this.settling = null;
      } else settling.acceptedRevision = result.revision;
      return;
    }
    const local = this.local;
    if (!local?.awaitingGrant || result.request_id !== local.acquisitionId) return;
    local.awaitingGrant = false;
    if (result.status !== "accepted" || !result.lease_id) {
      this.clearLocal();
      this.denial++;
      return;
    }
    if (this.state && this.state.epoch !== result.epoch) { this.clearLocal(); return; }
    const authority = this.state?.authority;
    const currentGrantDisagrees = this.state && this.state.revision >= result.revision &&
      (authority?.client_id !== this.port.clientId() || authority.acquisition_id !== local.acquisitionId || authority.lease_id !== result.lease_id);
    if (currentGrantDisagrees) {
      this.clearLocal();
      this.denial++;
      return;
    }
    local.lease = result.lease_id;
    local.grantRevision = result.revision;
    if (local.deferred) {
      local.deferred.grantRevision = result.revision;
      this.finishDeferred();
    } else this.flush(true);
  }
  begin(kind: InteractionKind, sourceId: string, pose?: ReadonlyPose, settings: InteractionSettings = {}): boolean {
    if (!this.port.ready() || !this.state || this.snapshot(interactionDomain(kind), settings.group_id).blocked) return false;
    if (this.local) return this.local.kind === kind && this.local.settings.group_id === settings.group_id;
    const request = this.id();
    this.settling = null;
    this.local = {
      acquisitionId: request, awaitingGrant: true, grantRevision: null, lease: null,
      kind, sequence: 0, settings: { ...settings }, queued: null, deferred: null,
      lastSent: -Infinity, lastRenewed: -Infinity,
    };
    if (pose) this.presentation.prediction = clone(pose);
    this.port.send(JSON.stringify({ type: "interaction_request", request_id: request,
      action: "acquire", epoch: this.state.epoch, acquisition_id: request,
      source_id: sourceId, kind, ...settings, ...(pose ? clone(pose) : {}) }) + "\n");
    return true;
  }
  update(pose: ReadonlyPose, settings?: InteractionSettings): void {
    const local = this.local;
    if (!local) return;
    const merged = settings ? { ...local.settings, ...settings } : local.settings;
    const settingsChanged = !sameSettings(local.settings, merged);
    local.settings = merged;
    if (!settingsChanged && this.presentation.prediction && poseCoordinatesEqual(this.presentation.prediction, pose)) return;
    this.presentation.prediction = clone(pose);
    local.queued = clone(pose);
    this.flush();
  }
  credentials(): InteractionCredentials | null {
    const local = this.local;
    if (!local?.lease || !this.state || !this.owns()) return null;
    return { epoch: this.state.epoch, lease_id: local.lease, sequence: ++local.sequence };
  }
  release(pose?: ReadonlyPose, kinds?: readonly InteractionKind[]): number | null {
    return this.matchesKinds(kinds) ? this.finish("release", pose) : null;
  }
  confirm(pose?: ReadonlyPose, kinds?: readonly InteractionKind[]): void {
    if (this.matchesKinds(kinds)) this.finish("confirm", pose);
  }
  cancel(kinds?: readonly InteractionKind[]): void {
    if (!this.matchesKinds(kinds)) return;
    this.settling = null;
    const local = this.local;
    if (local?.awaitingGrant) {
      this.retireAcquisition(local.acquisitionId);
      this.send({ action: "cancel_acquire", acquisition_id: local.acquisitionId });
    } else if (local?.lease && this.state) {
      this.send({ action: "cancel", epoch: this.state.epoch, lease_id: local.lease });
    }
    this.clearLocal();
  }
  setMode(mode: "manual" | "agent"): void {
    if (this.state?.mode !== mode && this.local) this.cancel();
    this.send({ action: "mode", mode });
  }
  requestSnapshot(): void { this.send({ action: "snapshot" }); }
  tick(): void {
    if (!this.port.ready()) return;
    const now = this.port.now();
    this.flush();
    const local = this.local;
    if (local?.lease && this.state && now - local.lastRenewed >= AUTHORITY_RENEW_INTERVAL_S) {
      this.send({ action: "renew", epoch: this.state.epoch, lease_id: local.lease });
      local.lastRenewed = now;
    }
    this.flush();
  }
  reset(): void {
    this.settling = null;
    this.clearLocal();
    this.state = null;
    this.presentation.reset();
    this.lastStateAt = -Infinity;
    this.cancelled.clear();
  }
  private owns(): boolean {
    const local = this.local, authority = this.state?.authority;
    return !!local && !!authority && authority.client_id === this.port.clientId() &&
      (local.lease === authority.lease_id || local.acquisitionId === authority.acquisition_id);
  }
  private matchesKinds(kinds?: readonly InteractionKind[]): boolean {
    return kinds === undefined || !!this.local && kinds.includes(this.local.kind);
  }
  private finishDeferred(): void {
    const local = this.local;
    const pending = local?.deferred;
    if (!pending || !local?.lease || pending.grantRevision === undefined) return;
    if (pending.targetRevision !== undefined) {
      if (!this.state || this.state.revision < pending.grantRevision) return;
      const targetChanged = this.targetFor(this.domain(), local.settings.group_id)?.revision !== pending.targetRevision;
      if (!this.owns() || targetChanged) {
        this.send({ action: "cancel", epoch: this.state.epoch, lease_id: local.lease });
        this.clearLocal();
        this.denial++;
        return;
      }
    }
    local.deferred = null;
    this.finish(pending.action, pending.pose);
  }
  private finish(action: "release" | "confirm", pose?: ReadonlyPose): number | null {
    const local = this.local;
    const finalPose = pose ?? this.presentation.prediction ?? undefined;
    if (finalPose) this.presentation.prediction = clone(finalPose);
    if (local?.awaitingGrant) {
      const planning = local.kind === "navigation_planning" || local.kind === "manipulation_planning";
      if (action === "release" && !planning) this.cancel();
      else local.deferred = { action, pose: finalPose,
        ...(local.kind === "manipulation_planning"
          ? { targetRevision: this.targetFor("manipulation", local.settings.group_id)?.revision } : {}) };
      return null;
    }
    if (!local?.lease || !this.state) return null;
    local.queued = null;
    const finalSequence = ++local.sequence;
    const requestId = this.id();
    const terminal = action === "confirm" || local.kind !== "navigation_planning";
    if (terminal && finalPose) {
      this.settling = { settings: { ...local.settings }, pose: clone(finalPose), sequence: finalSequence,
        key: targetKey(this.domain(), local.settings.group_id), requestId, epoch: this.state.epoch };
    }
    this.send({ request_id: requestId, action, epoch: this.state.epoch, lease_id: local.lease,
      sequence: finalSequence, ...local.settings, ...(finalPose ? clone(finalPose) : {}) });
    if (terminal) this.clearLocal();
    return finalSequence;
  }
  private flush(force = false): void {
    const local = this.local;
    if (!local?.queued || !local.lease || !this.state || local.awaitingGrant) return;
    if (!force && this.port.now() - local.lastSent < TARGET_SEND_INTERVAL_S) return;
    this.send({ action: "update", epoch: this.state.epoch, lease_id: local.lease,
      sequence: ++local.sequence, ...local.settings, ...clone(local.queued) });
    local.queued = null;
    local.lastSent = this.port.now();
    local.lastRenewed = local.lastSent;
  }
  private clearLocal(): void {
    this.local = null;
    this.presentation.prediction = null;
  }
  private retireAcquisition(id: string): void {
    this.cancelled.add(id);
    if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.values().next().value!);
  }
  private id(): string { return `interaction-${++this.serial}`; }
  private send(body: Record<string, unknown>): void {
    if (!this.port.ready()) return;
    this.port.send(JSON.stringify({ type: "interaction_request", request_id: body.request_id ?? this.id(), epoch: this.state?.epoch, ...body }) + "\n");
  }
  private domain(): InteractionDomain { return interactionDomain(this.local?.kind); }
  private targetFor(domain: string, group?: string): ReadonlyFacts<InteractionTarget> | null {
    return this.state?.targets.find(target => target.domain === domain &&
      (domain === "navigation" || target.group_id === group)) ?? null;
  }
}
function interactionDomain(kind: InteractionKind | undefined): InteractionDomain {
  return kind?.startsWith("manipulation") ? "manipulation" : "navigation";
}

/** Only visual target histories live here; authoritative facts and lease decisions stay above. */
class TargetPresentation {
  prediction: InteractionPose | null = null;
  private readonly histories = new Map<string, TargetHistory>();
  private sampleOffset: number | null = null;

  apply(targets: readonly ReadonlyFacts<InteractionTarget>[], now: number): void {
    const keys = new Set<string>();
    for (const target of targets) {
      const key = targetKey(target.domain, target.group_id);
      keys.add(key);
      let history = this.histories.get(key);
      if (!history) {
        history = { samples: [], revision: -1, newestTs: -Infinity };
        this.histories.set(key, history);
      }
      if (history.revision === target.revision) continue;
      history.revision = target.revision;
      if (target.sample_ts < history.newestTs) continue;
      const offset = now - target.sample_ts;
      if (this.sampleOffset === null) this.sampleOffset = offset;
      else if (offset < this.sampleOffset) {
        // A parked late-join target can initially imply an older clock bound.
        const correction = offset - this.sampleOffset;
        for (const entry of this.histories.values()) {
          for (const sample of entry.samples) sample.at += correction;
        }
        this.sampleOffset = offset;
      }
      history.newestTs = target.sample_ts;
      history.samples.push({ at: target.sample_ts + this.sampleOffset, pose: clone(target) });
      if (history.samples.length > 8) history.samples.shift();
    }
    for (const key of this.histories.keys()) {
      if (!keys.has(key)) this.histories.delete(key);
    }
  }

  settle(key: string, pose: ReadonlyPose, now: number): void {
    const history = this.histories.get(key);
    if (history) history.samples = [{ at: now - REMOTE_INTERPOLATION_S, pose: clone(pose) }];
  }

  interpolate(key: string, now: number, target: ReadonlyPose | null): InteractionPose | null {
    const samples = this.histories.get(key)?.samples ?? [];
    if (!samples.length) return target ? clone(target) : null;
    const timestamp = now - REMOTE_INTERPOLATION_S;
    let before = samples[0];
    for (const after of samples) {
      if (after.at >= timestamp) {
        const fraction = after.at > before.at
          ? Math.max(0, Math.min(1, (timestamp - before.at) / (after.at - before.at))) : 0;
        return {
          position: lerpVec3(before.pose.position, after.pose.position, fraction),
          orientation: slerpQuat(before.pose.orientation, after.pose.orientation, fraction),
        };
      }
      before = after;
    }
    return clone(before.pose);
  }

  reset(): void {
    this.prediction = null;
    this.histories.clear();
    this.sampleOffset = null;
  }
}
interface TargetHistory {
  samples: { at: number; pose: InteractionPose }[];
  revision: number;
  newestTs: number;
}
function targetKey(domain: string, group?: string): string { return `${domain}:${group ?? ""}`; }
function clone(pose: ReadonlyPose): InteractionPose {
  return { position: [...pose.position], orientation: [...pose.orientation] };
}
function sameSettings(a: Readonly<InteractionSettings>, b: Readonly<InteractionSettings>): boolean {
  return a.group_id === b.group_id && a.speed_scale === b.speed_scale && a.gripper === b.gripper;
}
