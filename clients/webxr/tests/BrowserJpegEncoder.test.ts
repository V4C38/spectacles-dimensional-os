import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserJpegEncoder } from "../src/localization/BrowserJpegEncoder";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  reply(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}
function fixture() {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("VideoFrame", class {
    width: number;
    close = vi.fn();
    constructor(video: HTMLVideoElement) { this.width = video.videoWidth; }
  });
  const video = { videoWidth: 1280, videoHeight: 960 } as HTMLVideoElement;
  return { encoder: new BrowserJpegEncoder(), video };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("browser JPEG encoder", () => {
  it("transfers a frozen frame at the original quality and rejects concurrent work", async () => {
    const { encoder, video } = fixture();
    const encoded = encoder.encode(video);
    const worker = FakeWorker.instances[0];
    const [message, transfer] = worker.postMessage.mock.calls[0];
    expect(message.quality).toBe(0.85);
    expect(message.frame.width).toBe(1280);
    expect(transfer).toEqual([message.frame]);
    await expect(encoder.encode(video)).rejects.toThrow("already pending");
    worker.reply({ id: message.id, jpeg: new Uint8Array([255, 216]).buffer, width: 1280, height: 960 });
    expect(await encoded).toEqual({ jpeg: new Uint8Array([255, 216]), width: 1280, height: 960 });
    encoder.dispose();
  });

  it("cancels old work and ignores its late response after restart", async () => {
    const { encoder, video } = fixture();
    const first = encoder.encode(video);
    const cancelled = expect(first).rejects.toThrow("cancelled");
    const old = FakeWorker.instances[0];
    encoder.cancel(); await cancelled;
    expect(old.terminate).toHaveBeenCalledOnce();
    const second = encoder.encode(video);
    old.reply({ id: 1, jpeg: new ArrayBuffer(2), width: 1, height: 1 });
    FakeWorker.instances[1].reply({ id: 2, jpeg: new ArrayBuffer(3), width: 1280, height: 960 });
    expect((await second).jpeg.length).toBe(3);
    encoder.dispose();
  });

  it("bounds a stalled worker instead of waiting for an Android idle timeout", async () => {
    vi.useFakeTimers();
    const { encoder, video } = fixture();
    const pending = expect(encoder.encode(video)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1500); await pending;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("reuses a synchronous JPEG fallback when worker APIs are absent", async () => {
    const { encoder, video } = fixture();
    vi.stubGlobal("OffscreenCanvas", undefined);
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: vi.fn(() => "data:image/jpeg;base64,/9g=") };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal("document", { createElement });
    expect((await encoder.encode(video)).jpeg).toEqual(new Uint8Array([255, 216]));
    await encoder.encode(video);
    expect(createElement).toHaveBeenCalledOnce();
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.85);
    encoder.dispose();
  });
});
