import type { BindableWebSocketTransport, WebSocketTransportHandlers } from "../Scripts/DimOSARClient/websocket/hostPorts";

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
    const upload = this.upload, header = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (!upload || data.length < 12 || header.getUint32(0, true) !== 0x32425241 ||
      header.getUint32(4, true) !== upload.id || header.getUint32(8, true) !== upload.offset ||
      upload.offset + data.length - 12 > upload.bytes.length) throw new Error("Invalid native fixture upload");
    upload.bytes.set(data.subarray(12), upload.offset); upload.offset += data.length - 12;
    if (upload.offset === upload.bytes.length) {
      this.upload = null;
      const accepted = upload.captureId === this.captureId;
      if (accepted) this.onUpload(upload.bytes);
      this.bulk({ type: "bulk_upload_result", upload_id: upload.id, status: accepted ? "accepted" : "rejected" });
    }
  }
  send(value: Value): void {
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
        acquisition_id: request.acquisition_id ?? request.request_id, lease_id: `native-lease-${++this.generation}`,
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
    const target = { position: [...request.position], orientation: [...request.orientation], domain,
      ...(request.group_id || authority.group_id ? { group_id: request.group_id ?? authority.group_id } : {}),
      ...(request.speed_scale !== undefined ? { speed_scale: request.speed_scale } : {}),
      ...(request.gripper !== undefined ? { gripper: request.gripper } : {}),
      revision: state.revision + 1, phase: authority.kind.endsWith("planning") ? "draft" : "live",
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
    const message = { ...value };
    if (message.model) { message.model_ref = this.asset("model", message.model); delete message.model; }
    if (message.plan) { message.plan_ref = this.asset("trajectory", message.plan); delete message.plan; }
    if (message.type === "manipulation_result" && message.trajectory) { message.plan_ref = this.asset("trajectory", message); delete message.trajectory; }
    if (message.type === "nav_goal" && message.path_poses?.length) { message.route_ref = this.asset("route", message); delete message.path_poses; }
    if (message.preview && typeof message.preview === "object") message.preview = this.prepare(message.preview);
    if (message.active_goal && typeof message.active_goal === "object") message.active_goal = this.prepare(message.active_goal);
    return message;
  }
  private asset(kind: string, value: Value): Value {
    let hash = 2166136261; const text = JSON.stringify(value);
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    const id = `${kind}-${hash >>> 0}`, ref = { epoch: "fixture-epoch", id, revision: String(hash >>> 0) };
    if (this.assets.has(id)) return ref;
    const metadata = { ...value }, fields = kind === "model" ? ["links", "joints"] : [kind === "route" ? "path_poses" : "trajectory"];
    fields.forEach(field => delete metadata[field]);
    const data: Value[] = [{ metadata }];
    for (const field of fields) {
      const key = field === "links" || field === "joints" ? field : "points";
      let items: unknown[] = [];
      for (const item of value[field] ?? []) {
        if (items.length && JSON.stringify({ [key]: [...items, item] }).length > 12000) { data.push({ [key]: items }); items = []; }
        items.push(item);
      }
      if (items.length) data.push({ [key]: items });
    }
    const records = data.map((part, index) => ({ type: "bulk_record", ...ref, kind, part: index, parts: data.length, data: part }));
    if (this.assets.size >= 64) this.assets.delete(this.assets.keys().next().value!);
    this.assets.set(id, records);
    if (this.attached) for (const record of records) this.bulk(record); else this.waiting.push(records);
    return ref;
  }
  private bulk(value: Value): void { this.handlers.onTransportText(JSON.stringify(value) + "\n"); }
}
