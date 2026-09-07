import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSocketTransport } from "../../Assets/Scripts/ARBridge/Network/WebSocketTransport";

const WS_CONNECTING = 0;
const WS_OPEN = 1;

type MockSocket = {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: WebSocketMessageEvent) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: WebSocketCloseEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

type MockDelayedEvent = {
  bind: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  callback?: () => void;
};

function makeManager() {
  const delayedEvents: MockDelayedEvent[] = [];
  const script = {
    createEvent: vi.fn(() => {
      const event: MockDelayedEvent = {
        bind: vi.fn((cb: () => void) => {
          event.callback = cb;
        }),
        reset: vi.fn(),
      };
      delayedEvents.push(event);
      return event;
    }),
  };

  const sockets: MockSocket[] = [];
  const internetModule = {
    createWebSocket: vi.fn(() => {
      const socket: MockSocket = {
        readyState: WS_CONNECTING,
        binaryType: "",
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        close: vi.fn(function (this: MockSocket) {
          this.onclose?.({} as WebSocketCloseEvent);
        }),
        send: vi.fn(),
      };
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }),
  };

  const manager = new WebSocketTransport(
    internetModule as unknown as InternetModule,
    script as unknown as ScriptComponent,
  );
  manager.baseUrl = "192.168.1.10";

  // constructor: timeout, watchdog, ping, pong
  const connectTimeout = delayedEvents[0]!;
  const connectWatchdog = delayedEvents[1]!;
  const constructorEventCount = delayedEvents.length;

  return {
    manager,
    sockets,
    delayedEvents,
    connectTimeout,
    connectWatchdog,
    constructorEventCount,
    internetModule,
    script,
  };
}

describe("WebSocketTransport.connect", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    (globalThis as Record<string, unknown>).print = vi.fn();
    (globalThis as Record<string, unknown>).getTime = vi.fn(() => 0);
    (globalThis as Record<string, unknown>).global = {
      persistentStorageSystem: {
        store: {
          has: vi.fn(() => false),
          putString: vi.fn(),
          getString: vi.fn(() => ""),
          remove: vi.fn(),
        },
      },
    };
  });

  it("returns immediately when already open to the same host", async () => {
    const { manager, sockets, internetModule } = makeManager();
    const connectPromise = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(connectPromise).resolves.toBeUndefined();

    await expect(manager.connect()).resolves.toBeUndefined();
    expect(internetModule.createWebSocket).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent connect calls for the same host", async () => {
    const { manager, sockets, internetModule } = makeManager();
    const first = manager.connect();
    const second = manager.connect();
    expect(second).toBe(first);
    expect(sockets).toHaveLength(1);
    expect(internetModule.createWebSocket).toHaveBeenCalledTimes(1);

    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(first).resolves.toBeUndefined();
  });

  it("coalesces connect calls even when baseUrl changed mid-flight", async () => {
    const { manager, sockets, internetModule } = makeManager();
    const first = manager.connect();

    manager.baseUrl = "192.168.1.101";
    const second = manager.connect();
    expect(second).toBe(first);
    expect(sockets).toHaveLength(1);
    expect(internetModule.createWebSocket).toHaveBeenCalledTimes(1);
    // The in-flight socket must not be aborted.
    expect(sockets[0]?.close).not.toHaveBeenCalled();

    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(first).resolves.toBeUndefined();
    // Attempt was started for the original host.
    expect(manager.openHost).toBe("192.168.1.10");
  });

  it("rejects in-flight connect when socket closes before open", async () => {
    const { manager, sockets } = makeManager();
    const connectPromise = manager.connect();
    sockets[0]?.onclose?.({} as WebSocketCloseEvent);
    await expect(connectPromise).rejects.toThrow("WebSocket connection closed");
  });

  it("completes connect on onopen", async () => {
    const { manager, sockets } = makeManager();
    const connectPromise = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(connectPromise).resolves.toBeUndefined();
    expect(manager.isSocketOpen()).toBe(true);
    expect(manager.openHost).toBe("192.168.1.10");
  });

  it("completes connect on first message while still connecting", async () => {
    const { manager, sockets } = makeManager();
    const connectPromise = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onmessage?.({ data: '{"type":"hello"}\n' } as WebSocketMessageEvent);
    await expect(connectPromise).resolves.toBeUndefined();
    expect(manager.openHost).toBe("192.168.1.10");
  });

  it("does not hard-close a CONNECTING socket on timeout (retire path)", async () => {
    const { manager, sockets, connectTimeout, internetModule } = makeManager();
    const connectPromise = manager.connect();
    expect(sockets[0]!.readyState).toBe(WS_CONNECTING);

    connectTimeout.callback?.();
    await expect(connectPromise).rejects.toThrow("WebSocket connection timeout");
    // Retire must not call close() while still CONNECTING.
    expect(sockets[0]?.close).not.toHaveBeenCalled();

    const second = manager.connect();
    // Draining retired sockets must not hard-close the CONNECTING one either.
    expect(sockets[0]?.close).not.toHaveBeenCalled();
    sockets[1]!.readyState = WS_OPEN;
    sockets[1]?.onopen?.();
    await expect(second).resolves.toBeUndefined();
    expect(internetModule.createWebSocket).toHaveBeenCalledTimes(2);
  });

  it("reuses constructor timeout events across connects", async () => {
    const { manager, sockets, script, constructorEventCount } = makeManager();
    const first = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(first).resolves.toBeUndefined();

    manager.disconnect(false);
    const second = manager.connect();
    sockets[1]!.readyState = WS_OPEN;
    sockets[1]?.onopen?.();
    await expect(second).resolves.toBeUndefined();

    expect(script.createEvent).toHaveBeenCalledTimes(constructorEventCount);
  });

  it("starts a fresh connect after disconnect", async () => {
    const { manager, sockets, internetModule } = makeManager();
    const first = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(first).resolves.toBeUndefined();

    manager.disconnect(false);
    expect(sockets[0]?.close).toHaveBeenCalled();
    expect(manager.openHost).toBeNull();

    const second = manager.connect();
    sockets[1]!.readyState = WS_OPEN;
    sockets[1]?.onopen?.();
    await expect(second).resolves.toBeUndefined();
    expect(internetModule.createWebSocket).toHaveBeenCalledTimes(2);
  });

  it("reconnects when baseUrl host changes while open", async () => {
    const { manager, sockets, internetModule } = makeManager();
    const first = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(first).resolves.toBeUndefined();

    manager.baseUrl = "192.168.1.99";
    const second = manager.connect();
    expect(sockets[0]?.close).toHaveBeenCalled();
    sockets[1]!.readyState = WS_OPEN;
    sockets[1]?.onopen?.();
    await expect(second).resolves.toBeUndefined();
    expect(internetModule.createWebSocket).toHaveBeenCalledTimes(2);
    expect(manager.openHost).toBe("192.168.1.99");
  });
});
