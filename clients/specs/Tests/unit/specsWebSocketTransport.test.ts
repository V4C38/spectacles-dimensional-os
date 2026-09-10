import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpecsWebSocketTransport } from "../../Assets/Scripts/DimosARClient/websocket/SpecsWebSocketTransport";

const WS_CONNECTING = 0;
const WS_OPEN = 1;

type MockSocket = {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: WebSocketMessageEvent) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

type MockDelayedEvent = {
  bind: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  callback?: () => void;
};

function makeTransport() {
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
    createWebSocket: vi.fn((url: string) => {
      const socket: MockSocket = {
        readyState: WS_CONNECTING,
        binaryType: "",
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        close: vi.fn(),
        send: vi.fn(),
      };
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }),
  };

  const handlers = {
    onTransportOpen: vi.fn(),
    onTransportClose: vi.fn(),
    onTransportText: vi.fn(),
    onTransportBinary: vi.fn(),
  };

  const transport = new SpecsWebSocketTransport({
    internetModule: internetModule as unknown as InternetModule,
    script: script as unknown as ScriptComponent,
    url: "ws://192.168.1.10:8787",
  });
  transport.bind(handlers);

  return {
    transport,
    sockets,
    internetModule,
    handlers,
    connectTimeout: delayedEvents[0]!,
    connectWatchdog: delayedEvents[1]!,
  };
}

describe("SpecsWebSocketTransport", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).print = vi.fn();
  });

  it("emits onTransportOpen from native onopen", () => {
    const { transport, sockets, handlers, internetModule } = makeTransport();
    transport.connect();
    expect(internetModule.createWebSocket).toHaveBeenCalledWith("ws://192.168.1.10:8787");
    expect(sockets[0]!.binaryType).toBe("blob");

    sockets[0]!.readyState = WS_OPEN;
    sockets[0]!.onopen?.();

    expect(handlers.onTransportOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onTransportClose).not.toHaveBeenCalled();
  });

  it("opens on first message while still connecting", () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]!.onmessage?.({ data: '{"type":"hello"}\n' } as WebSocketMessageEvent);

    expect(handlers.onTransportOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onTransportText).toHaveBeenCalledWith('{"type":"hello"}\n');
  });

  it("does not close() a CONNECTING socket on timeout", () => {
    const { transport, sockets, handlers, connectTimeout } = makeTransport();
    transport.connect();
    expect(sockets[0]!.readyState).toBe(WS_CONNECTING);

    connectTimeout.callback?.();

    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(handlers.onTransportClose).toHaveBeenCalledTimes(1);
    expect(handlers.onTransportOpen).not.toHaveBeenCalled();
  });

  it("close() while connecting retires without onTransportClose", () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    transport.close();

    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(handlers.onTransportClose).not.toHaveBeenCalled();
  });

  it("passes text through without splitting on newlines", () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.({ data: "a\nb\n" } as WebSocketMessageEvent);

    expect(handlers.onTransportText).toHaveBeenCalledTimes(1);
    expect(handlers.onTransportText).toHaveBeenCalledWith("a\nb\n");
  });

  it("decodes Blob bytes into Uint8Array", async () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]!.onopen?.();

    const bytes = new Uint8Array([1, 2, 3]);
    sockets[0]!.onmessage?.({
      data: { bytes: async () => bytes },
    } as unknown as WebSocketMessageEvent);
    await Promise.resolve();

    expect(handlers.onTransportBinary).toHaveBeenCalledWith(bytes);
  });

  it("drops Blob bytes after the socket is no longer current", async () => {
    const { transport, sockets, handlers } = makeTransport();
    transport.connect();
    sockets[0]!.readyState = WS_OPEN;
    sockets[0]!.onopen?.();

    let resolveBytes: (value: Uint8Array) => void = () => {};
    const pending = new Promise<Uint8Array>((resolve) => {
      resolveBytes = resolve;
    });
    sockets[0]!.onmessage?.({
      data: { bytes: () => pending },
    } as unknown as WebSocketMessageEvent);

    transport.close();
    resolveBytes(new Uint8Array([9]));
    await Promise.resolve();

    expect(handlers.onTransportBinary).not.toHaveBeenCalled();
  });
});
