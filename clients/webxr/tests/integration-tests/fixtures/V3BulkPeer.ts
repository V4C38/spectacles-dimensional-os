import type { Page, WebSocketRoute } from "@playwright/test";

type Value = Record<string, any>;
/** Explicit protocol peer: fixtures replace hardware, never the paired transport contract. */
export class V3BulkPeer {
  onUpload: (bytes: Buffer) => void = () => {};
  private socket: WebSocketRoute | null = null;
  private ready = false;
  private assets = new Map<string, Value[]>();
  private waiting: Value[][] = [];
  private upload: { id: number; bytes: Buffer; offset: number; captureId: string } | null = null;
  private captureId: string | null = null;
  private captureSerial = 0;
  async install(page: Page) {
    await page.routeWebSocket(/\/bulk(?:\?.*)?$/, ws => {
      this.socket = ws;
      ws.onMessage(raw => {
        if (typeof raw !== "string") {
          const upload = this.upload;
          if (!upload || raw.length < 12 || raw.readUInt32LE(0) !== 0x33425241 || raw.readUInt32LE(4) !== upload.id || raw.readUInt32LE(8) !== upload.offset) throw new Error("Invalid fixture upload");
          raw.copy(upload.bytes, upload.offset, 12); upload.offset += raw.length - 12;
          if (upload.offset === upload.bytes.length) {
            this.upload = null;
            if (upload.captureId === this.captureId) this.onUpload(upload.bytes);
            this.bulk({ type: "bulk_upload_result", upload_id: upload.id,
              status: upload.captureId === this.captureId ? "accepted" : "rejected" });
          }
          return;
        }
        const request = JSON.parse(raw);
        if (request.type === "bulk_hello_request") {
          this.ready = true; this.bulk({ type: "bulk_hello", protocol_version: 3, epoch: "fixture-epoch" });
          for (const records of this.waiting) for (const record of records) this.bulk(record);
          this.waiting = [];
        }
        if (request.type === "bulk_get") for (const record of this.assets.get(request.id) ?? []) this.bulk(record);
        if (request.type === "bulk_upload_cancel") {
          if (this.upload?.id === request.upload_id) this.upload = null;
          this.bulk({ type: "bulk_upload_result", upload_id: request.upload_id, status: "cancelled" });
        }
        if (request.type === "bulk_upload_begin") {
          if (typeof request.capture_id !== "string" || request.capture_id !== this.captureId) {
            this.bulk({ type: "bulk_upload_result", upload_id: request.upload_id, status: "rejected" });
            return;
          }
          this.upload = { id: request.upload_id, bytes: Buffer.alloc(request.total_bytes), offset: 0, captureId: request.capture_id };
          this.bulk({ type: "bulk_upload_ready", upload_id: request.upload_id });
        }
      });
    });
  }
  send(peer: WebSocketRoute, message: object): void {
    const transformed = this.prepare(message as Value);
    if (transformed.type === "localization_observations_request") {
      this.captureId = `fixture-capture-${++this.captureSerial}`;
      transformed.capture_id = this.captureId;
    }
    if (transformed.type === "hello") Object.assign(transformed, { protocol_version: 3, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch" });
    const text = JSON.stringify(transformed) + "\n";
    if (Buffer.byteLength(text) > 16384) throw new Error("Fixture control payload exceeds v3 budget");
    peer.send(text);
  }
  lidar(data: Buffer): void {
    this.bulk({ type: "bulk_binary_begin", kind: "lidar", epoch: "fixture-epoch", id: 1, total_bytes: data.length });
    for (let offset = 0; offset < data.length; offset += 16372) {
      const payload = data.subarray(offset, offset + 16372), packet = Buffer.alloc(payload.length + 12);
      packet.writeUInt32LE(0x33425241, 0); packet.writeUInt32LE(1, 4); packet.writeUInt32LE(offset, 8); payload.copy(packet, 12);
      this.socket!.send(packet);
    }
  }
  private prepare(message: Value): Value {
    const result = { ...message };
    if (result.model) { result.model_ref = this.asset("model", result.model); delete result.model; }
    if (result.plan) { result.plan_ref = this.asset("trajectory", result.plan); delete result.plan; }
    if (result.type === "manipulation_result" && result.trajectory) { result.plan_ref = this.asset("trajectory", result); delete result.trajectory; }
    if (result.type === "nav_goal" && result.path_poses) { result.route_ref = this.asset("route", result); delete result.path_poses; }
    if (result.preview && typeof result.preview === "object") result.preview = this.prepare(result.preview);
    if (result.active_goal && typeof result.active_goal === "object") result.active_goal = this.prepare(result.active_goal);
    return result;
  }
  private asset(kind: string, value: Value) {
    const serialized = JSON.stringify(value);
    let hash = 2166136261; for (let i = 0; i < serialized.length; i++) hash = Math.imul(hash ^ serialized.charCodeAt(i), 16777619);
    const id = `${kind}-${hash >>> 0}`, ref = { epoch: "fixture-epoch", id, revision: String(hash >>> 0) };
    if (this.assets.has(id)) return ref;
    const metadata = { ...value }, fields = kind === "model" ? ["links", "joints"] : [kind === "route" ? "path_poses" : "trajectory"];
    for (const field of fields) delete metadata[field];
    const pieces: Value[] = [{ metadata }];
    for (const field of fields) {
      const key = field === "links" || field === "joints" ? field : "points";
      let items: unknown[] = [];
      for (const item of value[field] ?? []) {
        if (items.length && Buffer.byteLength(JSON.stringify({ [key]: [...items, item] })) > 14000) { pieces.push({ [key]: items }); items = []; }
        items.push(item);
      }
      if (items.length) pieces.push({ [key]: items });
    }
    const records = pieces.map((data, part) => ({ type: "bulk_record", ...ref, kind, part, parts: pieces.length, data }));
    if (this.assets.size >= 64) this.assets.delete(this.assets.keys().next().value!);
    this.assets.set(id, records);
    if (this.ready) for (const record of records) this.bulk(record); else this.waiting.push(records);
    return ref;
  }
  private bulk(message: object) { this.socket?.send(JSON.stringify(message) + "\n"); }
}
