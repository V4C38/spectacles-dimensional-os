import { describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { decodeManipulation } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationProtocol";
import { BULK_ASSET_BYTES, BULK_CACHE_BYTES, BulkTransfer, utf8Bytes } from "../../../Assets/Scripts/DimOSARClient/websocket/BulkTransfer";
import { PairedBulk } from "../../fixtures/PairedBulk";

function fixture() {
  let now = 0; const failures: string[] = [], uploaded: Uint8Array[] = [], requests: Record<string, unknown>[] = [];
  const peer = new PairedBulk(bytes => uploaded.push(bytes));
  const original = peer.sendText.bind(peer);
  peer.sendText = text => { requests.push(JSON.parse(text)); original(text); };
  const bulk = new BulkTransfer({ now: () => now }, () => {}, () => {}, reason => failures.push(reason));
  bulk.connect(peer, { client_id: "a", bulk_token: "token", bulk_epoch: "fixture-epoch" });
  const ref = { epoch: "fixture-epoch", id: "robot-model", revision: "hash" };
  return { peer, bulk, failures, uploaded, requests, ref, spend: (seconds: number) => { now += seconds; },
    advance: (seconds: number) => { now += seconds; bulk.tick(); } };
}
describe("paired v3 bulk records", () => {
  it("assembles typed model records incrementally and reuses the same cached object", () => {
    const f = fixture();
    const message = { type: "manipulation_state", available: true, model_ref: f.ref };
    expect(f.bulk.hydrate(message)).toMatchObject({ pending: true, value: { available: false } });
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "model", part: 0, parts: 3, data: { metadata: { revision: "robot", root: "base", asset_url: null } } });
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "model", part: 1, parts: 3, data: { links: [{ name: "base", bounds: null }] } });
    f.bulk.tick(); expect(f.bulk.hydrate(message).pending).toBe(true);
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "model", part: 2, parts: 3, data: { joints: [] } });
    f.bulk.tick();
    const first = f.bulk.hydrate(message), second = f.bulk.hydrate(message);
    expect(first.pending).toBe(false); expect(first.value.model).toBe(second.value.model);
    expect(first.value.model).toMatchObject({ root: "base", links: [{ name: "base" }], joints: [] });
  });
  it("caps record processing per display tick while leaving a bounded queue", () => {
    const f = fixture();
    for (let part = 0; part < 9; part++) f.peer.receive({ type: "bulk_record", ...f.ref, kind: "route", part, parts: 9, data: part === 0 ? { metadata: { type: "nav_goal", ts: 1, pose: [1,0,0,0] } } : { points: [[part,0,0,0]] } });
    f.bulk.tick(); expect(f.bulk.diagnostics().records).toBe(4);
    expect(f.bulk.diagnostics().queuedBytes).toBeGreaterThan(0);
    f.bulk.tick(); f.bulk.tick(); expect(f.bulk.diagnostics().records).toBe(9);
  });
  it("keeps authority facts available while a referenced advisory route is missing", () => {
    const f = fixture();
    const value = { type: "interaction_state", authority: { client_id: "other" }, preview: { type: "nav_goal", preview: true, route_ref: f.ref }, active_goal: null };
    const hydrated = f.bulk.hydrate(value);
    expect(hydrated.pending).toBe(true); expect(hydrated.value.authority).toEqual(value.authority); expect(hydrated.value.preview).toBeNull();
  });
  it("rejects old epochs, oversized records, and skipped parts", () => {
    const f = fixture(); expect(() => f.bulk.hydrate({ model_ref: { ...f.ref, epoch: "old" } })).toThrow("epoch");
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "model", part: 1, parts: 2, data: {} }); f.bulk.tick();
    expect(f.failures).toContain("Missing first bulk record");
    const g = fixture(); g.peer.receive({ type: "bulk_record", ...g.ref, kind: "model", part: 0, parts: 1, data: { padding: "x".repeat(17000) } });
    expect(g.failures).toContain("Bulk receive budget exceeded");
  });
  it("uploads original localization bytes only through bounded ARB3 chunks", () => {
    const f = fixture(), bytes = new Uint8Array(100000).map((_, i) => i % 251);
    f.bulk.uploadLocalization(bytes, "capture-1"); f.bulk.tick();
    expect(f.uploaded[0]).toEqual(bytes); expect(f.bulk.uploading).toBe(false);
    expect(f.requests.find(request => request.type === "bulk_upload_begin")?.capture_id).toBe("capture-1");
  });
  it("counts UTF8 bytes rather than JS code units", () => {
    expect(utf8Bytes("aé🙂")).toBe(7);
  });
  it("treats a precise cache miss as a bounded advisory failure and keeps other assets", () => {
    const f = fixture(), missing = { ...f.ref, id: "missing-route" };
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "model", part: 0, parts: 1,
      data: { metadata: { revision: "robot", root: "base", asset_url: null }, links: [{ name: "base", bounds: null }], joints: [] } });
    f.bulk.tick();
    const message = { type: "nav_goal", route_ref: missing };
    const miss = () => f.peer.receive({ type: "bulk_error", ...missing, kind: "route", code: "asset_unavailable" });
    expect(f.bulk.hydrate(message).pending).toBe(true);
    miss(); expect(f.failures).toEqual([]);
    expect(f.bulk.hydrate({ model_ref: f.ref }).pending).toBe(false);
    expect(f.bulk.hydrate(message).pending).toBe(true);
    expect(f.requests.filter(request => request.type === "bulk_get")).toHaveLength(1);
    f.advance(1.1); f.bulk.hydrate(message); miss();
    f.advance(2.1); f.bulk.hydrate(message); miss();
    expect(f.bulk.hydrate(message)).toMatchObject({ pending: false, unavailable: true });
    f.advance(60); f.bulk.hydrate(message);
    expect(f.requests.filter(request => request.type === "bulk_get")).toHaveLength(3);
    expect(f.failures).toEqual([]);
  });
  it("does not resend bulk_get during a healthy transfer lasting longer than five seconds", () => {
    const f = fixture(), message = { type: "nav_goal", route_ref: f.ref };
    expect(f.bulk.hydrate(message)).toMatchObject({ pending: true, deadline: 120 });
    for (let part = 0; part < 4; part++) {
      if (part) f.advance(2);
      f.peer.receive({ type: "bulk_record", ...f.ref, kind: "route", part, parts: 4,
        data: part === 0 ? { metadata: { ts: 1, pose: [0, 0, 0, 0] } } : { points: [[part, 0, 0, 0]] } });
      f.bulk.tick(); f.bulk.hydrate(message);
    }
    expect(f.bulk.hydrate(message).pending).toBe(false);
    expect(f.requests.filter(request => request.type === "bulk_get")).toHaveLength(1);
    expect(f.failures).toEqual([]);
  });
  it("does not erase a progressing asset when an earlier cache-miss reply arrives late", () => {
    const f = fixture(), message = { route_ref: f.ref };
    f.bulk.hydrate(message);
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "route", part: 0, parts: 2,
      data: { metadata: { ts: 1, pose: [0, 0, 0, 0] } } });
    f.bulk.tick();
    f.peer.receive({ type: "bulk_error", ...f.ref, kind: "route", code: "asset_unavailable" });
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "route", part: 1, parts: 2, data: { points: [[1, 0, 0, 0]] } });
    f.bulk.tick();
    expect(f.bulk.hydrate(message).pending).toBe(false);
    expect(f.failures).toEqual([]);
  });
  it("cancels only its current upload and ignores late acknowledgments from the previous upload", () => {
    const f = fixture(), previous = new Uint8Array(1000000), current = new Uint8Array(70000).fill(7);
    f.bulk.uploadLocalization(previous, "capture-old"); f.bulk.tick();
    expect(f.bulk.uploading).toBe(true); expect(f.bulk.uploadDeadline()).toBe(30);
    f.bulk.cancelUpload(); f.bulk.cancelUpload();
    expect(f.requests.filter(request => request.type === "bulk_upload_cancel")).toEqual([{ type: "bulk_upload_cancel", upload_id: 1 }]);
    expect(f.bulk.uploadResult()).toMatchObject({ id: 1, status: "cancelled" });
    f.bulk.uploadLocalization(current, "capture-current");
    f.peer.receive({ type: "bulk_upload_result", upload_id: 1, status: "cancelled" });
    expect(f.bulk.uploading).toBe(true);
    f.bulk.tick(); f.bulk.tick();
    expect(f.bulk.uploadResult()).toMatchObject({ id: 2, status: "accepted" });
    expect(f.uploaded).toEqual([current]); expect(f.failures).toEqual([]);
  });
  it("rejects a retired capture without treating it as a broken control connection", () => {
    const f = fixture();
    f.bulk.uploadLocalization(new Uint8Array(100000), "old-capture");
    f.peer.receive({ type: "bulk_upload_result", upload_id: 1, status: "rejected", code: "capture_retired" });
    expect(f.bulk.uploading).toBe(false);
    expect(f.bulk.uploadResult()).toEqual({ id: 1, status: "rejected", code: "capture_retired" });
    expect(f.failures).toEqual([]);
    expect(() => f.bulk.uploadLocalization(new Uint8Array(10), "")).toThrow("generation");
    expect(() => f.bulk.uploadLocalization(new Uint8Array(4194305), "capture")).toThrow("unavailable");
  });
  it("expires a stalled upload with a scoped cancellation rather than failing the control link", () => {
    const f = fixture(); Object.assign(f.peer, { bufferedAmount: () => 262144 });
    f.bulk.uploadLocalization(new Uint8Array(100000), "capture");
    f.advance(31);
    expect(f.bulk.uploadResult()).toMatchObject({ status: "rejected", code: "upload_timeout" });
    expect(f.requests.some(request => request.type === "bulk_upload_cancel")).toBe(true);
    expect(f.failures).toEqual([]);
  });
  it("sends the existing 4MiB maximum within 17 display frames at 15fps", () => {
    const f = fixture(), bytes = new Uint8Array(4194304);
    for (let offset = 0; offset < bytes.length; offset += 4093) bytes[offset] = offset % 251 + 1;
    const sends = vi.spyOn(f.peer, "sendBinary");
    f.bulk.uploadLocalization(bytes, "capture-max");
    let frames = 0;
    while (f.bulk.uploading && frames < 30) {
      const before = sends.mock.calls.length;
      f.advance(1 / 15); frames++;
      expect(sends.mock.calls.length - before).toBeLessThanOrEqual(16);
    }
    expect(frames).toBe(17);
    expect(frames / 15).toBeLessThan(1.14);
    expect(f.bulk.uploadResult()?.status).toBe("accepted");
    expect(f.uploaded[0].byteLength).toBe(bytes.byteLength);
    expect(Buffer.compare(f.uploaded[0], bytes)).toBe(0);
    expect(sends.mock.calls.every(([chunk]) => chunk.byteLength <= 16384)).toBe(true);
    expect(f.failures).toEqual([]);
  });
  it("keeps the upload pump inside the 256KiB socket high-water mark", () => {
    const f = fixture();
    Object.assign(f.peer, { bufferedAmount: () => 262144 - 100 });
    const sends = vi.spyOn(f.peer, "sendBinary");
    f.bulk.uploadLocalization(new Uint8Array(1000000), "capture");
    f.bulk.tick();
    expect(sends).not.toHaveBeenCalled();
    expect(f.bulk.uploading).toBe(true);
  });
  it("pumps fresh JPEG bytes before queued asset parsing consumes the frame budget", () => {
    const f = fixture(), bytes = new Uint8Array(100000);
    f.bulk.uploadLocalization(bytes, "capture");
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "route", part: 0, parts: 1,
      data: { metadata: { ts: 1, pose: [0, 0, 0, 0] }, points: [[1, 0, 0, 0]], padding: "x".repeat(1100) } });
    const parse = JSON.parse;
    const parsing = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
      if (String(text).includes('"bulk_record"')) f.spend(0.003);
      return parse(text, reviver);
    });
    try {
      f.bulk.tick();
      expect(f.uploaded).toEqual([bytes]);
      expect(f.failures).toEqual([]);
    } finally { parsing.mockRestore(); }
  });
  it("contains a transport send failure instead of throwing out of the display tick", () => {
    const f = fixture();
    f.bulk.uploadLocalization(new Uint8Array(100000), "capture");
    vi.spyOn(f.peer, "sendBinary").mockImplementation(() => { throw new Error("Bulk socket closed"); });
    expect(() => f.bulk.tick()).not.toThrow();
    expect(f.failures).toEqual(["Bulk socket closed"]);
    expect(f.bulk.uploading).toBe(false);
  });
  it("bounds total cache growth when existing assets receive many incremental parts", () => {
    const f = fixture(), padding = "x".repeat(13600);
    for (let asset = 0; asset < 5; asset++) {
      const ref = { ...f.ref, id: `large-route-${asset}` };
      for (let part = 0; part < 1025; part++) {
        f.peer.receive({ type: "bulk_record", ...ref, kind: "route", part, parts: 1025,
          data: part === 0 ? { metadata: { ts: asset, pose: [0, 0, 0, 0] }, padding } : { points: [], padding } });
        f.bulk.tick();
        expect(f.bulk.diagnostics().cacheBytes).toBeLessThanOrEqual(BULK_CACHE_BYTES);
      }
    }
    expect(f.bulk.diagnostics().dropped).toBeGreaterThan(0);
    expect(f.bulk.diagnostics().maxCacheBytes).toBeLessThanOrEqual(BULK_CACHE_BYTES);
    expect(f.failures).toEqual([]);
  }, 15000);
  it("accepts an 8192 by 24 full-precision trajectory within the independent asset budget", () => {
    const f = fixture(), names = Array.from({ length: 24 }, (_, i) => `joint_${i}`), parts = 1 + Math.ceil(8192 / 24);
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "trajectory", part: 0, parts,
      data: { metadata: { plan_id: "full-precision", joint_names: names, duration: 82 } } });
    f.bulk.tick();
    for (let part = 1; part < parts; part++) {
      const offset = (part - 1) * 24;
      const points = Array.from({ length: Math.min(24, 8192 - offset) }, (_, i) => ({
        time: (offset + i) / 100, positions: names.map((_, joint) => Math.sin((offset + i) * 0.001 + joint) * 1.123456789) }));
      const record = { type: "bulk_record", ...f.ref, kind: "trajectory", part, parts, data: { points } };
      expect(utf8Bytes(JSON.stringify(record))).toBeLessThanOrEqual(16384);
      f.peer.receive(record); f.bulk.tick();
    }
    const hydrated = f.bulk.hydrate({ type: "manipulation_result", action: "plan", request_id: "full",
      group_id: "arm", status: "planned", plan_ref: f.ref });
    expect(hydrated.pending).toBe(false);
    expect(hydrated.value.trajectory).toHaveLength(8192);
    expect((hydrated.value.trajectory as { positions: number[] }[])[8191].positions).toHaveLength(24);
    expect(f.bulk.diagnostics().cacheBytes).toBeLessThanOrEqual(BULK_ASSET_BYTES);
    expect(f.failures).toEqual([]);
  });
  it("clears all cached references on a new paired control generation", () => {
    const f = fixture();
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "route", part: 0, parts: 1, data: { metadata: { type: "nav_goal", ts: 1, pose: [1,0,0,0] }, points: [[0,0,0,0],[1,0,0,0]] } });
    f.bulk.tick(); expect(f.bulk.hydrate({ type: "nav_goal", route_ref: f.ref }).pending).toBe(false);
    f.bulk.reset(); expect(f.bulk.diagnostics().assets).toBe(0);
  });
  it("validates an 8192-point trajectory by chunks and never traverses it again on control hydration", () => {
    const f = fixture(), names = Array.from({ length: 12 }, (_, i) => `j${i}`);
    const parts = 129;
    f.peer.receive({ type: "bulk_record", ...f.ref, kind: "trajectory", part: 0, parts,
      data: { metadata: { plan_id: "max", joint_names: names, duration: 82 } } });
    for (let part = 1; part < parts; part++) {
      const points = Array.from({ length: 64 }, (_, i) => ({ time: ((part - 1) * 64 + i) / 100, positions: names.map((_, j) => j / 10) }));
      f.peer.receive({ type: "bulk_record", ...f.ref, kind: "trajectory", part, parts, data: { points } });
    }
    let last = 0;
    while (f.bulk.diagnostics().queuedBytes) {
      f.bulk.tick(); const current = f.bulk.diagnostics().records;
      expect(current - last).toBeLessThanOrEqual(4); last = current;
    }
    const control = { type: "manipulation_result", request_id: "plan", group_id: "arm", action: "plan", status: "planned", plan_ref: f.ref };
    const hydrated = f.bulk.hydrate(control); expect(hydrated.pending).toBe(false);
    const trajectory = hydrated.value.trajectory as unknown[];
    expect(trajectory).toHaveLength(8192); expect(Object.isFrozen(trajectory)).toBe(true);
    const original = Array.prototype[Symbol.iterator]; let traversals = 0;
    const iterator = vi.spyOn(Array.prototype, Symbol.iterator).mockImplementation(function(this: unknown[]) {
      if (this === trajectory) traversals++; return original.call(this);
    });
    try {
      for (let i = 0; i < 20; i++) {
        const decoded = decodeManipulation(f.bulk.hydrate(control).value);
        expect(decoded.type === "manipulation_result" && decoded.trajectory).toBe(trajectory);
      }
      expect(traversals).toBe(0);
    } finally { iterator.mockRestore(); }
  });
});
