import { describe, it, expect, vi } from "vitest";
import { AppState, createDefaultDimosAppState } from "../../Assets/Scripts/Core/AppState";

describe("AppState store", () => {
  it("snapshot is a deep clone (mutation does not leak into store)", () => {
    const s = new AppState(createDefaultDimosAppState());
    const snap = s.snapshot;
    snap.robotRuntime.capabilities.lidar = { available: false, reason: "x" };
    expect(s.snapshot.robotRuntime.capabilities.lidar?.available).not.toBe(false);
  });

  it("subscribe invokes immediately and unsubscribe stops further calls", () => {
    const s = new AppState(createDefaultDimosAppState());
    const seen: string[] = [];
    const off = s.subscribe((st) => seen.push(st.operatingMode));
    expect(seen.length).toBe(1);
    s.update({ operatingMode: "agent" });
    off();
    s.update({ operatingMode: "manual" });
    expect(seen).toEqual(["manual", "agent"]);
  });

  it("queues reentrant updates made during dispatch (no loss, no throw)", () => {
    const s = new AppState(createDefaultDimosAppState());
    let fired = false;
    s.subscribe((st) => {
      if (!fired && st.debugMode) {
        fired = true;
        s.update({ lidarMode: "full" });
      }
    });
    s.update({ debugMode: true });
    expect(s.snapshot.debugMode).toBe(true);
    expect(s.snapshot.lidarMode).toBe("full");
  });

  it("isolates a throwing listener and reports via print", () => {
    const printSpy = vi.fn();
    (globalThis as Record<string, unknown>).print = printSpy;
    const s = new AppState(createDefaultDimosAppState());
    const other = vi.fn();
    s.subscribe((st) => {
      if (st.debugMode) {
        throw new Error("boom");
      }
    });
    s.subscribe(other);
    s.update({ debugMode: true });
    expect(other).toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalled();
  });
});
