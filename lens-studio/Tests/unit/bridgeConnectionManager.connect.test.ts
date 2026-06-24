import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeConnectionManager } from "../../Assets/Scripts/Bridge/BridgeConnectionManager";

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

  const manager = new BridgeConnectionManager(
    internetModule as unknown as InternetModule,
    script as unknown as ScriptComponent,
  );
  manager.baseUrl = "192.168.1.10";

  const connectTimeout = delayedEvents[0];
  const connectWatchdog = delayedEvents[1];

  return { manager, sockets, connectTimeout, connectWatchdog, internetModule };
}

describe("BridgeConnectionManager.connect", () => {
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

  it("returns the same in-flight promise for concurrent connect calls", async () => {
    const { manager, sockets } = makeManager();
    const first = manager.connect();
    const second = manager.connect();
    expect(first).toBe(second);
    expect(sockets).toHaveLength(1);
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    await expect(first).resolves.toBeUndefined();
  });

  it("reject in-flight connect when cancelConnect is called", async () => {
    const { manager, sockets } = makeManager();
    const connectPromise = manager.connect();
    manager.cancelConnect();
    await expect(connectPromise).rejects.toThrow("WebSocket connection cancelled");
    expect(sockets[0]?.close).not.toHaveBeenCalled();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    expect(sockets[0]?.close).toHaveBeenCalled();
  });

  it("reject in-flight connect when socket closes before open", async () => {
    const { manager, sockets } = makeManager();
    const connectPromise = manager.connect();
    sockets[0]?.onclose?.({} as WebSocketCloseEvent);
    await expect(connectPromise).rejects.toThrow("WebSocket connection closed");
  });

  it("completes connect when readyState is OPEN before onopen via watchdog", async () => {
    const { manager, sockets, connectWatchdog } = makeManager();
    const connectPromise = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    connectWatchdog?.callback?.();
    await expect(connectPromise).resolves.toBeUndefined();
    expect(manager.isSocketOpen()).toBe(true);
  });

  it("completes connect at timeout when readyState is already OPEN", async () => {
    const { manager, sockets, connectTimeout } = makeManager();
    const connectPromise = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    connectTimeout?.callback?.();
    await expect(connectPromise).resolves.toBeUndefined();
    expect(sockets[0]?.close).not.toHaveBeenCalled();
  });

  it("completes connect when hello arrives via onmessage before onopen", async () => {
    const { manager, sockets } = makeManager();
    const textMessages: string[] = [];
    manager.onTextMessage.add((line) => textMessages.push(line));

    const connectPromise = manager.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onmessage?.({
      data: '{"type":"hello","protocol_version":7}\n',
    } as WebSocketMessageEvent);

    await expect(connectPromise).resolves.toBeUndefined();
    expect(textMessages).toHaveLength(1);
    expect(textMessages[0]).toContain('"type":"hello"');
  });

  it("rejects and retires socket when timeout fires while still CONNECTING", async () => {
    const { manager, sockets, connectTimeout, internetModule } = makeManager();
    const connectPromise = manager.connect();
    connectTimeout?.callback?.();
    await expect(connectPromise).rejects.toThrow("WebSocket connection timeout");
    expect(sockets[0]?.close).not.toHaveBeenCalled();

    sockets[0]!.readyState = WS_OPEN;
    sockets[0]?.onopen?.();
    expect(sockets[0]?.close).toHaveBeenCalled();

    const second = manager.connect();
    sockets[1]!.readyState = WS_OPEN;
    sockets[1]?.onopen?.();
    await expect(second).resolves.toBeUndefined();
    expect(internetModule.createWebSocket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
  });
});
