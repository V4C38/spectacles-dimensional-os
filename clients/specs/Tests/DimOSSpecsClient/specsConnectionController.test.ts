import { expect, it, vi } from "vitest";
import { SpecsConnectionController } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SpecsConnectionController";

function fixture() {
  const storage = new Map<string, string>();
  const events: { fire(): void; cancel: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }[] = [];
  const pending: ((value: { ip: string; port: number } | null) => void)[] = [];
  let listener = () => {};
  const session = { subscribeView: (callback: () => void) => { listener = callback; return vi.fn(); }, notify: () => listener(), view: () => ({ connection: "disconnected" }), start: vi.fn(), stop: vi.fn() };
  const transport = { setUrl: vi.fn() }, onChanged = vi.fn();
  const onConnectionTargetChanged = vi.fn();
  const controller = new SpecsConnectionController({
    script: { removeEvent: vi.fn(), createEvent: () => {
      let callback = () => {};
      const event = { bind: (fn: () => void) => { callback = fn; }, fire: () => callback(), cancel: vi.fn(), reset: vi.fn() };
      events.push(event); return event;
    } } as any,
    session: session as any, transport, onChanged, onConnectionTargetChanged,
    hostStore: { has: key => storage.has(key), getString: key => storage.get(key) ?? "", putString: (key, value) => { storage.set(key, value); }, remove: key => { storage.delete(key); } },
    ipRelayClient: { resolve: () => new Promise(resolve => pending.push(resolve)) },
  });
  return { controller, storage, events, pending, session, transport, onChanged, onConnectionTargetChanged };
}

it("retires replaced PIN results and uses only the current attempt", async () => {
  const h = fixture(); h.controller.start("pin", "012345"); h.controller.start("pin", "654321");
  h.pending[0]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  expect(h.session.start).not.toHaveBeenCalled();
  h.pending[1]({ ip: "192.168.1.11", port: 8787 }); await Promise.resolve();
  expect(h.transport.setUrl).toHaveBeenCalledOnce();
  expect(h.transport.setUrl).toHaveBeenCalledWith("ws://192.168.1.11:8787");
  expect(h.controller.storedPin()).toBe("654321");
});

it("disposes pending PIN lookup, retries and subscriptions without restarting the session", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  h.controller.dispose(); h.controller.dispose();
  h.onChanged.mockClear(); h.pending[0]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  for (const event of h.events) event.fire();
  h.controller.start("ip", "192.168.1.11");
  expect(h.session.start).not.toHaveBeenCalled(); expect(h.transport.setUrl).not.toHaveBeenCalled();
  expect(h.onChanged).not.toHaveBeenCalled();
  h.events.forEach(event => expect(event.cancel).toHaveBeenCalled());
});

it("retries three times at one-second intervals and preserves the saved PIN", async () => {
  const h = fixture(); h.storage.set("dimos_ar_module_pin", "012345");
  h.controller.start("pin", "012345");
  expect(h.controller.snapshot().connecting).toBe(true);
  for (let attempt = 0; attempt < 4; attempt++) {
    expect(h.controller.storedPin()).toBe("012345");
    h.pending[attempt](null); await Promise.resolve();
    if (attempt < 3) {
      expect(h.controller.snapshot().connecting).toBe(true);
      expect(h.events[1].reset).toHaveBeenLastCalledWith(1);
      h.events[1].fire();
    }
  }
  expect(h.events[1].reset).toHaveBeenCalledTimes(3);
  expect(h.controller.storedPin()).toBe("012345");
  expect(h.controller.snapshot().connecting).toBe(false);
  h.events[1].fire(); expect(h.pending).toHaveLength(4);
});

it("preserves a loaded PIN when a retry succeeds", async () => {
  const h = fixture(); h.storage.set("dimos_ar_module_pin", "012345");
  h.controller.start("pin", "012345");
  h.pending[0](null); await Promise.resolve(); h.events[1].fire();
  h.pending[1]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  h.session.view = () => ({ connection: "ready" }); h.session.notify();
  expect(h.controller.storedPin()).toBe("012345");
  h.events[1].fire(); expect(h.pending).toHaveLength(2);
});

it("cancels pending retries when the user edits or switches modes", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  h.pending[0](null); await Promise.resolve(); h.controller.cancel();
  expect(h.controller.snapshot().connecting).toBe(false);
  h.events[1].fire(); expect(h.pending).toHaveLength(1);
});

it("ignores duplicate normalized submissions during lookup, retries, handshake and after ready", async () => {
  const h = fixture(); h.controller.start("pin", " 012345 ");
  h.session.stop.mockClear();
  h.controller.start("pin", "012345");
  expect(h.pending).toHaveLength(1);
  expect(h.session.stop).not.toHaveBeenCalled();

  h.pending[0](null); await Promise.resolve();
  h.controller.start("pin", "012345");
  expect(h.pending).toHaveLength(1);
  h.events[1].fire();
  h.pending[1]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  h.controller.start("pin", "012345");
  expect(h.session.start).toHaveBeenCalledOnce();
  h.session.view = () => ({ connection: "ready" }); h.session.notify();
  h.controller.start("pin", " 012345 ");
  expect(h.pending).toHaveLength(2);
  expect(h.session.stop).not.toHaveBeenCalled();
  expect(h.controller.storedPin()).toBe("012345");
  expect(h.controller.snapshot()).toEqual({ connecting: false, resolvingPin: false, error: null });
});

it("keeps the successful target through non-disconnecting cancellation and reconnect notifications", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  h.pending[0]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  h.session.view = () => ({ connection: "ready" }); h.session.notify();
  h.controller.cancel(); h.session.stop.mockClear();
  h.session.view = () => ({ connection: "failed" }); h.session.notify();
  h.controller.start("pin", "012345");
  expect(h.session.stop).not.toHaveBeenCalled();
  expect(h.pending).toHaveLength(1);
});

it("validates a replacement before stopping the established connection", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  h.pending[0]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  h.session.view = () => ({ connection: "ready" }); h.session.notify();
  h.session.stop.mockClear();
  h.controller.start("pin", "12");
  expect(h.session.stop).not.toHaveBeenCalled();
  expect(h.controller.storedPin()).toBe("012345");
  h.controller.start("pin", "012345");
  expect(h.controller.snapshot().error).toBeNull();
  expect(h.session.stop).not.toHaveBeenCalled();
  h.controller.start("pin", "654321");
  expect(h.session.stop).toHaveBeenCalledOnce();
  expect(h.pending).toHaveLength(2);
});

it("allows an explicit same-PIN retry after the bounded attempts have failed", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  for (let index = 0; index < 4; index++) {
    h.pending[index](null); await Promise.resolve();
    if (index < 3) h.events[1].fire();
  }
  h.controller.start("pin", "012345");
  expect(h.pending).toHaveLength(5);
  expect(h.controller.snapshot().resolvingPin).toBe(true);
});

it("does not retain a PIN resolver for reconnects", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  h.pending[0]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  h.controller.start("ip", "192.168.1.12");
  expect(h.transport.setUrl).toHaveBeenLastCalledWith("ws://192.168.1.12:8787");
});

it("times out PIN discovery once and rejects its late result", async () => {
  const h = fixture(); h.controller.start("pin", "012345"); h.events[0].fire();
  expect(h.controller.snapshot().error).toBe("PIN lookup timed out");
  h.pending[0]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  expect(h.session.start).not.toHaveBeenCalled();
  expect(h.events[1].reset).toHaveBeenLastCalledWith(1);
});

it("stops a failed initial IP attempt instead of leaving session retries running", () => {
  const h = fixture(); h.controller.start("ip", "192.168.1.12");
  h.session.stop.mockClear(); h.session.notify();
  expect(h.session.stop).toHaveBeenCalledOnce();
  expect(h.controller.snapshot()).toMatchObject({ connecting: true, error: expect.stringContaining("Connection failed") });
  h.session.notify(); expect(h.session.start).toHaveBeenCalledOnce();
});

it("bounds failed IP connections to an initial attempt plus three delayed retries", () => {
  const h = fixture(); h.controller.start("ip", "192.168.1.12");
  for (let attempt = 0; attempt < 4; attempt++) {
    h.session.notify();
    if (attempt < 3) {
      expect(h.controller.snapshot().connecting).toBe(true);
      expect(h.events[1].reset).toHaveBeenLastCalledWith(1);
      h.events[1].fire();
    }
  }
  h.events[1].fire();
  expect(h.session.start).toHaveBeenCalledTimes(4);
  expect(h.controller.snapshot().connecting).toBe(false);
});
