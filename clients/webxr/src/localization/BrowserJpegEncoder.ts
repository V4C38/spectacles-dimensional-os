import type { JpegEncoder } from "./HmdCameraSource";
import type { EncodeResponse } from "./JpegWorker";
import { reportDiagnostic } from "../diagnostics/BrowserDiagnostics";

type Encoded = Awaited<ReturnType<JpegEncoder["encode"]>>;

/** Freeze pixels synchronously; JPEG work must not wait for main-thread idle time. */
export class BrowserJpegEncoder implements JpegEncoder {
  private worker: Worker | null = null;
  private pending: { id: number; resolve: (value: Encoded) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private sequence = 0;
  private workerFailed = false;
  private canvas: HTMLCanvasElement | null = null;

  constructor(private readonly quality = 0.85) {}

  encode(video: HTMLVideoElement): Promise<Encoded> {
    if (this.pending) return Promise.reject(new Error("JPEG encoding already pending"));
    const worker = this.getWorker();
    if (!worker) {
      try { return Promise.resolve(this.encodeFallback(video)); }
      catch (error) { return Promise.reject(error); }
    }
    // This constructor snapshots the exact frame before the video can advance.
    let frame: VideoFrame;
    try { frame = new VideoFrame(video); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.failWorker(new Error("JPEG encoding timed out")), 1500);
      this.pending = { id, resolve, reject, timer };
      try { worker.postMessage({ id, frame, quality: this.quality }, [frame]); }
      catch (error) { frame.close(); this.failWorker(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  cancel(): void {
    this.rejectPending(new Error("JPEG encoding cancelled"));
    this.worker?.terminate(); this.worker = null;
  }

  dispose(): void { this.cancel(); this.canvas = null; }

  private getWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerFailed || typeof Worker === "undefined" || typeof VideoFrame === "undefined" || typeof OffscreenCanvas === "undefined") return null;
    try {
      this.worker = new Worker(new URL("./JpegWorker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }: MessageEvent<EncodeResponse>) => {
        const pending = this.pending;
        if (!pending || data.id !== pending.id) return;
        if (data.error || !data.jpeg || !data.width || !data.height) { this.failWorker(new Error(data.error ?? "Invalid JPEG worker result")); return; }
        clearTimeout(pending.timer); this.pending = null;
        pending.resolve({ jpeg: new Uint8Array(data.jpeg), width: data.width, height: data.height });
      };
      this.worker.onerror = () => this.failWorker(new Error("JPEG worker failed"));
      return this.worker;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private failWorker(error: Error): void {
    this.workerFailed = true;
    this.rejectPending(error);
    this.worker?.terminate(); this.worker = null;
    reportDiagnostic("jpeg-worker-fallback", { message: error.message }, "warn");
  }

  private rejectPending(error: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const pending = this.pending; this.pending = null; pending.reject(error);
  }

  private encodeFallback(video: HTMLVideoElement): Encoded {
    const canvas = this.canvas ??= document.createElement("canvas");
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is required for JPEG encoding");
    context.drawImage(video, 0, 0);
    // In browsers without worker support, synchronous encoding avoids toBlob's
    // Android idle-task timeout. It is used only for requested captures.
    const data = canvas.toDataURL("image/jpeg", this.quality);
    if (!data.startsWith("data:image/jpeg;base64,")) throw new Error("Browser cannot encode JPEG images");
    const bytes = atob(data.slice(data.indexOf(",") + 1));
    return { jpeg: Uint8Array.from(bytes, value => value.charCodeAt(0)), width: canvas.width, height: canvas.height };
  }
}
