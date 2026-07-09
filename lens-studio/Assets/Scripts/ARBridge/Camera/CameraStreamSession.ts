export const STREAM_MAX_DISTANCE_CM = 300;
export const STREAM_LOOK_AT_MAX_ANGLE_DEG = 45;
export const STREAM_GATE_DEBOUNCE_S = 1.5;
export const RUNTIME_STOP_SPEED_MPS = 0.05;

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
  maxDistanceCm: number = STREAM_MAX_DISTANCE_CM,
): boolean {
  const dx = robotPos.x - cameraPos.x;
  const dy = robotPos.y - cameraPos.y;
  const dz = robotPos.z - cameraPos.z;
  return Math.hypot(dx, dy, dz) <= maxDistanceCm;
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
): boolean {
  return (
    isWithinStreamDistance(cameraPos, robotPos) &&
    isLookingAtTarget(cameraPos, cameraRot, robotPos)
  );
}

/** Distance/look-at gates apply only when a robot pose is known. */
export function evaluateStreamGeometricGates(
  cameraPos: vec3,
  cameraRot: quat,
  robotPos: vec3 | null,
): boolean {
  if (robotPos === null) {
    return true;
  }
  return evaluateGeometricGates(cameraPos, cameraRot, robotPos);
}

export interface StreamEvalGates {
  bridgeConnected: boolean;
  posesReady: boolean;
  geometricGatesPass: boolean;
}

export interface StreamEvalResult {
  hardwareEnabled: boolean;
  requestActive: boolean;
}

/** Request-based camera stream lifecycle with geometric gate debounce and frame budget. */
export class CameraStreamSession {
  private _requestActive = false;
  private _frameBudget = 0;
  private _framesAcked = 0;
  private _hardwareEnabled = false;
  private _gateFailSince = -1;

  public get requestActive(): boolean {
    return this._requestActive;
  }

  public get hardwareEnabled(): boolean {
    return this._hardwareEnabled;
  }

  public requestStreamStart(numFrames = 0): void {
    this._requestActive = true;
    this._frameBudget = numFrames;
    this._framesAcked = 0;
    this._gateFailSince = -1;
  }

  public requestStreamStop(): void {
    this._requestActive = false;
    this._frameBudget = 0;
    this._framesAcked = 0;
    this._hardwareEnabled = false;
    this._gateFailSince = -1;
  }

  public onFrameAck(): void {
    if (!this._requestActive) {
      return;
    }
    this._framesAcked += 1;
    if (this._frameBudget > 0 && this._framesAcked >= this._frameBudget) {
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

    if (gates.geometricGatesPass) {
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
}
