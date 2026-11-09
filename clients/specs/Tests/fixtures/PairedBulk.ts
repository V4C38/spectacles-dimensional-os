import type { BindableWebSocketTransport, WebSocketTransportHandlers } from "../../Assets/Scripts/DimOSARClient/websocket/hostPorts";

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
      if (typeof request.capture_id !== "string" || !request.capture_id.trim()) throw new Error("Capture generation missing");
      this.upload = { id: request.upload_id, bytes: new Uint8Array(request.total_bytes), offset: 0 };
      this.receive({ type: "bulk_upload_ready", upload_id: request.upload_id });
    }
  }
  sendBinary(data: Uint8Array) {
    if (!this.upload) throw new Error("No upload");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== 0x32425241 || view.getUint32(4, true) !== this.upload.id || view.getUint32(8, true) !== this.upload.offset) throw new Error("Invalid upload chunk");
    this.upload.bytes.set(data.subarray(12), this.upload.offset); this.upload.offset += data.byteLength - 12;
    if (this.upload.offset === this.upload.bytes.length) {
      const upload = this.upload; this.upload = null; this.uploaded(upload.bytes);
      this.receive({ type: "bulk_upload_result", upload_id: upload.id, status: "accepted" });
    }
  }
  receive(value: object) { this.handlers.onTransportText(JSON.stringify(value) + "\n"); }
  lidar(data: Uint8Array) {
    this.receive({ type: "bulk_binary_begin", kind: "lidar", epoch: "fixture-epoch", id: 1, total_bytes: data.length });
    for (let offset = 0; offset < data.length; offset += 16372) {
      const payload = data.subarray(offset, offset + 16372), packet = new Uint8Array(payload.length + 12), view = new DataView(packet.buffer);
      view.setUint32(0, 0x32425241, true); view.setUint32(4, 1, true); view.setUint32(8, offset, true); packet.set(payload, 12);
      this.handlers.onTransportBinary(packet);
    }
  }
}
