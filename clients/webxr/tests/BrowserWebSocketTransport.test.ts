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
