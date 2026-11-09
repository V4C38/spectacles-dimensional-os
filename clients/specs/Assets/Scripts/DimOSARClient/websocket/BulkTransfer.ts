import type { BindableWebSocketTransport, ClientClock } from "./hostPorts";
import { validateManipulationModel } from "../manipulation/ManipulationModelValidation";

export const BULK_RECORD_BYTES = 16384;
export const BULK_UPLOAD_BYTES = 4194304;
export const BULK_ASSET_BYTES = 16777216;
export const BULK_CACHE_BYTES = 67108864;
export const BULK_ASSET_WAIT_S = 120;
export const BULK_FRAME_BUDGET_S = 0.002;
export const BULK_UPLOAD_BUFFER_BYTES = 262144;
export const BULK_UPLOAD_CHUNKS_PER_TICK = 16;
const BINARY_MAGIC = 0x32425241;
type RecordObject = Record<string, unknown>;
export interface BulkRef { epoch: string; id: string; revision: string | number; }
type Kind = "model" | "trajectory" | "route";
type Entry = { kind: Kind; parts: number; next: number; bytes: number; metadata: RecordObject; first: unknown[]; second: unknown[];
  links: Set<string>; joints: Set<string>; parents: Map<string, string>; mimics: Map<string, string>; needed: Set<string>; lastTime: number;
  started: number; updated: number; value?: RecordObject };
type Wanted = { ref: BulkRef; kind: Kind; started: number; retryAt: number; attempts: number };
export type BulkUploadResult = { id: number; status: "accepted" | "cancelled" | "rejected"; code?: string };
const validatedAssets = new WeakSet<object>();
const validatedArrays = new WeakMap<object, { names?: readonly string[]; lastTime: number }>();
export function isValidatedBulkAsset(value: object): boolean { return validatedAssets.has(value); }
export function validatedBulkArray(value: object) { return validatedArrays.get(value); }
function object(value: unknown): RecordObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected bulk object");
  return value as RecordObject;
}
export function utf8Bytes(text: string): number {
  let size = 0;
  for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); size += n < 128 ? 1 : n < 2048 ? 2 : n >= 0xd800 && n <= 0xdbff && i + 1 < text.length ? (++i, 4) : 3; }
  return size;
}
function reference(value: unknown): BulkRef {
  const raw = object(value);
  if (typeof raw.epoch !== "string" || raw.epoch.length > 128 || typeof raw.id !== "string" || raw.id.length > 256 ||
      !(typeof raw.revision === "string" && raw.revision.length <= 256 || Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0)) throw new Error("Invalid bulk reference");
  return raw as unknown as BulkRef;
}
function key(ref: BulkRef): string { return JSON.stringify([ref.epoch, ref.id, ref.revision]); }
function finite(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid bulk number"); return value; }
function name(value: unknown): string { if (typeof value !== "string" || !value.length || value.length > 256) throw new Error("Invalid bulk name"); return value; }
function vector(value: unknown, count: number): number[] { if (!Array.isArray(value) || value.length !== count) throw new Error("Invalid bulk vector"); value.forEach(finite); return value; }
function pose(value: unknown): void { const raw = object(value); vector(raw.position, 3); if (Math.abs(Math.hypot(...vector(raw.orientation, 4)) - 1) > 1e-4) throw new Error("Invalid bulk rotation"); }
function freeze(value: unknown): void { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } }
function metadata(entry: Entry): void {
  const raw = entry.metadata;
  if (entry.kind === "model") {
    name(raw.revision); name(raw.root);
    if (raw.asset_url !== null && typeof raw.asset_url !== "string") throw new Error("Invalid bulk asset URL");
    if (raw.gripper_joints !== undefined) for (const [joint, pair] of Object.entries(object(raw.gripper_joints))) {
      name(joint); const mapping = object(pair); finite(mapping.open); finite(mapping.closed); entry.needed.add(joint);
    }
  } else if (entry.kind === "trajectory") {
    name(raw.plan_id); finite(raw.duration);
    if (!Array.isArray(raw.joint_names) || !raw.joint_names.length || raw.joint_names.length > 256 || new Set(raw.joint_names).size !== raw.joint_names.length || Number(raw.duration) < 0) throw new Error("Invalid bulk trajectory metadata");
    raw.joint_names.forEach(name);
  } else { finite(raw.ts); if (raw.pose !== undefined && raw.pose !== null) vector(raw.pose, 4); }
  freeze(raw);
}
function item(entry: Entry, value: unknown, second: boolean): void {
  if (entry.kind === "route") vector(value, 4);
  else if (entry.kind === "trajectory") {
    const raw = object(value), time = finite(raw.time);
    if (time < 0 || time < entry.lastTime || time > Number(entry.metadata.duration)) throw new Error("Invalid bulk trajectory time");
    vector(raw.positions, (entry.metadata.joint_names as unknown[]).length); entry.lastTime = time;
    if (entry.first.length >= 8192) throw new Error("Bulk trajectory point budget exceeded");
  } else if (!second) {
    const raw = object(value), id = name(raw.name);
    if (entry.links.has(id) || entry.links.size >= 256) throw new Error("Invalid bulk model link");
    if (raw.bounds != null) { const bounds = object(raw.bounds); vector(bounds.center, 3); if (vector(bounds.size, 3).some(v => v <= 0)) throw new Error("Invalid bulk bounds"); }
    entry.links.add(id);
  } else {
    const raw = object(value), id = name(raw.name), parent = name(raw.parent), child = name(raw.child);
    if (entry.joints.has(id) || entry.joints.size >= 256 || entry.parents.has(child) || !entry.links.has(parent) || !entry.links.has(child) || !["fixed", "revolute", "continuous", "prismatic"].includes(String(raw.kind))) throw new Error("Invalid bulk model joint");
    vector(raw.axis, 3); pose(raw.origin);
    if (raw.limits != null) { const limit = object(raw.limits); if (finite(limit.lower) > finite(limit.upper)) throw new Error("Invalid bulk joint limit"); }
    let ancestor: string | undefined = parent;
    while (ancestor !== undefined) { if (ancestor === child) throw new Error("Cyclic bulk model"); ancestor = entry.parents.get(ancestor); }
    entry.parents.set(child, parent); entry.joints.add(id); entry.needed.delete(id);
    if (raw.mimic != null) {
      const mimic = object(raw.mimic), target = name(mimic.joint); finite(mimic.multiplier); finite(mimic.offset);
      if (!entry.joints.has(target)) entry.needed.add(target);
      ancestor = target; while (ancestor !== undefined) { if (ancestor === id) throw new Error("Cyclic bulk mimic"); ancestor = entry.mimics.get(ancestor); }
      entry.mimics.set(id, target);
    }
  }
  freeze(value);
}

/** Bounded incremental records; large assets never pass through a second JSON stringify/parse. */
export class BulkTransfer {
  private epoch = "";
  private ready = false;
  private port: BindableWebSocketTransport | null = null;
  private records: (string | Uint8Array)[] = [];
  private queueBytes = 0;
  private entries = new Map<string, Entry>();
  private wanted = new Map<string, Wanted>();
  private unavailable = new Map<string, string>();
  private ignored = new Set<string>();
  private pins = new Map<string, string>();
  private cacheBytes = 0;
  private uploadSerial = 0;
  private upload: { id: number; data: Uint8Array; offset: number; started: number; admitted: boolean } | null = null;
  private lastUploadResult: BulkUploadResult | null = null;
  private download: { id: number; bytes: Uint8Array; offset: number; started: number } | null = null;
  private deadline = 0;
  private generation = 0;
  private lastProgressAt = 0;
  private counters = { receivedBytes: 0, sentBytes: 0, records: 0, maxQueueBytes: 0, maxCacheBytes: 0, maxWorkMs: 0, dropped: 0, misses: 0 };
  constructor(private readonly clock: ClientClock, private readonly changed: () => void, private readonly lidar: (bytes: Uint8Array) => void,
    private readonly failed: (reason: string) => void) {}
  connect(port: BindableWebSocketTransport, hello: { client_id: string; bulk_token: string; bulk_epoch: string }): void {
    this.reset(); this.port = port; this.epoch = hello.bulk_epoch; this.deadline = this.clock.now() + 5;
    const generation = this.generation;
    port.bind({ onTransportOpen: () => {
      if (generation === this.generation) this.send({ type: "bulk_hello_request", protocol_version: 2, client_id: hello.client_id, token: hello.bulk_token });
    }, onTransportClose: () => { if (generation === this.generation) this.fail("Bulk connection closed"); },
    onTransportText: text => { if (generation === this.generation) this.enqueue(text); },
    onTransportBinary: data => {
      if (generation !== this.generation) return;
      if (data.byteLength > BULK_RECORD_BYTES || this.records.length >= 256 || this.queueBytes + data.byteLength > BULK_UPLOAD_BYTES) { this.fail("Bulk receive budget exceeded"); return; }
      this.records.push(data); this.queueBytes += data.byteLength;
    } });
    port.connect();
  }
  reset(): void {
    this.generation++; this.port?.close(); this.port = null; this.ready = false; this.epoch = "";
    this.records = []; this.queueBytes = 0; this.entries.clear(); this.wanted.clear(); this.unavailable.clear(); this.ignored.clear(); this.pins.clear(); this.cacheBytes = 0;
    this.upload = this.download = null; this.deadline = 0;
    this.lastUploadResult = null; this.lastProgressAt = 0;
  }
  diagnostics() { return { ...this.counters, queuedBytes: this.queueBytes, cacheBytes: this.cacheBytes, assets: this.entries.size,
    pendingAssets: this.wanted.size, unavailableAssets: this.unavailable.size, lastProgressAt: this.lastProgressAt, ready: this.ready }; }
  get uploading(): boolean { return this.upload !== null; }
  uploadDeadline(): number | null { return this.upload ? this.upload.started + 30 : null; }
  uploadResult(): BulkUploadResult | null { return this.lastUploadResult; }
  uploadLocalization(data: Uint8Array, captureId: string): void {
    if (!this.port || !this.ready) throw new Error("Bulk channel is not ready");
    if (typeof captureId !== "string" || !captureId.trim() || captureId.length > 128) throw new Error("Localization capture generation is required");
    if (data.byteLength < 6 || data.byteLength > BULK_UPLOAD_BYTES || this.upload) throw new Error("Localization bulk upload unavailable");
    this.uploadSerial = (this.uploadSerial + 1) >>> 0;
    this.lastUploadResult = null;
    this.upload = { id: this.uploadSerial, data, offset: 0, started: this.clock.now(), admitted: false };
    this.send({ type: "bulk_upload_begin", kind: "localization", upload_id: this.upload.id, total_bytes: data.byteLength, capture_id: captureId });
  }
  cancelUpload(): void {
    const upload = this.upload;
    if (!upload) return;
    this.upload = null;
    this.lastUploadResult = { id: upload.id, status: "cancelled" };
    this.send({ type: "bulk_upload_cancel", upload_id: upload.id });
    this.changed();
  }
  tick(): void {
    const start = this.clock.now();
    if (this.port && !this.ready && start >= this.deadline) { this.fail("Bulk handshake timed out"); return; }
    if (this.upload && start - this.upload.started > 30) {
      const id = this.upload.id;
      this.upload = null;
      this.lastUploadResult = { id, status: "rejected", code: "upload_timeout" };
      this.send({ type: "bulk_upload_cancel", upload_id: id }); this.changed();
    }
    if (this.download && start - this.download.started > 5) { this.fail("Bulk transfer timed out"); return; }
    // Fresh camera pixels have an image-age deadline; optional asset parsing follows.
    let sent = 0;
    while (this.ready && this.upload?.admitted && this.upload.offset < this.upload.data.length && (this.port?.bufferedAmount?.() ?? 0) < BULK_UPLOAD_BUFFER_BYTES && sent++ < BULK_UPLOAD_CHUNKS_PER_TICK && this.clock.now() - start < BULK_FRAME_BUDGET_S) {
      const upload = this.upload, count = Math.min(BULK_RECORD_BYTES - 12, upload.data.length - upload.offset);
      if ((this.port?.bufferedAmount?.() ?? 0) + count + 12 > BULK_UPLOAD_BUFFER_BYTES) break;
      const packet = new Uint8Array(count + 12), header = new DataView(packet.buffer);
      header.setUint32(0, BINARY_MAGIC, true); header.setUint32(4, upload.id, true); header.setUint32(8, upload.offset, true);
      packet.set(upload.data.subarray(upload.offset, upload.offset + count), 12);
      upload.offset += count;
      try { this.port!.sendBinary(packet); }
      catch (error) { this.fail(error instanceof Error ? error.message : String(error)); return; }
      this.counters.sentBytes += packet.byteLength;
    }
    // The count cap also bounds work under deterministic clocks and coarse native timers.
    let processed = 0;
    while (this.records.length && processed++ < 4 && this.clock.now() - start < BULK_FRAME_BUDGET_S) {
      const item = this.records.shift()!; this.queueBytes -= typeof item === "string" ? utf8Bytes(item) : item.byteLength;
      try {
        if (typeof item === "string") this.receive(object(JSON.parse(item)), utf8Bytes(item));
        else this.binary(item);
      } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); return; }
    }
    this.counters.maxWorkMs = Math.max(this.counters.maxWorkMs, (this.clock.now() - start) * 1000);
  }
  hydrate(input: RecordObject): { value: RecordObject; pending: boolean; deadline: number | null; unavailable: boolean } {
    let pending = false, unavailable = false, deadline: number | null = null;
    const visit = (value: RecordObject, scope = "active_goal"): RecordObject => {
      const result = { ...value };
      for (const [field, kind] of [["model", "model"], ["plan", "trajectory"], ["route", "route"]] as const) {
        const raw = result[`${field}_ref`]; if (raw === undefined) continue;
        const ref = reference(raw); if (ref.epoch !== this.epoch) throw new Error("Bulk reference epoch mismatch");
        const id = key(ref);
        this.pins.set(kind === "route" ? `route:${scope}` : field, id);
        const asset = this.entries.get(id);
        if (!asset?.value) {
          this.request(ref, kind);
          if (this.unavailable.has(id)) unavailable = true;
          else {
            pending = true;
            deadline = Math.max(deadline ?? 0, (this.wanted.get(id)?.started ?? asset?.started ?? this.clock.now()) + BULK_ASSET_WAIT_S);
          }
          continue;
        }
        this.entries.delete(id); this.entries.set(id, asset);
        if (asset.kind !== kind) throw new Error("Bulk reference kind mismatch");
        if (kind === "model") result.model = asset.value;
        else if (kind === "trajectory") {
          if (result.type === "manipulation_result") Object.assign(result, asset.value, value);
          else result.plan = asset.value;
        } else Object.assign(result, asset.value, value, { path_poses: asset.value.path_poses });
      }
      if (result.preview && typeof result.preview === "object") {
        const preview = visit(object(result.preview), "preview"); result.preview = preview.path_poses === undefined ? null : preview;
      }
      if (result.active_goal && typeof result.active_goal === "object") {
        const goal = visit(object(result.active_goal), "active_goal"); result.active_goal = { ...goal, path_poses: goal.path_poses ?? [] };
      }
      if (result.type === "nav_goal" && result.route_ref && result.path_poses === undefined && !result.preview) result.path_poses = [];
      if (result.type === "manipulation_state") {
        if (result.model_ref && !result.model) { result.available = false; result.message = unavailable ? "Robot model is unavailable" : "Loading robot model"; }
        if (result.plan_ref && !result.plan) result.plan = null;
      }
      return result;
    };
    const value = visit(input, input.preview === true ? "preview" : "active_goal");
    return { value, pending, deadline, unavailable };
  }
  private enqueue(text: string): void {
    for (const line of text.split("\n").filter(line => line.trim())) {
      const bytes = utf8Bytes(line); this.counters.receivedBytes += bytes;
      if (bytes > BULK_RECORD_BYTES || this.records.length >= 256 || this.queueBytes + bytes > BULK_UPLOAD_BYTES) { this.fail("Bulk receive budget exceeded"); return; }
      if (bytes < 1024) {
        try {
          const control = object(JSON.parse(line));
          if (["bulk_hello", "bulk_upload_ready", "bulk_upload_result", "bulk_error"].includes(String(control.type))) { this.receive(control, bytes); continue; }
        } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); return; }
      }
      this.records.push(line); this.queueBytes += bytes; this.counters.maxQueueBytes = Math.max(this.counters.maxQueueBytes, this.queueBytes);
    }
  }
  private receive(raw: RecordObject, bytes: number): void {
    if (raw.type === "bulk_hello") {
      if (raw.protocol_version !== 2 || raw.epoch !== this.epoch) throw new Error("Incompatible bulk handshake");
      this.ready = true; this.changed(); return;
    }
    if (!this.ready) throw new Error("Bulk payload before handshake");
    if (raw.type === "bulk_error") {
      if (raw.code !== "asset_unavailable") throw new Error("Unknown bulk error");
      const ref = reference(raw), id = key(ref), wanted = this.wanted.get(id), entry = this.entries.get(id);
      if (ref.epoch !== this.epoch || !wanted || wanted.kind !== raw.kind) return;
      // A delayed cache-miss reply cannot erase a transfer already making progress.
      if (entry && (entry.value || this.clock.now() - entry.updated < 5)) return;
      this.removeEntry(id);
      this.counters.misses++;
      if (wanted.attempts >= 3) this.markUnavailable(id, "asset_unavailable");
      else wanted.retryAt = this.clock.now() + Math.min(8, 2 ** Math.max(0, wanted.attempts - 1));
      this.changed(); return;
    }
    if (raw.type === "bulk_upload_ready") { if (this.upload && this.upload.id === raw.upload_id) this.upload.admitted = true; return; }
    if (raw.type === "bulk_upload_result") {
      const upload = this.upload;
      if (!upload || upload.id !== raw.upload_id) return;
      if (!["accepted", "cancelled", "rejected"].includes(String(raw.status))) throw new Error("Invalid upload result");
      this.lastUploadResult = { id: upload.id, status: raw.status as BulkUploadResult["status"],
        ...(typeof raw.code === "string" ? { code: raw.code.slice(0, 128) } : {}) };
      this.upload = null; this.changed(); return;
    }
    if (raw.type === "bulk_binary_begin") {
      if (raw.epoch !== this.epoch || raw.kind !== "lidar" || !Number.isSafeInteger(raw.id) || !Number.isSafeInteger(raw.total_bytes) || Number(raw.total_bytes) < 16 || Number(raw.total_bytes) > 65536) throw new Error("Invalid LiDAR bulk header");
      this.download = { id: Number(raw.id), bytes: new Uint8Array(Number(raw.total_bytes)), offset: 0, started: this.clock.now() }; return;
    }
    if (raw.type !== "bulk_record") throw new Error("Unknown bulk frame");
    const ref = reference(raw); if (ref.epoch !== this.epoch) throw new Error("Bulk record epoch mismatch");
    if (!["model", "trajectory", "route"].includes(String(raw.kind)) || !Number.isSafeInteger(raw.part) || !Number.isSafeInteger(raw.parts) || Number(raw.parts) < 1 || Number(raw.parts) > 2048 || Number(raw.part) < 0 || Number(raw.part) >= Number(raw.parts)) throw new Error("Invalid bulk record ordering");
    const id = key(ref); let entry = this.entries.get(id);
    if (this.unavailable.has(id) || this.ignored.has(id) && Number(raw.part) !== 0) return;
    if (!entry) {
      if (Number(raw.part) !== 0) throw new Error("Missing first bulk record");
      if (!this.reserve(bytes, id, true)) { this.markUnavailable(id, "cache_capacity"); return; }
      entry = { kind: raw.kind as Kind, parts: Number(raw.parts), next: 0, bytes: 0, metadata: {}, first: [], second: [],
        links: new Set(), joints: new Set(), parents: new Map(), mimics: new Map(), needed: new Set(), lastTime: -1,
        started: this.clock.now(), updated: this.clock.now() }; this.entries.set(id, entry);
      this.ignored.delete(id);
    }
    if (entry.value || Number(raw.part) < entry.next) return;
    if (entry.kind !== raw.kind || entry.parts !== raw.parts || Number(raw.part) !== entry.next) throw new Error("Out of order bulk record");
    if (entry.bytes + bytes > BULK_ASSET_BYTES) throw new Error("Bulk asset exceeds budget");
    if (!this.reserve(bytes, id, false)) { this.markUnavailable(id, "cache_capacity"); return; }
    const data = object(raw.data);
    if (data.metadata !== undefined) {
      if (entry.next !== 0) throw new Error("Late bulk metadata");
      entry.metadata = object(data.metadata);
      metadata(entry);
    }
    const first = entry.kind === "model" ? data.links : data.points;
    const second = entry.kind === "model" ? data.joints : undefined;
    for (const [items, destination] of [[first, entry.first], [second, entry.second]] as const) {
      if (items === undefined) continue;
      if (!Array.isArray(items) || items.length > 2048 || destination.length + items.length > 16384) throw new Error("Bulk item budget exceeded");
      for (const value of items) { item(entry, value, destination === entry.second); destination.push(value); }
    }
    entry.next++; entry.bytes += bytes; this.cacheBytes += bytes; this.counters.records++;
    entry.updated = this.lastProgressAt = this.clock.now();
    const wanted = this.wanted.get(id);
    if (wanted) wanted.retryAt = this.clock.now() + 5;
    this.counters.maxCacheBytes = Math.max(this.counters.maxCacheBytes, this.cacheBytes);
    if (entry.next === entry.parts) {
      if (entry.kind === "model" && (!entry.links.has(String(entry.metadata.root)) || entry.needed.size) || entry.kind === "trajectory" && !entry.first.length) throw new Error("Incomplete bulk asset");
      Object.freeze(entry.first); Object.freeze(entry.second);
      entry.value = entry.kind === "model" ? { ...entry.metadata, links: entry.first, joints: entry.second }
        : { ...entry.metadata, [entry.kind === "trajectory" ? "trajectory" : "path_poses"]: entry.first };
      if (entry.kind === "model") validateManipulationModel(entry.value);
      Object.freeze(entry.value); validatedAssets.add(entry.value);
      validatedArrays.set(entry.first, { names: entry.kind === "trajectory" ? entry.metadata.joint_names as string[] : undefined, lastTime: entry.lastTime });
      this.wanted.delete(id); this.changed();
    }
  }
  private binary(data: Uint8Array): void {
    try {
      if (!this.ready || data.byteLength < 12 || data.byteLength > BULK_RECORD_BYTES) throw new Error("Invalid bulk binary frame");
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength), download = this.download;
      if (!download || header.getUint32(0, true) !== BINARY_MAGIC || header.getUint32(4, true) !== download.id || header.getUint32(8, true) !== download.offset || download.offset + data.byteLength - 12 > download.bytes.length) throw new Error("Invalid bulk binary ordering");
      download.bytes.set(data.subarray(12), download.offset); download.offset += data.byteLength - 12;
      if (download.offset === download.bytes.length) { this.download = null; this.lidar(download.bytes); }
    } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
  }
  private request(ref: BulkRef, kind: Kind): void {
    const id = key(ref), now = this.clock.now();
    if (!this.ready || this.unavailable.has(id)) return;
    const entry = this.entries.get(id);
    let wanted = this.wanted.get(id);
    if (!wanted) {
      if (this.wanted.size >= 64) { this.markUnavailable(id, "request_capacity"); return; }
      wanted = { ref, kind, started: entry?.started ?? now, retryAt: now, attempts: 0 };
      this.wanted.set(id, wanted);
    }
    if (now - wanted.started >= BULK_ASSET_WAIT_S) { this.markUnavailable(id, "asset_timeout"); return; }
    if (entry && now - entry.updated < 5 || now < wanted.retryAt) return;
    if (wanted.attempts >= 3) { this.markUnavailable(id, "asset_unavailable"); return; }
    wanted.attempts++; wanted.retryAt = now + 5;
    this.send({ type: "bulk_get", kind, ...ref });
  }
  private removeEntry(id: string): void {
    const entry = this.entries.get(id);
    if (entry) { this.cacheBytes -= entry.bytes; this.entries.delete(id); }
  }
  private markUnavailable(id: string, reason: string): void {
    this.removeEntry(id); this.wanted.delete(id); this.unavailable.set(id, reason);
    while (this.unavailable.size > 64) this.unavailable.delete(this.unavailable.keys().next().value!);
    this.counters.dropped++; this.changed();
  }
  private reserve(bytes: number, id: string, newEntry: boolean): boolean {
    while (this.cacheBytes + bytes > BULK_CACHE_BYTES || this.entries.size + Number(newEntry) > 32) {
      const victim = [...this.entries.keys()].find(candidate => candidate !== id && ![...this.pins.values()].includes(candidate));
      if (victim === undefined) return false;
      this.removeEntry(victim); this.ignored.add(victim); this.counters.dropped++;
      while (this.ignored.size > 64) this.ignored.delete(this.ignored.values().next().value!);
    }
    return true;
  }
  private send(value: RecordObject): void {
    const text = JSON.stringify(value) + "\n";
    try { this.port?.sendText(text); this.counters.sentBytes += utf8Bytes(text); }
    catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
  }
  private fail(reason: string): void { this.reset(); this.failed(reason); }
}
