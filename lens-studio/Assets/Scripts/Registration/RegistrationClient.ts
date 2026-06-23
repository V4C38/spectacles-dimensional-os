// ================================================================
/**
 * Single owner of the bridge registration session (AprilTag baseline and manual pose).
 */
// ================================================================

import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { BridgeClient } from "../Bridge/BridgeClient";
import {
  CaptureHint,
  RegistrationMode,
  RegistrationStatusMessage,
} from "../Bridge/domain";
import { Signal } from "../Core/Utilities";
import { RobotMarker } from "../Robot/RobotMarker";
import { ManualPoseCorrection } from "./ManualPoseCorrection";
import {
  cloneQuat,
  cloneVec3,
  quatAngularDistanceRad,
  vec3Distance,
} from "../Core/Utilities";
import { RobotInteractionMode } from "../Core/AppState";

const MANUAL_MARKER_DOWN_CM = 35.0;
const MANUAL_REGISTRATION_LOG_INTERVAL_S = 2.0;
const NO_RESPONSE_TIMEOUT_S = 10.0;
const MANUAL_POSE_POSITION_EPS_CM = 0.5;
const MANUAL_POSE_ROTATION_EPS_RAD = 0.02;

export interface RegistrationClientDeps {
  poseCorrection: ManualPoseCorrection;
  hasBridgeConnection: () => boolean;
  isCapabilityAvailable: (cap: string) => boolean;
  getInteractionMode: () => RobotInteractionMode;
  setInteractionMode: (mode: RobotInteractionMode) => void;
  getIsRuntimePhase: () => boolean;
  disableNavigationPlacementForRegistration: () => void;
}

export class RegistrationClient {
  public readonly onRegistrationStatus = new Signal<RegistrationStatusMessage>();

  constructor(
    private readonly bridgeClient: BridgeClient | null,
    private readonly frameCapture: FrameCaptureController | null,
    private readonly robotMarker: RobotMarker | null,
  ) {}

  private _intent: RegistrationMode | null = null;
  private _awaitingCommit = false;
  private _lastStatusTime = -1;
  private _lastCaptureLogTime = -1;
  private _lastSubmitLogTime = -1;
  private _lastSubmittedManualPose: {
    position: vec3;
    rotation: quat;
  } | null = null;
  private _deps: RegistrationClientDeps | null = null;
  private _bound = false;
  private _motionAuthorizePending = false;

  public initialize(deps: RegistrationClientDeps): void {
    this._deps = deps;
  }

  public bind(): void {
    if (this._bound || !this.bridgeClient) {
      return;
    }
    this._bound = true;
    this.bridgeClient.onRegistrationStatus.add(this._onRegistrationStatus);
    this.bridgeClient.onConnectionChanged.add((connected) => {
      if (!connected) {
        this._lastStatusTime = -1;
        this._lastSubmittedManualPose = null;
      }
    });
    this.bridgeClient.onHello.add(() => {
      this._lastStatusTime = getTime();
      if (this._intent !== null) {
        this._tryStartBridgeSession(this._intent);
      }
    });
    this.bridgeClient.onBridgeStatus.add((msg) => {
      if (this._awaitingCommit && msg.registered) {
        this._awaitingCommit = false;
      }
    });
  }

  public start(mode: RegistrationMode): void {
    this._intent = mode;
    this._awaitingCommit = false;
    this._motionAuthorizePending = false;
    this._lastStatusTime = -1;
    this._lastSubmittedManualPose = null;
    this._tryStartBridgeSession(mode);
    if (this.frameCapture) {
      this.frameCapture.setMode(
        mode === "april_odom_baseline" ? "setup" : "off",
      );
      this.frameCapture.setCapturePolicy(
        mode === "april_odom_baseline" ? "steady" : "off",
      );
    }
    print(`RegistrationClient: start mode=${mode}`);
  }

  public authorizeMotion(): void {
    this.requestMotionAuthorization();
  }

  public requestMotionAuthorization(): boolean {
    if (this._motionAuthorizePending) {
      return false;
    }
    if (!this.bridgeClient) {
      print("RegistrationClient: requestMotionAuthorization — bridge unavailable");
      return false;
    }
    this._motionAuthorizePending = true;
    const sent = this.bridgeClient.sendRegistrationCommand("authorize_motion");
    if (!sent) {
      this._motionAuthorizePending = false;
      print("RegistrationClient: requestMotionAuthorization — send failed");
      return false;
    }
    print("RegistrationClient: requestMotionAuthorization sent");
    return true;
  }

  public get motionAuthorizePending(): boolean {
    return this._motionAuthorizePending;
  }

  public stop(options?: { notifyBridge?: boolean }): void {
    const notifyBridge = options?.notifyBridge ?? false;
    const wasBaseline = this._intent === "april_odom_baseline";
    this._intent = null;
    this._awaitingCommit = false;
    this._motionAuthorizePending = false;
    this._lastStatusTime = -1;
    this._lastSubmittedManualPose = null;
    if (notifyBridge && this.bridgeClient?.isConnected()) {
      this.bridgeClient.sendRegistrationCommand("stop");
    }
    if (this.frameCapture) {
      const registered = Boolean(
        this.bridgeClient?.lastBridgeStatus?.registered,
      );
      this.frameCapture.setMode(registered ? "runtime" : "off");
      this.frameCapture.setCapturePolicy("off");
    }
    print(
      wasBaseline
        ? "RegistrationClient: stop (april_odom_baseline)"
        : "RegistrationClient: stop (manual_pose)",
    );
  }

  public commit(): boolean {
    if (!this.bridgeClient) {
      return false;
    }
    const sent = this.bridgeClient.sendRegistrationCommand("commit");
    if (sent) {
      this._awaitingCommit = true;
      this._intent = null;
      print("RegistrationClient: registration_command commit sent");
    }
    return sent;
  }

  public ensureSession(): boolean {
    if (this._intent === null) {
      return false;
    }
    return this._tryStartBridgeSession(this._intent);
  }

  public hasActiveIntent(): boolean {
    return this._intent !== null;
  }

  public beginManualPlacement(position: vec3, rotation: quat): void {
    if (!this._deps) {
      return;
    }
    this._deps.disableNavigationPlacementForRegistration();
    const pose = this._poseFromReference(position, rotation);
    this._deps.poseCorrection.setAnchorPose(pose);
    const p = pose.position;
    const r = pose.rotation;
    print(
      `RegistrationClient: beginManualPlacement pos=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) rot=(${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)},${r.w.toFixed(3)})`,
    );
    if (this.robotMarker) {
      this.robotMarker.applyManualPose(pose.position, pose.rotation);
    }
    this._deps.setInteractionMode("manualPlacement");
  }

  public cancelPlacement(): void {
    if (!this._deps) {
      return;
    }
    if (this._deps.getInteractionMode() === "manualPlacement") {
      this._deps.setInteractionMode(
        this._deps.getIsRuntimePhase() ? "runtimeRobot" : "hidden",
      );
    }
  }

  public freezePlacement(): void {
    if (!this._deps || this._deps.getInteractionMode() !== "manualPlacement") {
      return;
    }
    const rm = this.robotMarker;
    if (!rm) {
      return;
    }
    rm.setVisible(true);
    rm.setToggleEnabled(false);
    rm.setMenuEnabled(false);
    rm.setManualPlacementEnabled(false);
  }

  public clearPose(): void {
    this._deps?.poseCorrection.reset();
  }

  public captureAndSubmitManualPose(force: boolean = false): boolean {
    const position = this.robotMarker?.getWorldPosition() ?? null;
    const rotation = this.robotMarker?.getRotation() ?? null;
    if (!position || !rotation) {
      this._logThrottled(
        "capture",
        "RegistrationClient: marker position/rotation unavailable",
      );
      return false;
    }
    const pose = this._poseFromMarkerWorld(position, rotation);
    if (this._deps) {
      this._deps.poseCorrection.setAnchorPose(pose);
    }
    if (!this._deps?.hasBridgeConnection()) {
      return true;
    }
    if (
      !force &&
      this._lastSubmittedManualPose !== null &&
      this._manualPoseMatchesLastSubmitted(position, rotation)
    ) {
      return true;
    }
    const sent =
      this.bridgeClient?.sendRegistrationPose(position, rotation) ?? false;
    if (sent) {
      this._lastSubmittedManualPose = {
        position: cloneVec3(position),
        rotation: cloneQuat(rotation),
      };
    } else {
      this._logThrottled(
        "submit",
        "RegistrationClient: registration_pose send failed",
      );
    }
    return sent;
  }

  public finalizeOffline(): boolean {
    const position = this.robotMarker?.getWorldPosition() ?? null;
    const rotation = this.robotMarker?.getRotation() ?? null;
    if (!position || !rotation) {
      print("RegistrationClient: finalizeOffline — marker position unavailable");
      return false;
    }
    const pose = this._poseFromMarkerWorld(position, rotation);
    if (this._deps) {
      this._deps.poseCorrection.setAnchorPose(pose);
    }
    const r = rotation;
    print(
      `RegistrationClient: finalizeOffline pos=(${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}) rot=(${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)},${r.w.toFixed(3)})`,
    );
    return true;
  }

  public preferredMode(): "auto" | "manualOnly" | "manualAvailable" {
    if (!this._deps) {
      return "auto";
    }
    const hasBaseline = this._deps.isCapabilityAvailable(
      "registration_april_odom_baseline",
    );
    const hasManual = this._deps.isCapabilityAvailable(
      "registration_manual_pose",
    );
    if (this._deps.hasBridgeConnection() && !hasBaseline && hasManual) {
      return "manualOnly";
    }
    if (hasManual) {
      return "manualAvailable";
    }
    return "auto";
  }

  public isNoResponseTimeout(): boolean {
    if (this._intent === null || this._lastStatusTime < 0) {
      return false;
    }
    return getTime() - this._lastStatusTime > NO_RESPONSE_TIMEOUT_S;
  }

  private _tryStartBridgeSession(mode: RegistrationMode): boolean {
    const connected = Boolean(this.bridgeClient?.isConnected());
    const hasRobotId = Boolean(this.bridgeClient?.activeRobotId);
    if (!this.bridgeClient || !connected || !hasRobotId) {
      return false;
    }
    const sent = this.bridgeClient.sendRegistrationCommand("start", mode);
    if (sent) {
      this._lastStatusTime = getTime();
      if (mode === "manual_pose") {
        this._lastSubmittedManualPose = null;
      }
      print(`RegistrationClient: registration_command start mode=${mode} sent`);
    }
    return sent;
  }

  private _onRegistrationStatus = (msg: RegistrationStatusMessage): void => {
    this._lastStatusTime = getTime();
    if (msg.phase !== "awaiting_motion") {
      this._motionAuthorizePending = false;
    }
    if (msg.phase === "failed" && (this._intent !== null || this._awaitingCommit)) {
      print(
        `RegistrationClient: registration_status failed "${msg.message || "unknown"}"`,
      );
      this._intent = null;
      this._awaitingCommit = false;
      if (this.frameCapture) {
        this.frameCapture.setMode("off");
        this.frameCapture.setCapturePolicy("off");
      }
    } else if (msg.phase === "succeeded") {
      this._awaitingCommit = false;
      this._intent = null;
    }
    if (this._intent === "april_odom_baseline" || this._awaitingCommit) {
      this._applyCapturePolicy(msg.capture);
    }
    this.onRegistrationStatus.emit(msg);
  };

  private _applyCapturePolicy(capture: CaptureHint): void {
    if (!this.frameCapture) {
      return;
    }
    this.frameCapture.setCapturePolicy(capture);
  }

  private _poseFromReference(
    position: vec3,
    rotation: quat,
  ): { position: vec3; rotation: quat } {
    return {
      position: new vec3(
        position.x,
        position.y - MANUAL_MARKER_DOWN_CM,
        position.z,
      ),
      rotation: cloneQuat(rotation),
    };
  }

  private _poseFromMarkerWorld(
    position: vec3,
    rotation: quat,
  ): { position: vec3; rotation: quat } {
    return {
      position: cloneVec3(position),
      rotation: cloneQuat(rotation),
    };
  }

  private _manualPoseMatchesLastSubmitted(
    position: vec3,
    rotation: quat,
  ): boolean {
    const last = this._lastSubmittedManualPose;
    if (!last) {
      return false;
    }
    return (
      vec3Distance(position, last.position) <= MANUAL_POSE_POSITION_EPS_CM &&
      quatAngularDistanceRad(rotation, last.rotation) <=
        MANUAL_POSE_ROTATION_EPS_RAD
    );
  }

  private _logThrottled(kind: "capture" | "submit", message: string): void {
    const now = getTime();
    const lastTime =
      kind === "capture" ? this._lastCaptureLogTime : this._lastSubmitLogTime;
    if (lastTime >= 0 && now - lastTime < MANUAL_REGISTRATION_LOG_INTERVAL_S) {
      return;
    }
    if (kind === "capture") {
      this._lastCaptureLogTime = now;
    } else {
      this._lastSubmitLogTime = now;
    }
    print(message);
  }
}
