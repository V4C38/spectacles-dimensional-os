import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpecsWebSocketTransport } from "../../Assets/Scripts/DimOSSpecsClient/websocket/SpecsWebSocketTransport";

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
  cancel: ReturnType<typeof vi.fn>;
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
        cancel: vi.fn(),
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

it("cancels native timeout and watchdog events after open and close", () => {
  const h = makeTransport(); h.transport.connect();
  h.sockets[0].readyState = WS_OPEN; h.sockets[0].onopen?.();
  expect(h.connectTimeout.cancel).toHaveBeenCalled(); expect(h.connectWatchdog.cancel).toHaveBeenCalled();
  expect(h.connectTimeout.reset).not.toHaveBeenCalledWith(0); expect(h.connectWatchdog.reset).not.toHaveBeenCalledWith(0);
  h.connectTimeout.cancel.mockClear(); h.connectWatchdog.cancel.mockClear(); h.transport.close();
  expect(h.connectTimeout.cancel).toHaveBeenCalledOnce(); expect(h.connectWatchdog.cancel).toHaveBeenCalledOnce();
});

it("bounds native CONNECTING sockets across repeated failed reconnects", () => {
  const { transport, internetModule, connectTimeout, sockets } = makeTransport();
  transport.connect(); connectTimeout.callback?.();
  for (let i = 0; i < 50; i++) transport.connect();
  expect(internetModule.createWebSocket).toHaveBeenCalledOnce();
  expect(sockets[0].close).not.toHaveBeenCalled();
  sockets[0].readyState = 3; sockets[0].onclose?.();
  transport.connect();
  expect(internetModule.createWebSocket).toHaveBeenCalledTimes(2);
});

it("reuses the bulk transport and its native timers across handshakes", () => {
  const { transport } = makeTransport();
  const sibling = transport.createSibling("/bulk");
  for (let i = 0; i < 50; i++) expect(transport.createSibling("/bulk")).toBe(sibling);
  expect(sibling.getUrl()).toBe("ws://192.168.1.10:8787/bulk");
});

it("delivers interleaved headers and deferred binary chunks in arrival order", async () => {
  const h = makeTransport(), delivered: string[] = [];
  h.handlers.onTransportText.mockImplementation(text => delivered.push(text));
  h.handlers.onTransportBinary.mockImplementation(bytes => delivered.push(String(bytes[0])));
  h.transport.connect(); h.sockets[0].readyState = WS_OPEN; h.sockets[0].onopen?.();
  let first!: (bytes: Uint8Array) => void, second!: (bytes: Uint8Array) => void;
  const a = new Promise<Uint8Array>(resolve => { first = resolve; });
  const b = new Promise<Uint8Array>(resolve => { second = resolve; });
  const decodeB = vi.fn(() => b);
  const receive = (data: unknown) => h.sockets[0].onmessage?.({ data } as WebSocketMessageEvent);
  receive("header-a"); receive({ bytes: () => a }); receive("header-b"); receive({ bytes: decodeB });
  second(new Uint8Array([2])); await Promise.resolve();
  expect(delivered).toEqual(["header-a"]); expect(decodeB).not.toHaveBeenCalled();
  first(new Uint8Array([1]));
  for (let tick = 0; tick < 4; tick++) await Promise.resolve();
  expect(delivered).toEqual(["header-a", "1", "header-b", "2"]);
});

it.each(["records", "bytes", "decoded-size", "decode-failure"])("retires a socket when its receive %s budget fails", async reason => {
  const h = makeTransport(); h.transport.connect(); h.sockets[0].readyState = WS_OPEN; h.sockets[0].onopen?.();
  const receive = (data: unknown) => h.sockets[0].onmessage?.({ data } as WebSocketMessageEvent);
  if (reason === "records") {
    receive({ bytes: () => new Promise(() => {}) });
    for (let i = 0; i < 256; i++) receive("queued");
  } else if (reason === "bytes") {
    receive({ bytes: () => new Promise(() => {}) }); receive("x".repeat(4 * 1024 * 1024));
  } else if (reason === "decoded-size") receive({ size: 1, bytes: async () => new Uint8Array(16385) });
  else receive({ bytes: async () => { throw new Error("decode failed"); } });
  for (let tick = 0; tick < 3; tick++) await Promise.resolve();
  expect(h.handlers.onTransportClose).toHaveBeenCalledOnce();
  expect(h.handlers.onTransportBinary).not.toHaveBeenCalled();
  expect(h.sockets[0].close).toHaveBeenCalled();
});

it("does not deliver an old socket's queued header after reconnect", async () => {
  const h = makeTransport(); h.transport.connect(); h.sockets[0].readyState = WS_OPEN; h.sockets[0].onopen?.();
  let complete!: (bytes: Uint8Array) => void;
  h.sockets[0].onmessage?.({ data: { bytes: () => new Promise(resolve => { complete = resolve; }) } } as unknown as WebSocketMessageEvent);
  h.sockets[0].onmessage?.({ data: "old" } as WebSocketMessageEvent);
  h.transport.connect(); h.sockets[1].readyState = WS_OPEN; h.sockets[1].onopen?.();
  h.sockets[1].onmessage?.({ data: "new" } as WebSocketMessageEvent);
  complete(new Uint8Array([1])); await Promise.resolve();
  expect(h.handlers.onTransportText.mock.calls).toEqual([["new"]]);
  expect(h.handlers.onTransportBinary).not.toHaveBeenCalled();
});
