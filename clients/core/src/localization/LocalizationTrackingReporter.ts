import type { ClientTrackingOriginStore } from "./ClientTracking";
import type { ARModuleSession } from "../websocket/ARModuleSession";
import type { CameraTrackingSource, ClientClock, LocalizationObservationsRequest, LocalizationCaptureProgress, LocalizationTracking, Vec3 } from "../ClientContracts";

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
    this.reference = this.newReference();
    this.travel.reset();
    this.tracking.clearTracking?.();
    this.origins.beginTrackingReference(this.reference);
  }
  publish(active: boolean, force = false): void {
    if (!this.origins.mapContext || this.session.view().connection !== "ready") return;
    this.origins.beginTrackingReference(this.reference);
    try {
      if (active) this.travel.sample(this.tracking.trackingPosition?.() ?? this.tracking.cameraOptical().position, this.clock.now());
    } catch {
      active = false;
    }
    if (!active) this.travel.pause();
    const alignment = this.origins.mapAlignment?.id ?? null;
    const now = this.clock.now();
    if (!force && active === this.reportedActive && alignment === this.reportedAlignment && now - this.lastReport < 1) return;
    const message: LocalizationTracking = { type: "localization_tracking", tracking_reference_id: this.reference,
      travel_m: this.travel.total, active, ...(alignment ? { alignment_id: alignment } : {}) };
    this.session.sendText(encodeText(message));
    this.lastReport = now;
    this.reportedActive = active;
    this.reportedAlignment = alignment;
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

/** Horizontal physical travel in one headset tracking reference, independent of AR corrections. */
export class HeadsetTravel {
  private distance = 0;
  get total(): number { return this.distance; }
  private anchor: Vec3 | null = null;
  private lastAt: number | null = null;
  private history: { at: number; travel: number }[] = [];
  sample(position: Readonly<Vec3>, now: number): void {
    if (position.some(value => !Number.isFinite(value)) || !Number.isFinite(now)) {
      this.pause();
      return;
    }
    if (this.lastAt !== null && now - this.lastAt < 0.1) return;
    if (this.lastAt === null || now - this.lastAt > 0.5) this.anchor = null;
    if (this.anchor) {
      const distance = Math.hypot(position[0] - this.anchor[0], position[1] - this.anchor[1]);
      if (distance >= 0.05) {
        this.distance += distance;
        this.anchor = [...position];
      }
    } else this.anchor = [...position];
    this.lastAt = now;
    this.history.push({ at: now, travel: this.total });
    if (this.history.length > 300) this.history.shift();
  }
  at(timestamp: number): number {
    for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].at <= timestamp) return this.history[i].travel;
    return this.history[0]?.travel ?? this.total;
  }
  pause(): void {
    this.anchor = null;
    this.lastAt = null;
  }
  reset(): void {
    this.pause();
    this.distance = 0;
    this.history = [];
  }
}
