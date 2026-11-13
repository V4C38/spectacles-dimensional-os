import type { ARModuleSession } from "../websocket/arModuleSession";
import type { LocalizationCaptureEpisode } from "../localization/localizationCaptureEpisode";
export type SetupStep = "connect" | "localization";
export type AlignmentReview = Readonly<{ reason: string; pending: boolean }>;
export type SetupSnapshot = Readonly<{
  step: SetupStep; completed: boolean; openedFromRuntime: boolean; alignmentReview: AlignmentReview | null;
}>;
/** Common setup/capture transitions; host connection methods and UI remain adapters. */
export class SetupFlow {
  private currentStep: SetupStep = "connect";
  private isCompleted = false;
  private fromRuntime = false;
  private review: AlignmentReview | null = null;
  constructor(private readonly session: Pick<ARModuleSession, "view">, private readonly episode: Pick<LocalizationCaptureEpisode, "pause" | "requestStart">) {}
  get step(): SetupStep { return this.currentStep; }
  get completed(): boolean { return this.isCompleted; }
  get openedFromRuntime(): boolean { return this.fromRuntime; }
  get alignmentReview(): AlignmentReview | null { return this.review && { ...this.review }; }
  snapshot(): SetupSnapshot { return { step: this.step, completed: this.completed, openedFromRuntime: this.openedFromRuntime, alignmentReview: this.alignmentReview }; }
  showStep(step: SetupStep): void {
    if (step === "connect" && this.currentStep === "localization") this.episode.pause();
    this.currentStep = step;
  }
  restart(fromRuntime = this.completed): void {
    this.fromRuntime = fromRuntime; this.isCompleted = false; this.currentStep = "connect";
    this.review = null; this.episode.pause();
  }
  startLocalization(): boolean {
    const view = this.session.view(); this.showStep("localization");
    if (view.connection !== "ready" || view.hasTrackingOrigin || view.capabilities?.localization.available !== true) return false;
    this.episode.requestStart(); return true;
  }
  previous(): void { this.showStep("connect"); }
  finish(): void {
    if (!this.session.view().hasTrackingOrigin) this.episode.pause();
    this.isCompleted = true; this.fromRuntime = false;
  }
  requestAlignmentReview(reason: string): void { this.review = { reason, pending: true }; }
  dismissAlignmentReview(): void { if (this.review) this.review = { ...this.review, pending: false }; }
  clearAlignmentReview(): void { this.review = null; }
}
