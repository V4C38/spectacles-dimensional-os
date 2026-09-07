import type {
  CameraCaptureSource,
  CameraTrackingSource,
  CaptureGeometry,
  ClientClock,
} from "../websocket/hostPorts";
import {
  encodeLocalizationObservations,
  encodeLocalizationStartRequest,
} from "../websocket/protocol";
import type { ARModuleSession } from "../websocket/arModuleSession";
import type {
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
}

export interface LocalizationCaptureDependencies {
  session: ARModuleSession;
  clientTrackingOriginStore: ClientTrackingOriginStore;
  clock: ClientClock;
  tracking: CameraTrackingSource;
  capture: CameraCaptureSource;
  geometry: CaptureGeometry;
  config: LocalizationCaptureConfig;
}

export class LocalizationCaptureEpisode {
  private readonly session: ARModuleSession;
  private readonly clientTrackingOriginStore: ClientTrackingOriginStore;
  private readonly clock: ClientClock;
  private readonly tracking: CameraTrackingSource;
  private readonly capture: CameraCaptureSource;
  private readonly geometry: CaptureGeometry;
  private readonly resultTimeoutS: number;
  private readonly retryBackoffS: number;

  private phase: LocalizationCapturePhase = "idle";
  private request: LocalizationObservationsRequest | null = null;
  private observations: LocalizationObservation[] = [];
  private geometricGateWaitStartedAt: number | null = null;
  private nextCaptureAt: number | null = null;
  private resultDeadline: number | null = null;
  private retryAt: number | null = null;
  private lastError: string | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(deps: LocalizationCaptureDependencies) {
    this.session = deps.session;
    this.clientTrackingOriginStore = deps.clientTrackingOriginStore;
    this.clock = deps.clock;
    this.tracking = deps.tracking;
    this.capture = deps.capture;
    this.geometry = requireGeometry(deps.geometry);
    this.resultTimeoutS = requirePositive(deps.config.resultTimeoutS, "resultTimeoutS");
    this.retryBackoffS = requireNonNegative(deps.config.retryBackoffS, "retryBackoffS");
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

  view(): LocalizationCaptureState {
    return { phase: this.phase, lastError: this.lastError };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.resetIdle();
  }

  requestStart(): void {
    if (this.session.view().connection !== "ready") {
      return;
    }
    if (this.phase !== "idle" && this.phase !== "failed") {
      return;
    }
    this.session.sendText(encodeLocalizationStartRequest());
    if (this.phase === "failed") {
      this.retryAt = null;
    }
  }

  tick(): void {
    const now = this.clock.now();
    if (this.phase === "waiting_for_geometric_gate") {
      try {
        if (this.geometricGatePasses() || this.preferredTimedOut(now)) {
          this.phase = "capturing";
          this.nextCaptureAt = now;
          this.geometricGateWaitStartedAt = null;
        }
      } catch (error) {
        this.enterFailed(errorMessage(error));
        return;
      }
    }
    if (this.phase === "capturing") {
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

  private onRequest(request: LocalizationObservationsRequest): void {
    this.observations = [];
    this.resultDeadline = null;
    this.retryAt = null;
    this.lastError = null;
    this.request = request;
    try {
      if (this.shouldWaitForGeometricGate()) {
        this.phase = "waiting_for_geometric_gate";
        this.geometricGateWaitStartedAt = this.clock.now();
        this.nextCaptureAt = null;
      } else {
        this.phase = "capturing";
        this.geometricGateWaitStartedAt = null;
        this.nextCaptureAt = this.clock.now();
      }
    } catch (error) {
      this.enterFailed(errorMessage(error));
    }
  }

  private onOutbound(message: Outbound): void {
    if (message.type !== "localization_result") {
      return;
    }
    if (this.phase === "awaiting_result" || this.phase === "failed") {
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

  private tickCapture(now: number): void {
    if (this.request === null) {
      return;
    }
    if (this.nextCaptureAt !== null && now < this.nextCaptureAt) {
      return;
    }
    try {
      this.observations.push(this.capture.capture());
    } catch (error) {
      this.enterFailed(errorMessage(error));
      return;
    }
    if (this.observations.length < this.request.observation_count) {
      this.nextCaptureAt = now + this.geometry.frameSpacingS;
      return;
    }
    this.sendBatch(now);
  }

  private sendBatch(now: number): void {
    this.phase = "sending";
    try {
      this.session.sendBinary(encodeLocalizationObservations(this.observations));
    } catch (error) {
      this.enterFailed(errorMessage(error));
      return;
    }
    this.phase = "awaiting_result";
    this.resultDeadline = now + this.resultTimeoutS;
    this.nextCaptureAt = null;
  }

  private tickRetry(now: number): void {
    if (this.clientTrackingOriginStore.hasTrackingOrigin) {
      return;
    }
    if (this.retryAt === null || now < this.retryAt) {
      return;
    }
    if (this.session.view().connection !== "ready") {
      return;
    }
    this.session.sendText(encodeLocalizationStartRequest());
    this.retryAt = null;
  }

  private enterFailed(reason: string): void {
    this.phase = "failed";
    this.lastError = reason;
    this.observations = [];
    this.geometricGateWaitStartedAt = null;
    this.nextCaptureAt = null;
    this.resultDeadline = null;
    this.retryAt = this.clock.now() + this.retryBackoffS;
  }

  private resetIdle(): void {
    this.phase = "idle";
    this.request = null;
    this.observations = [];
    this.geometricGateWaitStartedAt = null;
    this.nextCaptureAt = null;
    this.resultDeadline = null;
    this.retryAt = null;
    this.lastError = null;
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
