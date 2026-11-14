import { LocalizationTrackingReporter } from "./LocalizationTrackingReporter";
import { AR_MODULE_CLIENT_CONFIG, type CameraCaptureSource, type CameraTrackingSource, type CaptureGeometry, type ClientClock, type CapturePolicy, type LocalizationObservation, type LocalizationObservationsRequest, type Outbound } from "../ClientContracts";
import {
  encodeLocalizationStartRequest,
} from "../websocket/protocol";
import type { ARModuleSession } from "../websocket/ARModuleSession";

import { type ClientTrackingOriginStore, odomToClientTrackingPose, passesGeometricGate } from "./ClientTracking";



const DELIBERATE_RECOVERY_CAPTURE_S = 10;

export type LocalizationCapturePhase =
  | "idle"
  | "waiting_for_geometric_gate"
  | "waiting_for_retry"
  | "capturing"
  | "awaiting_result"
  | "failed";

export interface LocalizationCaptureConfig {
  retryBackoffS: number;
}

export interface LocalizationCaptureState {
  phase: LocalizationCapturePhase;
  lastError: string | null;
  /** Null means no automatic retry is scheduled. */
  retryInS?: number | null;
  capturePolicy?: CapturePolicy | null;
  capturedCount?: number;
  observationCount?: number;
}

export type LocalizationTrace = { stage: string; atS: number; phase: LocalizationCapturePhase; captured: number; detail?: string };

export type LocalizationSessionPort = Pick<ARModuleSession,
  "view" | "sendText" | "submitLocalizationObservations" | "cancelLocalizationSubmission" |
  "subscribeOutbound" | "subscribeView" | "localizationResultDeadline">;

export interface LocalizationCaptureDependencies {
  session: LocalizationSessionPort;
  clientTrackingOriginStore: ClientTrackingOriginStore;
  clock: ClientClock;
  tracking: CameraTrackingSource;
  capture: CameraCaptureSource;
  geometry?: CaptureGeometry;
  config?: LocalizationCaptureConfig;
  initiallyPaused?: boolean;
  runtimeCapture?: { retryDelaysS: readonly number[]; stopWhileAwaitingResult: boolean };
  trace?: (event: LocalizationTrace) => void;
}

type CaptureFailure = { kind: "capture" | "result_timeout"; message: string };
type CaptureRequest = { message: LocalizationObservationsRequest; gateDeadline: number | null };
type CaptureEpisode =
  | { phase: "idle"; request: CaptureRequest | null; retryAt: number | null }
  | { phase: "waiting_for_geometric_gate"; request: CaptureRequest }
  | { phase: "waiting_for_retry"; request: CaptureRequest; retryAt: number }
  | { phase: "capturing"; request: CaptureRequest; observations: LocalizationObservation[]; nextAt: number }
  | { phase: "awaiting_result"; request: CaptureRequest; capturedCount: number }
  | { phase: "failed"; request: CaptureRequest | null; failure: CaptureFailure; retryAt: number | null };

/** Camera hardware and async generations have one lifecycle independent of episode phases. */
class CameraCaptureWork {
  private generation = 0;
  private pending: { generation: number } | null = null;
  private running = false;

  constructor(private readonly source: CameraCaptureSource) {}

  get started(): boolean { return this.running; }
  get inFlight(): boolean { return this.pending !== null; }

  start(): void {
    if (this.running) return;
    this.source.start();
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    this.source.stop();
    this.running = false;
  }

  retire(stop = false): void {
    this.generation++;
    if (stop) {
      this.pending = null;
      this.stop();
    }
  }

  capture(canEncode: () => boolean,
    settled: (observation: LocalizationObservation | null, error: unknown) => void): void {
    if (this.pending) return;
    const generation = this.generation;
    const promise = this.source.capture(() => generation === this.generation && canEncode());
    const pending = { generation };
    this.pending = pending;
    const complete = (observation: LocalizationObservation | null, error: unknown) => {
      if (this.pending === pending) this.pending = null;
      if (generation === this.generation) settled(observation, error);
    };
    promise.then(observation => complete(observation, null), error => complete(null, error));
  }
}

export class LocalizationCaptureEpisode {
  private readonly session: LocalizationSessionPort;
  private readonly clientTrackingOriginStore: ClientTrackingOriginStore;
  private readonly clock: ClientClock;
  private readonly tracking: CameraTrackingSource;
  private readonly camera: CameraCaptureWork;
  private readonly geometry: CaptureGeometry;
  private readonly retryBackoffS: number;
  private readonly runtimeCapture?: LocalizationCaptureDependencies["runtimeCapture"];
  private runtimeMisses = 0;
  private episode: CaptureEpisode = { phase: "idle", request: null, retryAt: null };
  private recoveryRequestedUntil: number | null = null;
  private recoveryUntil: number | null = null;
  private captureEnabled: boolean;
  private suspended = false;
  private readonly traceSink?: (event: LocalizationTrace) => void;
  private episodeStartedAt: number | null = null;
  private episodeEndedAt: number | null = null;
  private readonly trackingReporter: LocalizationTrackingReporter;
  private batchStartedAt: number | null = null;
  private sentAt: number | null = null;
  private batchesSent = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(deps: LocalizationCaptureDependencies) {
    this.traceSink = deps.trace;
    this.runtimeCapture = deps.runtimeCapture;
    if (this.runtimeCapture && (!this.runtimeCapture.retryDelaysS.length ||
      this.runtimeCapture.retryDelaysS.some(value => !Number.isFinite(value) || value < 0))) {
      throw new Error("Invalid runtime retry delays");
    }
    this.session = deps.session;
    this.clientTrackingOriginStore = deps.clientTrackingOriginStore;
    this.clock = deps.clock;
    this.tracking = deps.tracking;
    this.camera = new CameraCaptureWork(deps.capture);
    this.trackingReporter = new LocalizationTrackingReporter(deps.session, deps.clientTrackingOriginStore, deps.tracking, deps.clock);
    this.captureEnabled = !deps.initiallyPaused;
    this.geometry = requireGeometry(deps.geometry ?? AR_MODULE_CLIENT_CONFIG.capture.geometry);
    const config = deps.config ?? AR_MODULE_CLIENT_CONFIG.capture.episode;
    this.retryBackoffS = requireNonNegative(config.retryBackoffS, "retryBackoffS");
    this.unsubscribers.push(
      this.session.subscribeOutbound(message => this.onOutbound(message)),
      this.session.subscribeView(view => {
        if (view.connection !== "ready") this.resetIdle();
      }),
    );
  }

  private get request(): LocalizationObservationsRequest | null {
    return this.episode.request?.message ?? null;
  }

  private publishTracking(force = false, inactive = false): void {
    this.trackingReporter.publish(!inactive && this.captureEnabled && !this.suspended, force);
  }

  private captureProgress(phase: "waiting" | "capturing" | "submitted" | "unavailable", timestamp?: number): void {
    this.trackingReporter.progress(this.request, phase, this.captureEnabled && !this.suspended, timestamp);
  }

  timing() {
    const now = this.episodeEndedAt ?? this.clock.now();
    return {
      episodeS: this.episodeStartedAt === null ? 0 : now - this.episodeStartedAt,
      batchS: this.batchStartedAt === null ? 0 : (this.sentAt ?? now) - this.batchStartedAt,
      resultWaitS: this.sentAt === null ? 0 : now - this.sentAt,
      batchesSent: this.batchesSent,
    };
  }

  view(): LocalizationCaptureState {
    const episode = this.episode;
    return {
      phase: episode.phase,
      capturePolicy: this.request?.capture_policy ?? null,
      lastError: episode.phase === "failed" ? episode.failure.message : null,
      retryInS: episode.phase === "failed" && episode.retryAt !== null
        ? Math.max(0, episode.retryAt - this.clock.now()) : null,
      capturedCount: episode.phase === "capturing" ? episode.observations.length
        : episode.phase === "awaiting_result" ? episode.capturedCount : 0,
      observationCount: this.request?.observation_count ?? 0,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.resetIdle();
  }

  reset(): void {
    this.trackingReporter.reset();
    this.captureEnabled = false;
    this.resetIdle();
  }

  pause(): void {
    // Pausing retains the server request so setup can resume the same episode.
    const request = this.episode.request;
    this.captureEnabled = false;
    this.resetIdle();
    this.episode = { phase: "idle", request, retryAt: null };
  }

  /** Visibility loss retires camera work without cancelling an already submitted batch. */
  suspend(): void {
    if (this.suspended) return;
    this.publishTracking(true, true);
    this.trackingReporter.pause();
    this.suspended = true;
    this.camera.retire(true);
    if (this.episode.phase === "awaiting_result" || this.episode.phase === "failed") return;
    const retryAt = this.episode.phase === "waiting_for_retry" ? this.episode.retryAt : null;
    this.episode = { phase: "idle", request: this.episode.request, retryAt };
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    if (!this.captureEnabled || this.episode.phase === "awaiting_result" || this.episode.phase === "failed") return;
    if (this.request !== null) this.onRequest(this.request);
  }

  requestCorrection(): void {
    if (!["idle", "failed", "waiting_for_retry"].includes(this.episode.phase)) return;
    this.requestStart();
  }

  requestStart(): void {
    this.episodeStartedAt = this.clock.now();
    this.episodeEndedAt = null;
    this.batchesSent = 0;
    this.trace("start-requested");
    const view = this.session.view();
    if (view.connection !== "ready") throw new Error("localization capture requires a ready session");
    if (!view.capabilities?.localization.available) throw new Error("localization capability unavailable");
    if (!["idle", "failed", "waiting_for_retry"].includes(this.episode.phase)) {
      throw new Error("localization capture already active");
    }
    this.runtimeMisses = 0;
    // Explicit realignment bypasses only the local geometry hint for one bounded batch.
    this.recoveryRequestedUntil = this.clientTrackingOriginStore.hasTrackingOrigin && !this.clientTrackingOriginStore.mapContext
      ? this.clock.now() + DELIBERATE_RECOVERY_CAPTURE_S : null;
    this.captureEnabled = true;
    if ((this.episode.phase === "idle" || this.episode.phase === "waiting_for_retry") && this.request !== null) {
      this.onRequest(this.request);
      return;
    }
    this.publishTracking(true);
    this.session.sendText(encodeLocalizationStartRequest());
    if (this.episode.phase === "failed") this.episode.retryAt = null;
  }

  tick(): void {
    this.publishTracking();
    const now = this.clock.now();
    if (this.suspended) {
      this.checkResultDeadline(now);
      return;
    }
    const episode = this.episode;
    if (episode.phase === "waiting_for_retry") {
      if (now >= episode.retryAt) this.onRequest(episode.request.message);
      return;
    }
    if (episode.phase === "waiting_for_geometric_gate") {
      try {
        if (this.geometricGatePasses()) this.enterCapturing(episode.request);
        else if (this.preferredTimedOut(episode.request, now)) {
          if (this.request?.purpose === "robot") {
            this.captureProgress("unavailable");
            this.resetIdle();
          } else this.enterCapturing(episode.request);
        }
      } catch (error) {
        this.enterFailed(errorMessage(error));
        return;
      }
    }
    if (this.episode.phase === "capturing") {
      try {
        if (this.requiresContinuousGate() && this.shouldWaitForGeometricGate()) {
          this.onRequest(this.episode.request.message);
          return;
        }
      } catch (error) {
        this.enterFailed(errorMessage(error));
        return;
      }
      this.tickCapture(now);
    } else if (this.episode.phase === "awaiting_result") this.checkResultDeadline(now);
    else if (this.episode.phase === "failed") this.tickRetry(now);
  }

  private checkResultDeadline(now: number): void {
    if (this.episode.phase !== "awaiting_result") return;
    const deadline = this.session.localizationResultDeadline();
    // A retired submission has no future result to wait for (for example a rejected upload).
    if (deadline === null || now >= deadline) this.enterFailed("result timeout", "result_timeout");
  }

  private runtimeRetryDeadline(): number | null {
    if (!this.runtimeCapture || !this.clientTrackingOriginStore.hasTrackingOrigin || this.sentAt === null) return null;
    const delays = this.runtimeCapture.retryDelaysS;
    const delay = delays[Math.min(this.runtimeMisses++, delays.length - 1)];
    const deadline = this.sentAt + delay;
    this.trace("runtime-retry-scheduled", `misses=${this.runtimeMisses}; earliest=${deadline}`);
    return deadline;
  }

  captureBudget() {
    const retryAt = this.episode.phase === "waiting_for_retry" || this.episode.phase === "failed"
      ? this.episode.retryAt : null;
    return {
      runtimeMisses: this.runtimeMisses,
      retryInS: this.runtimeMisses > 0 ? Math.max(0, (retryAt ?? this.clock.now()) - this.clock.now()) : 0,
      hardwareStarted: this.camera.started,
      captureInFlight: this.camera.inFlight,
    };
  }

  private onRequest(request: LocalizationObservationsRequest): void {
    const previous = this.episode.request;
    const captureRequest: CaptureRequest = request === previous?.message ? previous : { message: request, gateDeadline: null };
    this.recoveryUntil = this.recoveryRequestedUntil;
    this.recoveryRequestedUntil = null;
    let retryAt = this.episode.phase === "waiting_for_retry" || this.episode.phase === "idle" ? this.episode.retryAt : null;
    if (this.episode.phase === "awaiting_result" && !request.episode_id) retryAt = this.runtimeRetryDeadline();
    if (request.episode_id) {
      retryAt = null;
      this.runtimeMisses = 0;
    }
    this.session.cancelLocalizationSubmission();
    if (this.episode.phase === "idle" && this.captureEnabled) {
      this.episodeStartedAt = this.clock.now();
      this.episodeEndedAt = null;
      this.batchesSent = 0;
    }
    this.trace("capture-request-received", request.capture_policy);
    this.camera.retire();
    this.episode = { phase: "idle", request: captureRequest, retryAt: null };
    if (!this.captureEnabled || this.suspended) return;
    this.batchStartedAt = this.clock.now();
    this.sentAt = null;
    if (retryAt !== null && this.clock.now() < retryAt) {
      this.episode = { phase: "waiting_for_retry", request: captureRequest, retryAt };
      this.camera.stop();
      return;
    }
    try {
      if (this.shouldWaitForGeometricGate()) {
        if (request.capture_policy === "robot_los_preferred") {
          captureRequest.gateDeadline ??= this.clock.now() + request.wait_timeout_s;
        }
        this.episode = { phase: "waiting_for_geometric_gate", request: captureRequest };
        this.camera.stop();
        this.captureProgress("waiting");
      } else this.enterCapturing(captureRequest);
    } catch (error) {
      this.enterFailed(errorMessage(error));
    }
  }

  private onOutbound(message: Outbound): void {
    if (message.type === "localization_observations_request") {
      this.onRequest(message);
      return;
    }
    if (message.type === "localization_context") {
      this.publishTracking(true);
      return;
    }
    if (message.type === "localization_status") {
      if (message.episode_id && message.episode_id === this.request?.episode_id) this.resetIdle(message.status === "succeeded");
      return;
    }
    if (message.type !== "localization_result") return;
    this.episodeEndedAt = this.clock.now();
    this.trace("result-received");
    if (this.episode.phase !== "idle") this.resetIdle();
    this.publishTracking(true);
  }

  private requiresContinuousGate(): boolean {
    return this.request?.capture_policy === "robot_los_required" || this.request?.purpose === "robot";
  }

  private shouldWaitForGeometricGate(): boolean {
    if (this.recoveryUntil !== null && this.clock.now() < this.recoveryUntil) return false;
    if (!this.clientTrackingOriginStore.hasTrackingOrigin || this.request?.capture_policy === "any_angle") return false;
    return !this.geometricGatePasses();
  }

  private geometricGatePasses(): boolean {
    const origin = this.clientTrackingOriginStore.T_odom_client;
    const pose = this.session.view().pose;
    if (origin === null || pose === null) return false;
    const robot = odomToClientTrackingPose(pose, origin);
    return passesGeometricGate(this.tracking.cameraOptical(), robot.position, this.geometry);
  }

  private preferredTimedOut(request: CaptureRequest, now: number): boolean {
    return request.message.capture_policy === "robot_los_preferred" && request.gateDeadline !== null && now >= request.gateDeadline;
  }

  private enterCapturing(request: CaptureRequest): void {
    this.episode = { phase: "capturing", request, observations: [], nextAt: this.clock.now() };
    this.captureProgress("capturing");
    this.camera.start();
  }

  private tickCapture(now: number): void {
    const episode = this.episode;
    if (episode.phase !== "capturing" || this.camera.inFlight || now < episode.nextAt) return;
    try {
      this.trace("capture-start");
      this.camera.capture(() => {
        if (this.episode !== episode || this.suspended || !this.captureEnabled) return false;
        try { return !this.requiresContinuousGate() || !this.shouldWaitForGeometricGate(); }
        catch { return false; }
      }, (observation, error) => {
        try { this.onCaptureSettled(episode, observation, error); }
        catch (settleError) { this.captureFailed(settleError); }
      });
    } catch (error) {
      this.captureFailed(error);
    }
  }

  private onCaptureSettled(episode: Extract<CaptureEpisode, { phase: "capturing" }>,
    observation: LocalizationObservation | null, error: unknown): void {
    if (this.episode !== episode) return;
    if (error !== null || observation === null) {
      try {
        if (this.requiresContinuousGate() && this.shouldWaitForGeometricGate()) {
          this.onRequest(episode.request.message);
          return;
        }
      } catch (gateError) {
        this.captureFailed(gateError);
        return;
      }
      this.captureFailed(error);
      return;
    }
    if (episode.request.message.purpose === "robot" && this.shouldWaitForGeometricGate()) {
      this.onRequest(episode.request.message);
      return;
    }
    episode.observations.push(observation);
    this.trace("frame-captured");
    if (episode.observations.length < episode.request.message.observation_count) {
      episode.nextAt = this.clock.now() + this.geometry.frameSpacingS;
    } else this.sendBatch(episode, this.clock.now());
  }

  private sendBatch(episode: Extract<CaptureEpisode, { phase: "capturing" }>, now: number): void {
    this.recoveryUntil = null;
    this.episode = { phase: "awaiting_result", request: episode.request, capturedCount: episode.observations.length };
    try {
      this.captureProgress("submitted", Math.max(...episode.observations.map(observation => observation.ts_capture)));
      this.session.submitLocalizationObservations(episode.observations, episode.request.message.result_timeout_s);
    } catch (error) {
      this.enterFailed(errorMessage(error));
      return;
    }
    if (this.runtimeCapture?.stopWhileAwaitingResult && this.clientTrackingOriginStore.hasTrackingOrigin) this.camera.stop();
    this.sentAt = now;
    this.batchesSent++;
    this.trace("batch-sent", `bytes=${episode.observations.reduce((sum, observation) => sum + observation.jpeg.length, 0)}`);
  }

  private tickRetry(now: number): void {
    const episode = this.episode;
    if (episode.phase !== "failed" || episode.retryAt === null || now < episode.retryAt) return;
    if (this.session.view().connection !== "ready") return;
    if (episode.request !== null && episode.failure.kind !== "result_timeout") {
      this.onRequest(episode.request.message);
      return;
    }
    this.session.sendText(encodeLocalizationStartRequest());
    if (this.episode === episode) episode.retryAt = null;
  }

  private captureFailed(error: unknown): void {
    if (this.request?.episode_id) {
      this.captureProgress("unavailable");
      this.resetIdle(false);
      return;
    }
    this.enterFailed(errorMessage(error));
    if (error !== null && typeof error === "object" && "retryable" in error && error.retryable === false && this.episode.phase === "failed") {
      this.episode.retryAt = null;
      this.camera.stop();
    }
  }

  private enterFailed(reason: string, kind: CaptureFailure["kind"] = "capture"): void {
    this.recoveryUntil = null;
    this.recoveryRequestedUntil = null;
    if (this.request?.episode_id) {
      this.captureProgress("unavailable");
      this.resetIdle(false);
      return;
    }
    const runtimeRetryAt = kind === "result_timeout" ? this.runtimeRetryDeadline() : null;
    this.session.cancelLocalizationSubmission();
    this.camera.retire();
    this.episode = {
      phase: "failed", request: this.episode.request, failure: { kind, message: reason },
      retryAt: Math.max(this.clock.now() + this.retryBackoffS, runtimeRetryAt ?? -Infinity),
    };
    this.trace("failed", reason);
  }

  private resetIdle(stopCamera = true): void {
    this.recoveryUntil = null;
    this.recoveryRequestedUntil = null;
    this.runtimeMisses = 0;
    this.session.cancelLocalizationSubmission();
    this.camera.retire(stopCamera);
    this.episode = { phase: "idle", request: null, retryAt: null };
  }

  private trace(stage: string, detail?: string): void {
    this.traceSink?.({ stage, atS: this.clock.now(), phase: this.episode.phase,
      captured: this.view().capturedCount ?? 0, detail });
  }
}

function requireGeometry(geometry: CaptureGeometry): CaptureGeometry {
  const minDistanceM = requirePositive(geometry.minDistanceM, "minDistanceM");
  const maxDistanceM = requirePositive(geometry.maxDistanceM, "maxDistanceM");
  if (!(minDistanceM < maxDistanceM)) {
    throw new Error("minDistanceM must be less than maxDistanceM");
  }
  return {
    minDistanceM,
    maxDistanceM,
    lookAtMaxAngleDeg: requirePositive(geometry.lookAtMaxAngleDeg, "lookAtMaxAngleDeg"),
    frameSpacingS: requirePositive(geometry.frameSpacingS, "frameSpacingS"),
  };
}

function requirePositive(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number greater than 0`);
  }
  return value;
}

function requireNonNegative(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number >= 0`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
