import { describe, expect, it } from "vitest";
import { DimOSWebXRClient } from "../src/DimOSWebXRClient";
import { BrowserWebSocketTransport } from "../src/websocket/BrowserWebSocketTransport";
import { HMD_PROFILES } from "../src/camera/hmdProfiles";
import { HmdCameraSource } from "../src/camera/HmdCameraSource";

class FakeSocket {
  binaryType = "";
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
}

describe("DimOSWebXRClient", () => {
  it("owns session lifecycle and disposes collaborators", () => {
    const socket = new FakeSocket();
    const transport = new BrowserWebSocketTransport({
      url: "wss://example.test/ar",
      socketFactory: () => socket as unknown as WebSocket,
    });
    const camera = new HmdCameraSource({
      clock: { now: () => 1 },
      profile: HMD_PROFILES.quest3,
      media: {
        enumerateDevices: async () => [],
        getUserMedia: async () => {
          throw new Error("unused");
        },
      },
      frames: { start() {}, stop() {} },
      jpeg: { encode: async () => ({ jpeg: new Uint8Array(), width: 0, height: 0 }) },
    });
    const client = new DimOSWebXRClient({
      transport,
      clock: { now: () => 1 },
      camera,
    });
    client.start();
    socket.open();
    expect(client.session.view().connection).toBe("awaiting_hello");
    expect(() => client.ui.completeSetup()).toThrow("setup requires localization_result");
    client.restartSetup();
    expect(client.ui.setupCompleted).toBe(false);
    client.dispose();
    expect(client.session.view().connection).toBe("disconnected");
  });
});
