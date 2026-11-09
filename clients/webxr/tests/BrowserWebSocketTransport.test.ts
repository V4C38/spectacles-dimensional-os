import { describe, expect, it, vi } from "vitest";
import { BrowserWebSocketTransport } from "../src/websocket/BrowserWebSocketTransport";

class FakeSocket {
  binaryType = "";
  readyState = 0;
  sent: Array<string | Uint8Array> = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.(new Event("close"));
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
}

describe("BrowserWebSocketTransport", () => {
  it("opens, frames text and binary, and closes", () => {
    const socket = new FakeSocket();
    const transport = new BrowserWebSocketTransport({
      url: "wss://example.test/ar",
      socketFactory: () => socket as unknown as WebSocket,
    });
    const handlers = {
      onTransportOpen: vi.fn(),
      onTransportClose: vi.fn(),
      onTransportText: vi.fn(),
      onTransportBinary: vi.fn(),
    };
    transport.bind(handlers);
    transport.connect();
    socket.open();
    expect(handlers.onTransportOpen).toHaveBeenCalledOnce();
    socket.onmessage?.({ data: '{"type":"hello"}\n' } as MessageEvent);
    expect(handlers.onTransportText).toHaveBeenCalledWith('{"type":"hello"}\n');
    socket.onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer } as MessageEvent);
    expect(handlers.onTransportBinary).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    transport.sendText("ping");
    transport.sendBinary(new Uint8Array([9]));
    expect(socket.sent).toEqual(["ping", new Uint8Array([9])]);
    transport.close();
    expect(handlers.onTransportClose).not.toHaveBeenCalled();
  });

  it("emits close on socket failure", () => {
    const socket = new FakeSocket();
    const transport = new BrowserWebSocketTransport({
      url: "wss://example.test/ar",
      socketFactory: () => socket as unknown as WebSocket,
    });
    const onTransportClose = vi.fn();
    transport.bind({
      onTransportOpen: vi.fn(),
      onTransportClose,
      onTransportText: vi.fn(),
      onTransportBinary: vi.fn(),
    });
    transport.connect();
    socket.open();
    socket.close();
    expect(onTransportClose).toHaveBeenCalledOnce();
  });
});

it("ignores obsolete socket callbacks after reconnect", async () => {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const transport = new BrowserWebSocketTransport({
    url: "wss://gateway/ar",
    socketFactory: url => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  const handlers = { onTransportOpen: vi.fn(), onTransportClose: vi.fn(),
    onTransportText: vi.fn(), onTransportBinary: vi.fn() };
  transport.bind(handlers);
  try {
    transport.connect();
    sockets[0].open();
    const oldText = sockets[0].onmessage!;
    const oldClose = sockets[0].onclose!;
    transport.connect();
    await Promise.resolve();
    sockets[1].open();
    oldText({ data: "stale authority" } as MessageEvent);
    oldClose(new Event("close"));
    sockets[1].onmessage!({ data: "current authority" } as MessageEvent);
    expect(handlers.onTransportText.mock.calls).toEqual([["current authority"]]);
    expect(handlers.onTransportClose).not.toHaveBeenCalled();
    transport.sendText("still connected");
    expect(sockets[1].sent).toEqual(["still connected"]);
    const bulk = transport.createSibling("/bulk");
    try {
      bulk.connect();
      expect(urls.at(-1)).toBe("wss://gateway/bulk");
    } finally { bulk.close(); }
  } finally { transport.close(); }
});
