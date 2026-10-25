import type { ARModuleSession } from "../websocket/arModuleSession";
import type { LocalizationCaptureEpisode } from "../localization/localizationCaptureEpisode";
export type SetupStep = "connect" | "localization";
export type AlignmentReview = { reason: string; pending: boolean };
/** Common setup/capture transitions; host connection methods and UI remain adapters. */
export class SetupFlow {
  step: SetupStep = "connect";
  completed = false;
  openedFromRuntime = false;
  alignmentReview: AlignmentReview | null = null;
  constructor(private readonly session: Pick<ARModuleSession, "view" | "stop">, private readonly episode: Pick<LocalizationCaptureEpisode, "pause" | "requestStart">) {}
  restart(fromRuntime = this.completed): void {
    this.openedFromRuntime = fromRuntime; this.completed = false; this.step = "connect";
    this.alignmentReview = null; this.episode.pause();
  }
  startLocalization(): boolean {
    const view = this.session.view(); this.step = "localization";
    if (view.connection !== "ready" || view.hasTrackingOrigin || view.capabilities?.localization.available !== true) return false;
    this.episode.requestStart(); return true;
  }
  previous(): void { if (this.step === "localization") { this.episode.pause(); this.step = "connect"; } }
  finish(): void {
    if (!this.session.view().hasTrackingOrigin) this.episode.pause();
    this.completed = true; this.openedFromRuntime = false;
  }
  requestAlignmentReview(reason: string): void { this.alignmentReview = { reason, pending: true }; }
  dismissAlignmentReview(): void { if (this.alignmentReview) this.alignmentReview = { ...this.alignmentReview, pending: false }; }
}
