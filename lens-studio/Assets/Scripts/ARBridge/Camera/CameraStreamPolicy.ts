import { AppPhase } from "../../App/AppState";
import { CaptureHint } from "../Network/Protocol";

export type CaptureMode = "off" | "registration" | "runtime";
export type CapturePolicy = "off" | "steady" | "burst" | "hold";

export const RUNTIME_STREAM_MAX_DISTANCE_CM = 300;
export const RUNTIME_STREAM_LOOK_AT_MAX_ANGLE_DEG = 45;
export const RUNTIME_STOP_SPEED_MPS = 0.05;

export type CameraStreamOffReason =
  | "force_off"
  | "bridge_disconnected"
  | "inactive_phase"
  | "stopped_after_correction"
  | "missing_robot_pose"
  | "missing_camera_pose"
  | "robot_too_far"
  | "not_looking_at_robot";

export interface CameraPolicyStaticContext {
  forceOff: boolean;
  appPhase: AppPhase;
  tagCaptureSessionActive: boolean;
  worldFrameCommitted: boolean;
  bridgeConnected: boolean;
  registrationCaptureHint: CaptureHint;
}

export interface CameraPolicyDynamicInput {
  robotWorldPos: vec3 | null;
  cameraPos: vec3 | null;
  cameraRot: quat | null;
  robotSpeedMps: number | null;
  correctionSinceLastMovement: boolean;
}

export interface CameraPolicyResult {
  streamEnabled: boolean;
  mode: CaptureMode;
  policy: CapturePolicy;
  streamOffReason: CameraStreamOffReason | null;
}

export function isRobotMoving(speedMps: number | null): boolean {
  return speedMps !== null && speedMps >= RUNTIME_STOP_SPEED_MPS;
}

export function isRobotStopped(speedMps: number | null): boolean {
  return speedMps !== null && speedMps < RUNTIME_STOP_SPEED_MPS;
}

export function isWithinStreamDistance(
  cameraPos: vec3,
  robotPos: vec3,
  maxDistanceCm: number = RUNTIME_STREAM_MAX_DISTANCE_CM,
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
  maxAngleDeg: number = RUNTIME_STREAM_LOOK_AT_MAX_ANGLE_DEG,
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

function evaluateRuntimeStream(dynamic: CameraPolicyDynamicInput): {
  enabled: boolean;
  reason: CameraStreamOffReason | null;
} {
  if (isRobotStopped(dynamic.robotSpeedMps) && dynamic.correctionSinceLastMovement) {
    return { enabled: false, reason: "stopped_after_correction" };
  }
  if (!dynamic.robotWorldPos) {
    return { enabled: false, reason: "missing_robot_pose" };
  }
  if (!dynamic.cameraPos || !dynamic.cameraRot) {
    return { enabled: false, reason: "missing_camera_pose" };
  }
  if (!isWithinStreamDistance(dynamic.cameraPos, dynamic.robotWorldPos)) {
    return { enabled: false, reason: "robot_too_far" };
  }
  if (!isLookingAtTarget(dynamic.cameraPos, dynamic.cameraRot, dynamic.robotWorldPos)) {
    return { enabled: false, reason: "not_looking_at_robot" };
  }
  return { enabled: true, reason: null };
}

/** Single source of truth for camera stream lifecycle and capture mode/policy. */
export function computeCameraPolicy(
  staticCtx: CameraPolicyStaticContext,
  dynamic: CameraPolicyDynamicInput,
): CameraPolicyResult {
  if (staticCtx.forceOff) {
    return {
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "force_off",
    };
  }
  if (!staticCtx.bridgeConnected) {
    return {
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "bridge_disconnected",
    };
  }

  if (staticCtx.appPhase === "registration" && staticCtx.tagCaptureSessionActive) {
    return {
      streamEnabled: true,
      mode: "registration",
      policy: staticCtx.registrationCaptureHint,
      streamOffReason: null,
    };
  }

  if (staticCtx.appPhase === "runtime" && staticCtx.worldFrameCommitted) {
    const runtime = evaluateRuntimeStream(dynamic);
    if (runtime.enabled) {
      return {
        streamEnabled: true,
        mode: "runtime",
        policy: "off",
        streamOffReason: null,
      };
    }
    return {
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: runtime.reason,
    };
  }

  return {
    streamEnabled: false,
    mode: "off",
    policy: "off",
    streamOffReason: "inactive_phase",
  };
}

/** Tracks movement/correction latch for runtime stream shutdown after stop. */
export class CameraStreamLatch {
  private _wasMoving = false;
  public correctionSinceLastMovement = false;

  public onRobotSpeed(speedMps: number | null): void {
    const moving = isRobotMoving(speedMps);
    if (moving && !this._wasMoving) {
      this.correctionSinceLastMovement = false;
    }
    this._wasMoving = moving;
  }

  public onWorldFrameCorrection(): void {
    this.correctionSinceLastMovement = true;
  }

  public reset(): void {
    this._wasMoving = false;
    this.correctionSinceLastMovement = false;
  }
}

/** Runtime off reasons worth logging — excludes normal geometric idle gates. */
export function shouldLogStreamOffReason(reason: CameraStreamOffReason | null): boolean {
  return (
    reason === "stopped_after_correction" ||
    reason === "missing_robot_pose" ||
    reason === "missing_camera_pose"
  );
}
