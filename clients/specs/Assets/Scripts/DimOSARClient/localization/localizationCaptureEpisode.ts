import {
  AR_MODULE_CLIENT_CONFIG,
  type CameraCaptureSource,
  type CameraTrackingSource,
  type CaptureGeometry,
  type ClientClock,
} from "../websocket/hostPorts";
import {
  encodeLocalizationStartRequest,
} from "../websocket/protocol";
import type { ARModuleSession } from "../websocket/arModuleSession";
import type {
  CapturePolicy,
  LocalizationObservation,
  LocalizationObservationsRequest,
  Outbound,
} from "../websocket/protocolTypes";
import type { ClientTrackingOriginStore } from "./clientTrackingOrigin";
import { odomToClientTrackingPose } from "./clientTrackingTransforms";
import { passesGeometricGate } from "./geometricGate";

export type LocalizationCapturePhase =
  | "idle"
  | "waiting_for_geometric_gate"
  | "waiting_for_retry"
  | "capturing"
  | "sending"
  | "awaiting_result"
  | "failed";

export interface LocalizationCaptureConfig {
  resultTimeoutS: number;
  retryBackoffS: number;
}

export interface LocalizationCaptureState {
  phase: LocalizationCapturePhase;
  lastError: string | null;
  capturePolicy?: CapturePolicy | null;
  capturedCount?: number;
  observationCount?: number;
}

export type LocalizationTrace = { stage: string; atS: number; phase: LocalizationCapturePhase; captured: number; detail?: string };

export type LocalizationSessionPort = Pick<ARModuleSession, "view" | "sendText" | "submitLocalizationObservations" | "cancelLocalizationSubmission" | "subscribeLocalizationObservationsRequest" | "subscribeOutbound" | "subscribeView">;

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

export class LocalizationCaptureEpisode {
  private readonly session: LocalizationSessionPort;
  private readonly clientTrackingOriginStore: ClientTrackingOriginStore;
  private readonly clock: ClientClock;
  private readonly tracking: CameraTrackingSource;
  private readonly capture: CameraCaptureSource;
  private readonly geometry: CaptureGeometry;
  private readonly resultTimeoutS: number;
  private readonly retryBackoffS: number;

  private readonly runtimeCapture?: LocalizationCaptureDependencies["runtimeCapture"];
  private runtimeMisses = 0;
  private runtimeRetryAt: number | null = null;
  private phase: LocalizationCapturePhase = "idle";
  private request: LocalizationObservationsRequest | null = null;
  private observations: LocalizationObservation[] = [];
  private geometricGateWaitStartedAt: number | null = null;
  private nextCaptureAt: number | null = null;
  private resultDeadline: number | null = null;
  private retryAt: number | null = null;
  private lastError: string | null = null;
  private captureGeneration = 0;
  private inflight: Promise<void> | null = null;
  private inflightGeneration: number | null = null;
  private hardwareStarted = false;
  private captureEnabled: boolean;
  private suspended = false;
  private readonly traceSink?: (event: LocalizationTrace) => void;
  private episodeStartedAt: number | null = null;
  private episodeEndedAt: number | null = null;
  private batchStartedAt: number | null = null;
  private sentAt: number | null = null;
  private batchesSent = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(deps: LocalizationCaptureDependencies) {
    this.traceSink = deps.trace;
    this.runtimeCapture = deps.runtimeCapture;
    if (this.runtimeCapture && (!this.runtimeCapture.retryDelaysS.length ||
      this.runtimeCapture.retryDelaysS.some(value => !Number.isFinite(value) || value < 0))) throw new Error("Invalid runtime retry delays");
    this.session = deps.session;
    this.clientTrackingOriginStore = deps.clientTrackingOriginStore;
    this.clock = deps.clock;
    this.tracking = deps.tracking;
    this.capture = deps.capture;
    this.captureEnabled = !deps.initiallyPaused;
    this.geometry = requireGeometry(deps.geometry ?? AR_MODULE_CLIENT_CONFIG.capture.geometry);
    const config = deps.config ?? AR_MODULE_CLIENT_CONFIG.capture.episode;
    this.resultTimeoutS = requirePositive(config.resultTimeoutS, "resultTimeoutS");
    this.retryBackoffS = requireNonNegative(config.retryBackoffS, "retryBackoffS");
    this.unsubscribers.push(
      this.session.subscribeLocalizationObservationsRequest((request) => this.onRequest(request)),
      this.session.subscribeOutbound((message) => this.onOutbound(message)),
      this.session.subscribeView((view) => {
        if (view.connection !== "ready") {
          this.resetIdle();
        }
      }),
    );
  }

  timing() {
    const now = this.episodeEndedAt ?? this.clock.now();
    return { episodeS: this.episodeStartedAt === null ? 0 : now - this.episodeStartedAt,
      batchS: this.batchStartedAt === null ? 0 : (this.sentAt ?? now) - this.batchStartedAt,
      resultWaitS: this.sentAt === null ? 0 : now - this.sentAt, batchesSent: this.batchesSent };
  }

  view(): LocalizationCaptureState {
    return {
      phase: this.phase,
      capturePolicy: this.request?.capture_policy ?? null,
      lastError: this.lastError,
      capturedCount: this.observations.length,
      observationCount: this.request?.observation_count ?? 0,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.resetIdle();
  }

  reset(): void {
    this.captureEnabled = false;
    this.resetIdle();
  }

  pause(): void {
    // Keep the server's pending request so returning to the scan step can
    // resume without asking it to open an episode that is already pending.
    const request = this.request;
    this.captureEnabled = false;
    this.resetIdle();
    this.request = request;
  }

  /** Visibility loss retires camera work without cancelling an already submitted batch. */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.captureGeneration++;
    this.inflight = null;
    this.inflightGeneration = null;
    this.stopHardware();
    if (this.phase === "awaiting_result" || this.phase === "failed") return;
    this.phase = "idle";
    this.observations = [];
    this.geometricGateWaitStartedAt = null;
    this.nextCaptureAt = null;
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    if (!this.captureEnabled || this.phase === "awaiting_result" || this.phase === "failed") return;
    if (this.request !== null) this.onRequest(this.request);
  }

  requestStart(): void {
    this.episodeStartedAt = this.clock.now(); this.episodeEndedAt = null; this.batchesSent = 0; this.trace("start-requested");
    if (this.session.view().connection !== "ready") {
      throw new Error("localization capture requires a ready session");
    }
    if (!this.session.view().capabilities?.localization.available) {
      throw new Error("localization capability unavailable");
    }
    if (this.phase !== "idle" && this.phase !== "failed" && this.phase !== "waiting_for_retry") {
      throw new Error("localization capture already active");
    }
    this.runtimeMisses = 0; this.runtimeRetryAt = null;
    this.captureEnabled = true;
    if ((this.phase === "idle" || this.phase === "waiting_for_retry") && this.request !== null) {
      this.onRequest(this.request);
      return;
    }
    this.session.sendText(encodeLocalizationStartRequest());
    if (this.phase === "failed") {
      this.retryAt = null;
    }
  }

  tick(): void {
    const now = this.clock.now();
    if (this.suspended) {
      if (this.phase === "awaiting_result" && this.resultDeadline !== null && now >= this.resultDeadline) this.enterFailed("result timeout");
      return;
    }
    if (this.phase === "waiting_for_retry") {
      if (this.runtimeRetryAt !== null && now >= this.runtimeRetryAt && this.request) this.onRequest(this.request);
      return;
    }
    if (this.phase === "waiting_for_geometric_gate") {
      try {
        if (this.geometricGatePasses() || this.preferredTimedOut(now)) {
          this.enterCapturing();
        }
      } catch (error) {
        this.enterFailed(errorMessage(error));
        return;
      }
    }
    if (this.phase === "capturing") {
      try {
        if (this.request?.capture_policy === "robot_los_required" && this.shouldWaitForGeometricGate()) {
          // Looking away discards a partial runtime batch and waits for LOS.
          this.onRequest(this.request);
          return;
        }
      } catch (error) {
        this.enterFailed(errorMessage(error));
        return;
      }
      this.tickCapture(now);
      return;
    }
    if (this.phase === "awaiting_result") {
      if (this.resultDeadline !== null && now >= this.resultDeadline) {
        this.enterFailed("result timeout");
      }
      return;
    }
    if (this.phase === "failed") {
      this.tickRetry(now);
    }
  }

  private scheduleRuntimeRetry(): void {
    if (!this.runtimeCapture || !this.clientTrackingOriginStore.hasTrackingOrigin || this.sentAt === null) return;
    const delays = this.runtimeCapture.retryDelaysS;
    const delay = delays[Math.min(this.runtimeMisses++, delays.length - 1)];
    this.runtimeRetryAt = this.sentAt + delay;
    this.trace("runtime-retry-scheduled", `misses=${this.runtimeMisses}; earliest=${this.runtimeRetryAt}`);
  }

  captureBudget() { return { runtimeMisses: this.runtimeMisses, retryInS: Math.max(0, (this.runtimeRetryAt ?? this.clock.now()) - this.clock.now()),
    hardwareStarted: this.hardwareStarted, captureInFlight: this.inflight !== null }; }

  private onRequest(request: LocalizationObservationsRequest): void {
    if (this.phase === "awaiting_result") this.scheduleRuntimeRetry();
    this.session.cancelLocalizationSubmission();
    if (this.phase === "idle" && this.captureEnabled) { this.episodeStartedAt = this.clock.now(); this.episodeEndedAt = null; this.batchesSent = 0; }
    this.trace("capture-request-received", request.capture_policy);
    if (!this.captureEnabled || this.suspended) {
      this.request = request;
      this.phase = "idle";
      this.observations = [];
      this.resultDeadline = null;
      return;
    }
    this.observations = [];
    this.resultDeadline = null;
    this.retryAt = null;
    this.lastError = null;
    this.request = request;
    this.batchStartedAt = this.clock.now(); this.sentAt = null;
    this.captureGeneration += 1;
    if (this.runtimeRetryAt !== null && this.clock.now() < this.runtimeRetryAt) {
      this.phase = "waiting_for_retry"; this.nextCaptureAt = null; this.stopHardware(); return;
    }
    try {
      if (this.shouldWaitForGeometricGate()) {
        this.phase = "waiting_for_geometric_gate";
        this.geometricGateWaitStartedAt = this.clock.now();
        this.nextCaptureAt = null;
        this.stopHardware();
      } else {
        this.enterCapturing();
      }
    } catch (error) {
      this.enterFailed(errorMessage(error));
    }
  }

  private onOutbound(message: Outbound): void {
    if (message.type !== "localization_result") {
      return;
    }
    this.episodeEndedAt = this.clock.now(); this.trace("result-received");
    if (this.phase !== "idle") {
      this.resetIdle();
    }
  }

  private shouldWaitForGeometricGate(): boolean {
    if (!this.clientTrackingOriginStore.hasTrackingOrigin) {
      return false;
    }
    if (this.request?.capture_policy === "any_angle") {
      return false;
    }
    return !this.geometricGatePasses();
  }

  private geometricGatePasses(): boolean {
    const origin = this.clientTrackingOriginStore.T_odom_client;
    const pose = this.session.view().pose;
    if (origin === null || pose === null) {
      return false;
    }
    const robot = odomToClientTrackingPose(
      { position: pose.position, orientation: pose.orientation },
      origin,
    );
    return passesGeometricGate(this.tracking.cameraOptical(), robot.position, this.geometry);
  }

  private preferredTimedOut(now: number): boolean {
    return (
      this.request?.capture_policy === "robot_los_preferred" &&
      this.geometricGateWaitStartedAt !== null &&
      now >= this.geometricGateWaitStartedAt + this.request.wait_timeout_s
    );
  }

  private enterCapturing(): void {
    const alreadyCapturing = this.phase === "capturing";
    this.phase = "capturing";
    this.geometricGateWaitStartedAt = null;
    this.nextCaptureAt = this.clock.now();
    if (!alreadyCapturing) {
      this.startHardware();
    }
  }

  private tickCapture(now: number): void {
    if (this.request === null) {
      return;
    }
    if (this.inflight !== null) {
      return;
    }
    if (this.nextCaptureAt !== null && now < this.nextCaptureAt) {
      return;
    }
    const generation = this.captureGeneration;
    let pending: Promise<LocalizationObservation>;
    try {
      this.trace("capture-start");
      pending = this.capture.capture(() => {
        if (generation !== this.captureGeneration || this.phase !== "capturing" || this.suspended || !this.captureEnabled) return false;
        try { return this.request?.capture_policy !== "robot_los_required" || !this.shouldWaitForGeometricGate(); } catch { return false; }
      });
    } catch (error) {
      this.captureFailed(error);
      return;
    }
    this.inflightGeneration = generation;
    this.inflight = pending.then(
      (observation) => {
        this.onCaptureSettled(generation, observation, null);
      },
      (error: unknown) => {
        this.onCaptureSettled(generation, null, error);
      },
    );
  }

  private onCaptureSettled(
    generation: number,
    observation: LocalizationObservation | null,
    error: unknown,
  ): void {
    if (generation === this.inflightGeneration) {
      this.inflight = null;
      this.inflightGeneration = null;
    }
    if (generation !== this.captureGeneration || this.phase !== "capturing") {
      return;
    }
    if (error !== null || observation === null) {
      try {
        if (this.request?.capture_policy === "robot_los_required" && this.shouldWaitForGeometricGate()) {
          this.onRequest(this.request); return;
        }
      } catch (gateError) { this.captureFailed(gateError); return; }
      this.captureFailed(error);
      return;
    }
    if (this.request === null) {
      return;
    }
    this.observations.push(observation); this.trace("frame-captured");
    if (this.observations.length < this.request.observation_count) {
      this.nextCaptureAt = this.clock.now() + this.geometry.frameSpacingS;
      return;
    }
    this.sendBatch(this.clock.now());
  }

  private sendBatch(now: number): void {
    const timeoutS = this.request?.result_timeout_s ?? this.resultTimeoutS;
    this.phase = "awaiting_result";
    this.resultDeadline = now + timeoutS;
    this.nextCaptureAt = null;
    try {
      this.session.submitLocalizationObservations(this.observations, timeoutS);
    } catch (error) {
      this.enterFailed(errorMessage(error));
      return;
    }
    if (this.runtimeCapture?.stopWhileAwaitingResult && this.clientTrackingOriginStore.hasTrackingOrigin) this.stopHardware();
    // Setup may keep its deliberate preview warm; runtime can release the stream.
    this.sentAt = now; this.batchesSent++; this.trace("batch-sent", `bytes=${this.observations.reduce((sum, observation) => sum + observation.jpeg.length, 0)}`);
  }

  private tickRetry(now: number): void {
    if (this.retryAt === null || now < this.retryAt) {
      return;
    }
    if (this.session.view().connection !== "ready") {
      return;
    }
    if (this.request !== null && this.lastError !== "result timeout") {
      // A local camera failure has not consumed the server's pending request.
      // Resume it after backoff, including during runtime relocalization.
      this.onRequest(this.request);
      return;
    }
    this.session.sendText(encodeLocalizationStartRequest());
    this.retryAt = null;
  }

  private captureFailed(error: unknown): void {
    this.enterFailed(errorMessage(error));
    // Only hosts that explicitly exhaust their hardware retry budget opt out.
    if (error !== null && typeof error === "object" && "retryable" in error && error.retryable === false) this.retryAt = null;
  }

  private enterFailed(reason: string): void {
    if (reason === "result timeout") this.scheduleRuntimeRetry();
    this.session.cancelLocalizationSubmission();
    this.phase = "failed";
    this.stopHardware();
    this.lastError = reason; this.trace("failed", reason);
    this.observations = [];
    this.geometricGateWaitStartedAt = null;
    this.nextCaptureAt = null;
    this.resultDeadline = null;
    this.retryAt = Math.max(this.clock.now() + this.retryBackoffS, this.runtimeRetryAt ?? -Infinity);
  }

  private resetIdle(): void {
    this.runtimeMisses = 0; this.runtimeRetryAt = null;
    this.session.cancelLocalizationSubmission();
    this.captureGeneration += 1;
    this.inflight = null;
    this.inflightGeneration = null;
    this.stopHardware();
    this.phase = "idle";
    this.request = null;
    this.observations = [];
    this.geometricGateWaitStartedAt = null;
    this.nextCaptureAt = null;
    this.resultDeadline = null;
    this.retryAt = null;
    this.lastError = null;
  }

  private trace(stage: string, detail?: string): void {
    this.traceSink?.({ stage, atS: this.clock.now(), phase: this.phase, captured: this.observations.length, detail });
  }

  private startHardware(): void {
    if (this.hardwareStarted) {
      return;
    }
    this.capture.start();
    this.hardwareStarted = true;
  }

  private stopHardware(): void {
    if (!this.hardwareStarted) {
      return;
    }
    this.capture.stop();
    this.hardwareStarted = false;
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
