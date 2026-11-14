import { appendFixtureUpload, fixtureBinaryPackets } from "../../../../tools/integration-tests/support/IntegrationBulk";
import type { BindableWebSocketTransport, WebSocketTransportHandlers } from "../../src/ClientContracts";

/** An explicit paired v2 peer for tests that focus on session/camera behavior. */
export class PairedBulk implements BindableWebSocketTransport {
  private handlers!: WebSocketTransportHandlers;
  private upload: { id: number; bytes: Uint8Array; offset: number } | null = null;
  constructor(private readonly uploaded: (data: Uint8Array) => void = () => {}) {}
  bind(handlers: WebSocketTransportHandlers) { this.handlers = handlers; }
  createSibling(): PairedBulk { throw new Error("Bulk connections do not open siblings"); }
  connect() { this.handlers.onTransportOpen(); }
  close() {}
  sendText(text: string) {
    const request = JSON.parse(text);
    if (request.type === "bulk_hello_request") this.receive({ type: "bulk_hello", protocol_version: 2, epoch: "fixture-epoch" });
    if (request.type === "bulk_upload_cancel") {
      if (this.upload?.id === request.upload_id) this.upload = null;
      this.receive({ type: "bulk_upload_result", upload_id: request.upload_id, status: "cancelled" });
    }
    if (request.type === "bulk_upload_begin") {
      if (request.kind === "localization" && (typeof request.capture_id !== "string" || !request.capture_id.trim())) throw new Error("Capture generation missing");
      if (request.kind === "speech" && typeof request.request_id !== "string") throw new Error("Transcription identity missing");
      this.upload = { id: request.upload_id, bytes: new Uint8Array(request.total_bytes), offset: 0 };
      this.receive({ type: "bulk_upload_ready", upload_id: request.upload_id });
    }
  }
  sendBinary(data: Uint8Array) {
    if (!this.upload) throw new Error("No upload");
    if (appendFixtureUpload(this.upload, data)) {
      const upload = this.upload; this.upload = null; this.uploaded(upload.bytes);
      this.receive({ type: "bulk_upload_result", upload_id: upload.id, status: "accepted" });
    }
  }
  receive(value: object) { this.handlers.onTransportText(JSON.stringify(value) + "\n"); }
  lidar(data: Uint8Array) {
    this.receive({ type: "bulk_binary_begin", kind: "lidar", epoch: "fixture-epoch", id: 1, total_bytes: data.length });
    for (const packet of fixtureBinaryPackets(data)) this.handlers.onTransportBinary(packet);
  }
}
