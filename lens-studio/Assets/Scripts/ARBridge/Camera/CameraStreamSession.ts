import { CapturePolicyMessage } from "../Network/Protocol";
import { CameraStreamLogStatus } from "../../App/UI/UILogger";

export const STREAM_LOOK_AT_MAX_ANGLE_DEG = 45;
export const STREAM_GATE_DEBOUNCE_S = 1.5;
export const RUNTIME_STOP_SPEED_MPS = 0.05;
export type CapturePhase = "off" | "registration" | "tracking_motion" | "refining_stop";

export function isRobotMoving(speedMps: number | null): boolean {
  return speedMps !== null && speedMps >= RUNTIME_STOP_SPEED_MPS;
}

export function isRobotStopped(speedMps: number | null): boolean {
  return speedMps !== null && speedMps < RUNTIME_STOP_SPEED_MPS;
}

export function isStartingMovement(
  previousSpeedMps: number | null,
  nextSpeedMps: number | null,
): boolean {
  const wasStopped =
    previousSpeedMps === null || previousSpeedMps < RUNTIME_STOP_SPEED_MPS;
  const isMoving = nextSpeedMps !== null && nextSpeedMps >= RUNTIME_STOP_SPEED_MPS;
  return wasStopped && isMoving;
}

export function isStoppingMovement(
  previousSpeedMps: number | null,
  nextSpeedMps: number | null,
): boolean {
  const wasMoving =
    previousSpeedMps !== null && previousSpeedMps >= RUNTIME_STOP_SPEED_MPS;
  const isStopped = nextSpeedMps !== null && nextSpeedMps < RUNTIME_STOP_SPEED_MPS;
  return wasMoving && isStopped;
}

export function isWithinStreamDistance(
  cameraPos: vec3,
  robotPos: vec3,
  minDistanceCm: number,
  maxDistanceCm: number,
): boolean {
  const dx = robotPos.x - cameraPos.x;
  const dy = robotPos.y - cameraPos.y;
  const dz = robotPos.z - cameraPos.z;
  const dist = Math.hypot(dx, dy, dz);
  return dist >= minDistanceCm && dist <= maxDistanceCm;
}

export function isLookingAtTarget(
  cameraPos: vec3,
  cameraRot: quat,
  targetPos: vec3,
  maxAngleDeg: number = STREAM_LOOK_AT_MAX_ANGLE_DEG,
): boolean {
  const dx = targetPos.x - cameraPos.x;
  const dy = targetPos.y - cameraPos.y;
  const dz = targetPos.z - cameraPos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= 0) {
    return false;
  }
  const toX = dx / dist;
  const toY = dy / dist;
  const toZ = dz / dist;
  const forward = cameraRot.multiplyVec3(new vec3(0, 0, -1));
  const fLen = Math.hypot(forward.x, forward.y, forward.z);
  if (fLen <= 0) {
    return false;
  }
  const fx = forward.x / fLen;
  const fy = forward.y / fLen;
  const fz = forward.z / fLen;
  const minDot = Math.cos((maxAngleDeg * Math.PI) / 180);
  return fx * toX + fy * toY + fz * toZ >= minDot;
}

export function evaluateGeometricGates(
  cameraPos: vec3,
  cameraRot: quat,
  robotPos: vec3,
  minDistanceCm: number,
  maxDistanceCm: number,
): boolean {
  return (
    isWithinStreamDistance(cameraPos, robotPos, minDistanceCm, maxDistanceCm) &&
    isLookingAtTarget(cameraPos, cameraRot, robotPos)
  );
}

/** Distance/look-at gates apply only when a robot pose is known. */
export function evaluateStreamGeometricGates(
  cameraPos: vec3,
  cameraRot: quat,
  robotPos: vec3 | null,
  minDistanceCm: number,
  maxDistanceCm: number,
): boolean {
  if (robotPos === null) {
    return true;
  }
  return evaluateGeometricGates(
    cameraPos,
    cameraRot,
    robotPos,
    minDistanceCm,
    maxDistanceCm,
  );
}

/** Apply geometric gates only when robot pose and policy distances are available. */
export function evaluateOptionalGeometricGates(
  cameraPos: vec3,
  cameraRot: quat,
  robotWorldPos: vec3 | null,
  minDistanceCm: number,
  maxDistanceCm: number,
  policyApplied: boolean,
): boolean {
  if (robotWorldPos === null || !policyApplied) {
    return true;
  }
  return evaluateStreamGeometricGates(
    cameraPos,
    cameraRot,
    robotWorldPos,
    minDistanceCm,
    maxDistanceCm,
  );
}

/** Apply speed gate only when speed and policy limit are available. */
export function evaluateOptionalSpeedGate(
  speedMps: number | null,
  maxSpeedMps: number,
  policyApplied: boolean,
): boolean {
  if (speedMps === null || !policyApplied) {
    return true;
  }
  return speedMps <= maxSpeedMps;
}

export interface StreamEvalGates {
  bridgeConnected: boolean;
  posesReady: boolean;
  geometricGatesPass: boolean;
  speedGatePass: boolean;
}

export interface StreamEvalResult {
  hardwareEnabled: boolean;
  requestActive: boolean;
}

export interface HardwareTransitionState {
  targetHardwareEnabled: boolean;
  nextPendingHardwareOff: boolean;
  captureEnabled: boolean;
  displayStatus: CameraStreamLogStatus;
  stopIsLifecycleEnd: boolean;
}

/** Resolve physical camera on/off from gate evaluation and in-flight drain. */
export function resolveHardwareTransition(args: {
  evalHardwareEnabled: boolean;
  requestActive: boolean;
  hardwareCurrentlyEnabled: boolean;
  pendingHardwareOff: boolean;
  hasInFlightCapture: boolean;
}): HardwareTransitionState {
  let pendingHardwareOff = args.pendingHardwareOff;
  let targetHardwareEnabled = args.evalHardwareEnabled;

  if (
    !args.evalHardwareEnabled &&
    args.hardwareCurrentlyEnabled &&
    args.hasInFlightCapture
  ) {
    pendingHardwareOff = true;
    targetHardwareEnabled = true;
  } else if (args.evalHardwareEnabled) {
    pendingHardwareOff = false;
  } else if (pendingHardwareOff && !args.hasInFlightCapture) {
    pendingHardwareOff = false;
    targetHardwareEnabled = false;
  } else if (pendingHardwareOff) {
    targetHardwareEnabled = true;
  }

  const captureEnabled = args.evalHardwareEnabled || pendingHardwareOff;
  const displayStatus: CameraStreamLogStatus = targetHardwareEnabled
    ? "on"
    : args.requestActive
      ? "waiting"
      : "off";
  const stopIsLifecycleEnd =
    args.hardwareCurrentlyEnabled &&
    !targetHardwareEnabled &&
    !args.requestActive;

  return {
    targetHardwareEnabled,
    nextPendingHardwareOff: pendingHardwareOff,
    captureEnabled,
    displayStatus,
    stopIsLifecycleEnd,
  };
}

export function cameraStreamLogStatus(
  deviceRunning: boolean,
  requestActive: boolean,
): CameraStreamLogStatus {
  if (deviceRunning) {
    return "on";
  }
  if (requestActive) {
    return "waiting";
  }
  return "off";
}

/** Observation-driven camera stream lifecycle with geometric gate debounce. */
export class CameraStreamSession {
  private _requestActive = false;
  private _budget = 0;
  private _obsAccepted = 0;
  private _hardwareEnabled = false;
  private _gateFailSince = -1;
  private _policyApplied = false;
  private _minDistanceCm = 0;
  private _maxDistanceCm = 0;
  private _maxSpeedMps = 0;
  private _minObs = 0;
  private _staticSpeedMps = RUNTIME_STOP_SPEED_MPS;
  private _phase: CapturePhase = "off";

  public get requestActive(): boolean {
    return this._requestActive;
  }

  public get hardwareEnabled(): boolean {
    return this._hardwareEnabled;
  }

  public get minObs(): number {
    return this._minObs;
  }

  public get maxSpeedMps(): number {
    return this._maxSpeedMps;
  }

  public get policyApplied(): boolean {
    return this._policyApplied;
  }

  public get phase(): CapturePhase {
    return this._phase;
  }

  public get obsAccepted(): number {
    return this._obsAccepted;
  }

  public applyPolicy(policy: CapturePolicyMessage): void {
    this._minDistanceCm = policy.min_stream_distance_m * 100;
    this._maxDistanceCm = policy.max_stream_distance_m * 100;
    this._maxSpeedMps = policy.max_capture_speed_mps;
    this._staticSpeedMps = policy.static_speed_mps;
    this._minObs = policy.min_observations;
    this._policyApplied = true;
  }

  public requestStreamStart(numObs = 0): void {
    if (this._requestActive && this._budget === numObs) {
      return;
    }
    this._requestActive = true;
    this._budget = numObs;
    this._obsAccepted = 0;
    this._gateFailSince = -1;
  }

  public requestStreamStop(): void {
    this._phase = "off";
    this._requestActive = false;
    this._budget = 0;
    this._obsAccepted = 0;
    this._hardwareEnabled = false;
    this._gateFailSince = -1;
  }

  public startRegistration(): void {
    this._phase = "registration";
    this.requestStreamStart(0);
  }

  public startMotion(): void {
    this._phase = "tracking_motion";
    this.requestStreamStart(0);
  }

  public startStopRefinement(): void {
    if (!this._policyApplied) {
      return;
    }
    this._phase = "refining_stop";
    this.requestStreamStart(this._minObs);
  }

  public onSpeedChanged(previousSpeedMps: number | null, speedMps: number | null): void {
    const staticSpeed = this._staticSpeedMps;
    const wasMoving = previousSpeedMps !== null && previousSpeedMps > staticSpeed;
    const isMoving = speedMps !== null && speedMps > staticSpeed;
    if (!wasMoving && isMoving) {
      this.startMotion();
    } else if (wasMoving && !isMoving) {
      this.startStopRefinement();
    }
  }

  public onFrameAck(obsAdded: boolean, refinementComplete = false): void {
    if (!this._requestActive) {
      return;
    }
    if (obsAdded) {
      this._obsAccepted += 1;
    }
    if (this._phase === "refining_stop" && refinementComplete) {
      this.requestStreamStop();
    }
  }

  public evaluate(gates: StreamEvalGates, now: number): StreamEvalResult {
    if (!this._requestActive) {
      this._hardwareEnabled = false;
      this._gateFailSince = -1;
      return { hardwareEnabled: false, requestActive: false };
    }

    if (!gates.bridgeConnected || !gates.posesReady) {
      this._hardwareEnabled = false;
      return { hardwareEnabled: false, requestActive: true };
    }

    const captureGatesPass =
      gates.geometricGatesPass && gates.speedGatePass;

    if (captureGatesPass) {
      this._gateFailSince = -1;
      this._hardwareEnabled = true;
      return { hardwareEnabled: true, requestActive: true };
    }

    if (this._hardwareEnabled) {
      if (this._gateFailSince < 0) {
        this._gateFailSince = now;
      }
      if (now - this._gateFailSince >= STREAM_GATE_DEBOUNCE_S) {
        this._hardwareEnabled = false;
        this._gateFailSince = -1;
      }
    } else {
      this._gateFailSince = -1;
    }

    return {
      hardwareEnabled: this._hardwareEnabled,
      requestActive: true,
    };
  }

  /** Exposed for geometric gate evaluation in the controller. */
  public getDistanceGateCm(): { minDistanceCm: number; maxDistanceCm: number } {
    return {
      minDistanceCm: this._minDistanceCm,
      maxDistanceCm: this._maxDistanceCm,
    };
  }
}
