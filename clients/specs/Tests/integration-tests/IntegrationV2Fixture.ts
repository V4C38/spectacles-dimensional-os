import { appendFixtureUpload, fixtureAsset } from "../../../../tools/integration-tests/support/IntegrationBulk";
import type { BindableWebSocketTransport, WebSocketTransportHandlers, CameraCaptureSource } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";

type Value = Record<string, any>;

/** Explicit native test peer. Production session, bulk decoder and authority gates stay active. */
export class IntegrationV2Fixture implements BindableWebSocketTransport {
  private handlers!: WebSocketTransportHandlers;
  private attached = false;
  private assets = new Map<string, Value[]>();
  private waiting: Value[][] = [];
  private upload: { id: number; bytes: Uint8Array; offset: number; captureId: string } | null = null;
  private captureId: string | null = null;
  private serial = 0;
  private generation = 0;
  private interaction: Value = this.empty();
  onUpload: (bytes: Uint8Array) => void = () => {};
  onGoal: (pose: Value) => void = () => {};
  onFollowingRelease: (target: Value) => Value | null = () => null;
  onTakeover: () => void = () => {};

  constructor(private readonly output: (value: Value) => void,
    private readonly clientId: string, private readonly now: () => number) {}

  bind(handlers: WebSocketTransportHandlers): void { this.handlers = handlers; }
  createSibling(): IntegrationV2Fixture { throw new Error("Bulk connections do not open siblings"); }
  connect(): void { this.handlers.onTransportOpen(); }
  close(): void { this.attached = false; this.upload = null; }
  bufferedAmount(): number { return 0; }
  sendText(text: string): void {
    const request = JSON.parse(text);
    if (request.type === "bulk_hello_request") {
      this.attached = true;
      this.bulk({ type: "bulk_hello", protocol_version: 2, epoch: "fixture-epoch" });
      for (const records of this.waiting) for (const record of records) this.bulk(record);
      this.waiting = [];
    }
    if (request.type === "bulk_get") for (const record of this.assets.get(request.id) ?? []) this.bulk(record);
    if (request.type === "bulk_upload_cancel") {
      if (this.upload?.id === request.upload_id) this.upload = null;
      this.bulk({ type: "bulk_upload_result", upload_id: request.upload_id, status: "cancelled" });
    }
    if (request.type === "bulk_upload_begin") {
      if (!this.captureId || request.capture_id !== this.captureId) {
        this.bulk({ type: "bulk_upload_result", upload_id: request.upload_id, status: "rejected" });
        return;
      }
      this.upload = { id: request.upload_id, bytes: new Uint8Array(request.total_bytes), offset: 0, captureId: request.capture_id };
      this.bulk({ type: "bulk_upload_ready", upload_id: request.upload_id });
    }
  }
  sendBinary(data: Uint8Array): void {
    const upload = this.upload;
    if (appendFixtureUpload(upload, data)) {
      if (!upload) throw new Error("Invalid native fixture upload");
      this.upload = null;
      const accepted = upload.captureId === this.captureId;
      if (accepted) this.onUpload(upload.bytes);
      this.bulk({ type: "bulk_upload_result", upload_id: upload.id, status: accepted ? "accepted" : "rejected" });
    }
  }
  send(value: Value): void {
    if (value.type === "nav_goal") {
      this.interaction[value.preview ? "preview" : "active_goal"] = value;
      this.bump(); return;
    }
    const message = this.prepare(value);
    if (message.type === "hello") Object.assign(message, {
      protocol_version: 2, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch",
    });
    if (message.type === "localization_observations_request") {
      this.captureId = `fixture-capture-${++this.serial}`;
      message.capture_id = this.captureId;
    }
    this.output(message);
  }
  reset(): void { this.interaction = this.empty(); this.publish(); }
  publish(): void { this.send(this.interaction); }
  clearGoal(): void { this.interaction.active_goal = null; this.interaction.preview = null; this.bump(); }
  setGoal(goal: Value): void { this.interaction.active_goal = goal; this.interaction.preview = null; this.bump(); }
  setFollowingTail(tail: Value | null): void { this.interaction.following_tail = tail; this.bump(); }
  setBusy(busy: boolean): void { this.interaction.motion_busy = busy; this.bump(); }
  authorizes(request: Value): boolean {
    const authority = this.interaction.authority;
    return !!authority && request.epoch === this.interaction.epoch && request.lease_id === authority.lease_id;
  }
  setPreview(goal: Value, requestedPose: Value, leaseId?: string): void {
    const target = this.interaction.target;
    const authority = this.interaction.authority;
    if (!target || authority?.kind !== "navigation_planning" || leaseId && authority.lease_id !== leaseId ||
      !this.near(target, requestedPose)) return;
    this.interaction.preview = goal; this.previewAim = requestedPose; this.bump();
  }
  private previewAim: Value | null = null;
  command(request: Value): boolean {
    if (request.type !== "interaction_request") return false;
    const state = this.interaction, action = request.action;
    const result = (status = "accepted", code = "ok") => this.send({ type: "interaction_result",
      request_id: request.request_id, epoch: state.epoch, revision: state.revision,
      status, code, ...(state.authority ? { lease_id: state.authority.lease_id } : {}) });
    if (action === "snapshot") { this.publish(); result(); return true; }
    if (action === "mode") {
      state.mode = request.mode; state.authority = null; state.preview = null; this.previewAim = null;
      this.clearDraft();
      this.bump(); result(); return true;
    }
    if (action === "acquire") {
      if (state.authority || state.motion_busy || state.mode !== "manual") { result("busy", "owned"); return true; }
      this.onTakeover(); state.following_tail = null; state.preview = null; this.previewAim = null;
      state.authority = { client_id: this.clientId, source_id: request.source_id,
        acquisition_id: request.acquisition_id, lease_id: `native-lease-${++this.generation}`,
        kind: request.kind, group_id: request.group_id ?? null, held: true, sequence: 0, expires_at: this.now() + .5 };
      if (request.position) this.target(request);
      this.bump(); result(); return true;
    }
    const authority = state.authority;
    if (action === "cancel_acquire") {
      if (authority?.acquisition_id === request.acquisition_id) { state.authority = null; state.preview = null; this.clearDraft(); this.bump(); }
      result(); return true;
    }
    if (!authority || request.epoch !== state.epoch || request.lease_id !== authority.lease_id) {
      result("stale", "lease_expired"); return true;
    }
    authority.expires_at = this.now() + .5;
    if (action === "renew") { this.bump(); result(); return true; }
    if (request.sequence !== undefined && request.sequence <= authority.sequence) { result("stale", "sequence"); return true; }
    if (request.position) this.target(request);
    if (request.sequence !== undefined) authority.sequence = request.sequence;
    if (action === "release" && authority.kind === "navigation_planning") authority.held = false;
    else if (action === "release" || action === "confirm") {
      const target = state.target;
      if (target) target.phase = "committed";
      if (target && (action === "confirm" || authority.kind === "live")) this.onGoal(target);
      if (target && authority.kind === "manipulation_following") state.following_tail = this.onFollowingRelease(target);
      state.authority = null;
    } else if (action === "cancel") { state.authority = null; state.preview = null; this.previewAim = null; this.clearDraft(); }
    this.bump(); result(); return true;
  }
  canonical(): Value | null { return this.interaction.target; }
  previewOwner(request: Value): boolean {
    const authority = this.interaction.authority;
    return !!authority && authority.kind === "navigation_planning" &&
      request.epoch === this.interaction.epoch && request.lease_id === authority.lease_id;
  }
  lidar(data: Uint8Array): void {
    const id = ++this.serial;
    this.bulk({ type: "bulk_binary_begin", kind: "lidar", epoch: "fixture-epoch", id, total_bytes: data.length });
    for (let offset = 0; offset < data.length; offset += 16372) {
      const payload = data.subarray(offset, offset + 16372), packet = new Uint8Array(payload.length + 12), header = new DataView(packet.buffer);
      header.setUint32(0, 0x32425241, true); header.setUint32(4, id, true); header.setUint32(8, offset, true);
      packet.set(payload, 12); this.handlers.onTransportBinary(packet);
    }
  }
  private empty(): Value { return { type: "interaction_state", epoch: "native-fixture", revision: 0,
    mode: "manual", authority: null, target: null, targets: [], preview: null, active_goal: null, following_tail: null, motion_busy: false }; }
  private bump(): void { this.interaction.revision++; this.publish(); }
  private clearDraft(): void {
    this.interaction.targets = this.interaction.targets.filter((target: Value) => target.phase !== "draft");
    if (this.interaction.target?.phase === "draft") this.interaction.target = this.interaction.targets[this.interaction.targets.length - 1] ?? null;
  }
  private target(request: Value): void {
    const state = this.interaction, authority = state.authority;
    const domain = authority.kind.startsWith("manipulation") ? "manipulation" : "navigation";
    const previous = state.targets.find((target: Value) => target.domain === domain && target.group_id === (request.group_id ?? authority.group_id ?? undefined));
    const speed = request.speed_scale ?? previous?.speed_scale ?? .5;
    const gripper = request.gripper ?? previous?.gripper;
    const unchanged = previous && JSON.stringify(previous.position) === JSON.stringify(request.position) &&
      JSON.stringify(previous.orientation) === JSON.stringify(request.orientation) &&
      previous.speed_scale === speed && previous.gripper === gripper;
    const target = { position: [...request.position], orientation: [...request.orientation], domain,
      ...(request.group_id || authority.group_id ? { group_id: request.group_id ?? authority.group_id } : {}),
      speed_scale: speed, ...(gripper !== undefined ? { gripper } : {}),
      revision: unchanged ? previous.revision : (previous?.revision ?? 0) + 1,
      phase: authority.kind.endsWith("planning") ? "draft" : "live",
      sample_ts: this.now(), sequence: request.sequence ?? 0 };
    state.target = target;
    state.targets = [...state.targets.filter((item: Value) => item.domain !== domain || item.group_id !== target.group_id), target];
    if (state.preview && this.previewAim && !this.near(target, this.previewAim)) { state.preview = null; this.previewAim = null; }
  }
  private near(a: Value, b: Value): boolean {
    return Math.hypot(...a.position.map((v: number, i: number) => v - b.position[i])) < .2 &&
      2 * Math.acos(Math.min(1, Math.abs(a.orientation.reduce((sum: number, v: number, i: number) => sum + v * b.orientation[i], 0)))) < Math.PI / 12;
  }
  private prepare(value: Value): Value {
    const { target: _currentTarget, ...message } = value;
    if (message.model) { message.model_ref = this.asset("model", message.model); delete message.model; }
    if (message.plan) { message.plan_ref = this.asset("trajectory", message.plan); delete message.plan; }
    if (message.type === "manipulation_result" && message.trajectory) { message.plan_ref = this.asset("trajectory", message); delete message.trajectory; }
    if (message.type === "nav_goal" && message.path_poses?.length) { message.route_ref = this.asset("route", message); delete message.path_poses; }
    if (message.preview && typeof message.preview === "object") message.preview = this.prepare(message.preview);
    if (message.active_goal && typeof message.active_goal === "object") message.active_goal = this.prepare(message.active_goal);
    return message;
  }
  private asset(kind: string, value: Value): Value {
    const { ref, records } = fixtureAsset(kind, value, { maximumPartSize: 12000, measure: text => text.length }, this.assets);
    const id = ref.id;
    if (!records) return ref;
    if (this.assets.size >= 64) this.assets.delete(this.assets.keys().next().value!);
    this.assets.set(id, records);
    if (this.attached) for (const record of records) this.bulk(record); else this.waiting.push(records);
    return ref;
  }
  private bulk(value: Value): void { this.handlers.onTransportText(JSON.stringify(value) + "\n"); }
}

/** Replace methods on the actual composition adapter, retaining every existing owner reference. */
export function installFixtureCamera(
  source: CameraCaptureSource,
  capture: CameraCaptureSource["capture"],
): () => void {
  const keys = ["start", "stop", "capture"] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(source, key));
  const replacement: CameraCaptureSource = { start: () => {}, stop: () => {}, capture };
  for (const key of keys) Object.defineProperty(source, key, {
    configurable: true, writable: true, value: replacement[key],
  });
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    keys.forEach((key, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(source, key, descriptor);
      else delete (source as unknown as Record<string, unknown>)[key];
    });
  };
}
