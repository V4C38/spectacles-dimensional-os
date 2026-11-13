import { HeadsetTravel } from "./HeadsetTravel";
import type { ClientTrackingOriginStore } from "./clientTrackingOrigin";
import type { ARModuleSession } from "../websocket/arModuleSession";
import type { CameraTrackingSource, ClientClock } from "../websocket/hostPorts";
import type { LocalizationObservationsRequest, LocalizationCaptureProgress, LocalizationTracking } from "../websocket/protocolTypes";
import { encodeText } from "../websocket/protocol";

/** Reports physical tracking facts independently of capture retries and UI phases. */
export class LocalizationTrackingReporter {
  private readonly travel = new HeadsetTravel();
  private reference = this.newReference();
  private lastReport = -Infinity;
  private reportedActive: boolean | null = null;
  private reportedAlignment: string | null = null;
  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText">,
    private readonly origins: ClientTrackingOriginStore, private readonly tracking: CameraTrackingSource,
    private readonly clock: ClientClock) {}

  reset(): void {
    this.reference = this.newReference(); this.travel.reset(); this.tracking.clearTracking?.();
    this.origins.beginTrackingReference(this.reference);
  }
  publish(active: boolean, force = false): void {
    if (!this.origins.mapContext || this.session.view().connection !== "ready") return;
    this.origins.beginTrackingReference(this.reference);
    try {
      if (active) this.travel.sample(this.tracking.trackingPosition?.() ?? this.tracking.cameraOptical().position, this.clock.now());
    } catch { active = false; }
    if (!active) this.travel.pause();
    const alignment = this.origins.mapAlignment?.id ?? null, now = this.clock.now();
    if (!force && active === this.reportedActive && alignment === this.reportedAlignment && now - this.lastReport < 1) return;
    const message: LocalizationTracking = { type: "localization_tracking", tracking_reference_id: this.reference,
      travel_m: this.travel.total, active, ...(alignment ? { alignment_id: alignment } : {}) };
    this.session.sendText(encodeText(message));
    this.lastReport = now; this.reportedActive = active; this.reportedAlignment = alignment;
  }
  pause(): void { this.travel.pause(); }
  progress(request: LocalizationObservationsRequest | null, phase: LocalizationCaptureProgress["phase"], active: boolean, timestamp?: number): void {
    if (!request?.episode_id || this.session.view().connection !== "ready") return;
    this.publish(active, true);
    const message: LocalizationCaptureProgress = { type: "localization_capture_progress", episode_id: request.episode_id,
      phase, travel_m: timestamp === undefined ? this.travel.total : this.travel.at(timestamp),
      ...(timestamp === undefined ? {} : { capture_ts: timestamp }) };
    this.session.sendText(encodeText(message));
  }
  private newReference(): string { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}
