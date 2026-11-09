import { PairedBulk } from "../../../specs/Tests/fixtures/PairedBulk";

/** Browser socket adapter for the explicit paired v2 test peer. */
export function pairedBulkSocket(uploaded: (bytes: Uint8Array) => void = () => {}): WebSocket & { lidar(data: Uint8Array): void } {
  const peer = new PairedBulk(uploaded);
  let opened: (() => void) | null = null, received: ((event: MessageEvent) => void) | null = null;
  const socket = {
    readyState: 1, binaryType: "arraybuffer", bufferedAmount: 0,
    set onopen(callback: (() => void) | null) { opened = callback; },
    set onmessage(callback: ((event: MessageEvent) => void) | null) {
      received = callback;
      if (callback && opened) opened();
    },
    onclose: null, onerror: null,
    close() { socket.readyState = 3; },
    lidar(data: Uint8Array) { peer.lidar(data); },
    send(value: string | Uint8Array) { if (typeof value === "string") peer.sendText(value); else peer.sendBinary(value); },
  };
  peer.bind({ onTransportOpen() {}, onTransportClose() {}, onTransportText: text => received?.({ data: text } as MessageEvent),
    onTransportBinary: bytes => received?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as MessageEvent) });
  return socket as unknown as WebSocket & { lidar(data: Uint8Array): void };
}
