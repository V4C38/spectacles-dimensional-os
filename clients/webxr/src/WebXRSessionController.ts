import { reportDiagnostic } from "./diagnostics/BrowserDiagnostics";

export interface WebXRSessionPorts {
  renderer(): { getReferenceSpace(): XRReferenceSpace | null; setReferenceSpace(reference: XRReferenceSpace): void };
  localized(): boolean;
  setupCompleted(): boolean;
  suspend(): void;
  reset(): void;
  resume(): void;
  recoverUnknownReset(): void;
  reviewAlignment(reason: string): void;
  inputSourcesChanged(): void;
  detach(): void;
  end(): void;
}

/** Owns the immersive session, stable reference space and tracking transitions. */
export class WebXRSessionController {
  private sessionValue: XRSession | null = null;
  private reference: XRReferenceSpace | null = null;
  private trackingValue = false;
  private lostAt: number | null = null;
  private pendingReview: string | null = null;
  private lastFrameTime: number | null = null;

  constructor(private readonly ports: WebXRSessionPorts) {}
  get session(): XRSession | null { return this.sessionValue; }
  get tracking(): boolean { return this.trackingValue; }
  get referenceSpace(): XRReferenceSpace | null { return this.reference; }

  start(session?: XRSession): void {
    if (!session || session === this.sessionValue) return;
    this.detach();
    this.sessionValue = session;
    session.addEventListener("visibilitychange", this.onVisibility);
    session.addEventListener("inputsourceschange", this.onInputChange);
    reportDiagnostic("session-start", { visibility: session.visibilityState });
    this.reset();
  }

  end(): void {
    this.reset();
    this.detach();
    reportDiagnostic("session-end");
    this.ports.end();
  }

  sample(time: number, frame?: XRFrame): { viewer: XRViewerPose; reference: XRReferenceSpace; deltaS: number } | null {
    if (!this.sessionValue || !frame || this.sessionValue.visibilityState !== "visible") return null;
    const renderer = this.ports.renderer();
    const reference = this.reference ?? renderer.getReferenceSpace();
    if (!reference) return null;
    if (!this.reference) {
      this.reference = reference;
      reference.addEventListener("reset", this.onReset);
    }
    // A renderer wrapper change is not a tracking reset within the same session.
    if (renderer.getReferenceSpace() !== reference) renderer.setReferenceSpace(reference);
    const viewer = frame.getViewerPose(reference);
    if (!viewer || viewer.emulatedPosition) {
      this.lostAt ??= time;
      if (this.trackingValue) this.suspend();
      return null;
    }
    if (this.lostAt !== null && time - this.lostAt >= 1000 && this.ports.localized()) this.pendingReview ??= "tracking-loss";
    this.lostAt = null;
    if (!this.trackingValue) {
      if (this.pendingReview && this.ports.setupCompleted()) this.ports.reviewAlignment(this.pendingReview);
      this.pendingReview = null;
      this.trackingValue = true;
      this.ports.resume();
    }
    const deltaS = this.lastFrameTime === null ? 0 : Math.min(0.1, Math.max(0, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;
    return { viewer, reference, deltaS };
  }

  detach(): void {
    this.ports.detach();
    this.lastFrameTime = null;
    this.trackingValue = false;
    this.sessionValue?.removeEventListener("visibilitychange", this.onVisibility);
    this.sessionValue?.removeEventListener("inputsourceschange", this.onInputChange);
    this.reference?.removeEventListener("reset", this.onReset);
    this.sessionValue = null;
    this.reference = null;
  }

  private suspend(): void {
    this.lastFrameTime = null;
    this.trackingValue = false;
    this.ports.suspend();
    reportDiagnostic("tracking-suspended", { visibility: this.sessionValue?.visibilityState });
  }

  private reset(): void {
    this.pendingReview = null;
    this.lostAt = null;
    this.lastFrameTime = null;
    this.trackingValue = false;
    this.ports.reset();
  }

  private readonly onInputChange = () => this.ports.inputSourcesChanged();
  private readonly onVisibility = () => {
    if (this.sessionValue?.visibilityState === "hidden" && this.ports.localized()) this.pendingReview = "headset-resume";
    if (this.sessionValue?.visibilityState !== "visible") this.suspend();
  };
  private readonly onReset = (event: Event) => {
    const transform = (event as XRReferenceSpaceEvent).transform;
    reportDiagnostic("reference-space-reset", { compensated: Boolean(transform) });
    const localized = this.ports.localized();
    if (localized) this.pendingReview = "reference-reset";
    if (!transform || !this.reference) {
      if (localized) { this.suspend(); this.ports.recoverUnknownReset(); }
      else this.reset();
      return;
    }
    const reference = this.reference.getOffsetReferenceSpace(transform.inverse);
    this.ports.renderer().setReferenceSpace(reference);
    this.reference.removeEventListener("reset", this.onReset);
    this.reference = reference;
    reference.addEventListener("reset", this.onReset);
    this.suspend();
  };
}
