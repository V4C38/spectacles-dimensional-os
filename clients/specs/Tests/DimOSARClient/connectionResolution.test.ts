import { describe, expect, it, vi } from "vitest";
import { ConnectionResolution, validPin, type ResolvedConnection } from "../../Assets/Scripts/DimOSARClient/websocket/ConnectionResolution";

function fixture() {
  let timeout = () => {};
  const cancel = vi.fn();
  const resolution = new ConnectionResolution((seconds, callback) => { expect(seconds).toBe(15); timeout = callback; return cancel; });
  return { resolution, cancel, expire: () => timeout() };
}

describe("connection discovery", () => {
  it("retains leading zeros and rejects non-six-digit PINs", () => {
    expect(validPin("012345")).toBe(true);
    for (const value of ["12345", "1234567", "１２３４５６", "123 45", " 123456"]) expect(validPin(value)).toBe(false);
  });
  it("fences cancelled, replaced and timed-out lookup callbacks", async () => {
    const h = fixture();
    let resolve!: (endpoint: ResolvedConnection) => void;
    const open = vi.fn(), fail = vi.fn();
    h.resolution.setResolver(() => new Promise(done => { resolve = done; }));
    h.resolution.run(open, fail); h.resolution.cancel();
    resolve({ controlUrl: "ws://old" }); await Promise.resolve();
    expect(open).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
    h.resolution.run(open, fail); h.expire();
    resolve({ controlUrl: "ws://late" }); await Promise.resolve();
    expect(open).not.toHaveBeenCalled(); expect(fail).toHaveBeenCalledOnce();
  });
  it("re-resolves on each control attempt and opens direct connections synchronously", async () => {
    const h = fixture(); const open = vi.fn(), fail = vi.fn();
    h.resolution.run(open, fail); expect(open).toHaveBeenCalledWith();
    const resolver = vi.fn().mockResolvedValueOnce({ controlUrl: "ws://first" }).mockResolvedValueOnce({ controlUrl: "ws://second" });
    h.resolution.setResolver(resolver);
    h.resolution.run(open, fail); await Promise.resolve();
    h.resolution.run(open, fail); await Promise.resolve();
    expect(open).toHaveBeenLastCalledWith({ controlUrl: "ws://second" }); expect(resolver).toHaveBeenCalledTimes(2);
  });
});
