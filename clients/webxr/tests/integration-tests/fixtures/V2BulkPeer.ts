import { appendFixtureUpload, fixtureAsset, fixtureBinaryPackets } from "../../../../../tools/integration-tests/support/IntegrationBulk";
import type { Page, WebSocketRoute } from "@playwright/test";

type Value = Record<string, any>;
/** Explicit protocol peer: fixtures replace hardware, never the paired transport contract. */
export class V2BulkPeer {
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
          if (appendFixtureUpload(upload, raw)) {
            if (!upload) throw new Error("Invalid fixture upload");
            this.upload = null;
            if (upload.captureId === this.captureId) this.onUpload(upload.bytes);
            this.bulk({ type: "bulk_upload_result", upload_id: upload.id,
              status: upload.captureId === this.captureId ? "accepted" : "rejected" });
          }
          return;
        }
        const request = JSON.parse(raw);
        if (request.type === "bulk_hello_request") {
          this.ready = true; this.bulk({ type: "bulk_hello", protocol_version: 2, epoch: "fixture-epoch" });
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
    if (transformed.type === "hello") Object.assign(transformed, { protocol_version: 2, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch" });
    const text = JSON.stringify(transformed) + "\n";
    if (Buffer.byteLength(text) > 16384) throw new Error("Fixture control payload exceeds v2 budget");
    peer.send(text);
  }
  lidar(data: Buffer): void {
    this.bulk({ type: "bulk_binary_begin", kind: "lidar", epoch: "fixture-epoch", id: 1, total_bytes: data.length });
    for (const packet of fixtureBinaryPackets(data)) this.socket!.send(Buffer.from(packet));
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
    const { ref, records } = fixtureAsset(kind, value, { maximumPartSize: 14000, measure: Buffer.byteLength }, this.assets);
    const id = ref.id;
    if (!records) return ref;
    if (this.assets.size >= 64) this.assets.delete(this.assets.keys().next().value!);
    this.assets.set(id, records);
    if (this.ready) for (const record of records) this.bulk(record); else this.waiting.push(records);
    return ref;
  }
  private bulk(message: object) { this.socket?.send(JSON.stringify(message) + "\n"); }
}
