import { expect, it, vi } from "vitest";
import { SpecsConnectionController } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SpecsConnectionController";

function fixture() {
  const storage = new Map<string, string>();
  const events: { fire(): void; cancel: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }[] = [];
  const pending: ((value: { ip: string; port: number } | null) => void)[] = [];
  const session = { view: () => ({ connection: "disconnected" }), start: vi.fn(), stop: vi.fn() };
  const transport = { setUrl: vi.fn() }, onChanged = vi.fn();
  const controller = new SpecsConnectionController({
    script: { removeEvent: vi.fn(), createEvent: () => {
      let callback = () => {};
      const event = { bind: (fn: () => void) => { callback = fn; }, fire: () => callback(), cancel: vi.fn(), reset: vi.fn() };
      events.push(event); return event;
    } } as any,
    session: session as any, transport, onChanged,
    hostStore: { has: key => storage.has(key), getString: key => storage.get(key) ?? "", putString: (key, value) => { storage.set(key, value); }, remove: key => { storage.delete(key); } },
    ipRelayClient: { resolve: () => new Promise(resolve => pending.push(resolve)) },
  });
  return { controller, storage, events, pending, session, transport, onChanged };
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

it("disposes pending PIN lookup, retries and polls without restarting the session", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  h.controller.dispose(); h.controller.dispose();
  h.onChanged.mockClear(); h.pending[0]({ ip: "192.168.1.10", port: 8787 }); await Promise.resolve();
  for (const event of h.events) event.fire();
  h.controller.start("ip", "192.168.1.11");
  expect(h.session.start).not.toHaveBeenCalled(); expect(h.transport.setUrl).not.toHaveBeenCalled();
  expect(h.onChanged).not.toHaveBeenCalled();
  h.events.forEach(event => expect(event.cancel).toHaveBeenCalled());
});

it("cancels a scheduled retry on edit and preserves the remembered PIN", async () => {
  const h = fixture(); h.controller.start("pin", "012345");
  h.pending[0](null); await Promise.resolve(); expect(h.events[0].reset).toHaveBeenCalledWith(2);
  h.controller.cancel(); h.events[0].fire();
  expect(h.pending).toHaveLength(1); expect(h.controller.storedPin()).toBe("012345");
});
