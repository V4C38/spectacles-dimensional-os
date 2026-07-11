import {
  CameraFrameAckMessage,
  CapturePolicyMessage,
} from "../Network/Protocol";

export const CAPTURE_LOOK_AT_MAX_ANGLE_DEG = 45;
export const CAPTURE_GATE_DEBOUNCE_S = 1.5;
export const RUNTIME_STOP_SPEED_MPS = 0.05;

export type CameraCaptureState =
  | "off"
  | "waiting"
  | "capturing"
  | "capturing_budgeted";

export interface CameraCaptureGateInputs {
  bridgeConnected: boolean;
  posesReady: boolean;
  geometricGatesPass: boolean;
  speedGatePass: boolean;
  hasInFlightCapture: boolean;
}

export interface CameraCaptureSessionFacts {
  obsBudget: number | null;
  gateFailSince: number;
  pendingDrain: boolean;
  gatesPassing: boolean;
}

export function isRobotMoving(
  speedMps: number | null,
  staticSpeedMps: number,
): boolean {
  return speedMps !== null && speedMps > staticSpeedMps;
}

export function isWithinCaptureDistance(
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
  maxAngleDeg: number = CAPTURE_LOOK_AT_MAX_ANGLE_DEG,
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
    isWithinCaptureDistance(cameraPos, robotPos, minDistanceCm, maxDistanceCm) &&
    isLookingAtTarget(cameraPos, cameraRot, robotPos)
  );
}

export function evaluateCaptureGeometricGates(
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
  return evaluateCaptureGeometricGates(
    cameraPos,
    cameraRot,
    robotWorldPos,
    minDistanceCm,
    maxDistanceCm,
  );
}

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

export function deriveCameraCapture(
  facts: CameraCaptureSessionFacts,
  gates: CameraCaptureGateInputs,
  now: number,
): CameraCaptureState {
  if (facts.obsBudget === null) {
    return "off";
  }

  const budgeted = facts.obsBudget > 0;
  const activeState: CameraCaptureState = budgeted
    ? "capturing_budgeted"
    : "capturing";

  if (facts.pendingDrain) {
    return activeState;
  }

  if (!gates.bridgeConnected || !gates.posesReady) {
    return "waiting";
  }

  const rawGatesPass = gates.geometricGatesPass && gates.speedGatePass;
  let gatesPass = false;
  if (rawGatesPass) {
    gatesPass = true;
  } else if (facts.gatesPassing) {
    if (facts.gateFailSince < 0) {
      gatesPass = true;
    } else if (now - facts.gateFailSince < CAPTURE_GATE_DEBOUNCE_S) {
      gatesPass = true;
    }
  }

  if (!gatesPass) {
    return "waiting";
  }

  return activeState;
}

export function isActiveCaptureState(state: CameraCaptureState): boolean {
  return state === "capturing" || state === "capturing_budgeted";
}

/** Observation-driven camera capture lifecycle with geometric gate debounce. */
export class CameraCaptureSession {
  private _obsBudget: number | null = null;
  private _gateFailSince = -1;
  private _pendingDrain = false;
  private _gatesPassing = false;
  private _policyApplied = false;
  private _minDistanceCm = 0;
  private _maxDistanceCm = 0;
  private _maxSpeedMps = 0;
  private _minObs = 0;
  private _staticSpeedMps = RUNTIME_STOP_SPEED_MPS;

  public get obsBudget(): number | null {
    return this._obsBudget;
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

  public getFacts(): CameraCaptureSessionFacts {
    return {
      obsBudget: this._obsBudget,
      gateFailSince: this._gateFailSince,
      pendingDrain: this._pendingDrain,
      gatesPassing: this._gatesPassing,
    };
  }

  public applyPolicy(policy: CapturePolicyMessage): void {
    this._minDistanceCm = policy.min_capture_distance_m * 100;
    this._maxDistanceCm = policy.max_capture_distance_m * 100;
    this._maxSpeedMps = policy.max_capture_speed_mps;
    this._staticSpeedMps = policy.static_speed_mps;
    this._minObs = policy.min_observations;
    this._policyApplied = true;
  }

  public beginCameraCapture(obsBudget = 0): void {
    if (this._obsBudget !== null && this._obsBudget === obsBudget) {
      return;
    }
    this._obsBudget = obsBudget;
    this._gateFailSince = -1;
    this._pendingDrain = false;
    this._gatesPassing = false;
  }

  public endCameraCapture(): void {
    this._obsBudget = null;
    this._gateFailSince = -1;
    this._pendingDrain = false;
    this._gatesPassing = false;
  }

  public onSpeedChanged(previousSpeedMps: number | null, speedMps: number | null): void {
    const staticSpeed = this._staticSpeedMps;
    const wasMoving =
      previousSpeedMps !== null && previousSpeedMps > staticSpeed;
    const isMoving = speedMps !== null && speedMps > staticSpeed;
    if (!wasMoving && isMoving) {
      this.beginCameraCapture();
    } else if (wasMoving && !isMoving) {
      if (this._policyApplied) {
        this.beginCameraCapture(this._minObs);
      }
    }
  }

  public onFrameAck(msg: CameraFrameAckMessage): void {
    if (this._pendingDrain) {
      this._pendingDrain = false;
    }
    if (
      this._obsBudget !== null &&
      this._obsBudget > 0 &&
      msg.capturing_budgeted_complete
    ) {
      this.endCameraCapture();
    }
  }

  public updateGateDebounce(
    gates: CameraCaptureGateInputs,
    now: number,
  ): void {
    if (this._obsBudget === null) {
      this._gateFailSince = -1;
      this._gatesPassing = false;
      return;
    }

    if (!gates.bridgeConnected || !gates.posesReady) {
      this._gateFailSince = -1;
      this._gatesPassing = false;
      return;
    }

    const rawGatesPass = gates.geometricGatesPass && gates.speedGatePass;
    if (rawGatesPass) {
      this._gateFailSince = -1;
      this._gatesPassing = true;
      return;
    }

    if (this._gatesPassing) {
      if (this._gateFailSince < 0) {
        this._gateFailSince = now;
      } else if (now - this._gateFailSince >= CAPTURE_GATE_DEBOUNCE_S) {
        this._gatesPassing = false;
        this._gateFailSince = -1;
      }
      return;
    }

    this._gateFailSince = -1;
    this._gatesPassing = false;
  }

  public updatePendingDrain(
    state: CameraCaptureState,
    hasInFlightCapture: boolean,
  ): void {
    if (
      state === "waiting" &&
      hasInFlightCapture &&
      this._obsBudget !== null
    ) {
      this._pendingDrain = true;
    }
  }

  public getDistanceGateCm(): { minDistanceCm: number; maxDistanceCm: number } {
    return {
      minDistanceCm: this._minDistanceCm,
      maxDistanceCm: this._maxDistanceCm,
    };
  }
}
