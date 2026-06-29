// ================================================================
/**
 * Single owner of the bridge registration session (AprilTag baseline and manual pose).
 */
// ================================================================

import { FrameCaptureController } from "../Camera/FrameCaptureController";
import {
  buildRegistrationCommand,
  buildRegistrationPose,
  CaptureHint,
  RegistrationCommandAction,
  RegistrationMode,
  RegistrationStatusMessage,
} from "../Network/Protocol";
import { InboundProcessor } from "../Network/InboundProcessor";
import { WebSocketTransport } from "../Network/WebSocketTransport";
import { sendForActiveRobot } from "../Network/WebSocketTransport";
import {
  cloneQuat,
  cloneVec3,
  logThrottled,
  quatAngularDistanceRad,
  Signal,
  vec3Distance,
} from "../../App/Utilities/Utilities";
import { RobotMarker } from "../../App/Robot/RobotMarker";
import { ManualRegistrationAlignment } from "./ManualRegistrationAlignment";
import { RobotInteractionMode } from "../../App/AppState";
import { ARBridgeSession } from "../Network/ARBridgeSession";

const MANUAL_MARKER_DOWN_CM = 35.0;
const MANUAL_REGISTRATION_LOG_INTERVAL_S = 2.0;
const NO_RESPONSE_TIMEOUT_S = 10.0;
const MANUAL_POSE_POSITION_EPS_CM = 0.5;
const MANUAL_POSE_ROTATION_EPS_RAD = 0.02;

export interface RegistrationClientDeps {
  manualRegistrationAlignment: ManualRegistrationAlignment;
  hasBridgeConnection: () => boolean;
  isCapabilityAvailable: (cap: string) => boolean;
  getInteractionMode: () => RobotInteractionMode;
  setInteractionMode: (mode: RobotInteractionMode) => void;
  getIsRuntimePhase: () => boolean;
  disableNavigationPlacementForRegistration: () => void;
}

export class RegistrationClient {
  public readonly onRegistrationStatus = new Signal<RegistrationStatusMessage>();
  public readonly onCapturePolicyInputsChanged = new Signal<void>();

  private readonly _sendDropLog = { value: -1 };
  private _lastRegistrationCommandLogAction = "";

  constructor(
    private readonly _session: ARBridgeSession | null,
    private readonly _transport: WebSocketTransport | null,
    private readonly _inbound: InboundProcessor | null,
    private readonly frameCapture: FrameCaptureController | null,
    private readonly robotMarker: RobotMarker | null,
  ) {}

  private _intent: RegistrationMode | null = null;
  private _awaitingCommit = false;
  private _baselineCaptureSessionActive = false;
  private _registrationCaptureHint: CaptureHint = "off";
  private _lastStatusTime = -1;
  private _lastCaptureLogTime = { value: -1 };
  private _lastSubmitLogTime = { value: -1 };
  private _lastSubmittedManualPose: {
    position: vec3;
    rotation: quat;
  } | null = null;
  private _deps: RegistrationClientDeps | null = null;
  private _bound = false;
  private _motionAuthorizePending = false;

  public get awaitingCommit(): boolean {
    return this._awaitingCommit;
  }

  public get baselineCaptureSessionActive(): boolean {
    return this._baselineCaptureSessionActive;
  }

  public get registrationCaptureHint(): CaptureHint {
    return this._registrationCaptureHint;
  }

  public initialize(deps: RegistrationClientDeps): void {
    this._deps = deps;
  }

  public bind(): void {
    if (this._bound || !this._inbound) {
      return;
    }
    this._bound = true;
    this._inbound.onRegistrationStatus.add(this._onRegistrationStatus);
    this._session?.onConnectionChanged.add((connected) => {
      if (!connected) {
        this._lastStatusTime = -1;
        this._lastSubmittedManualPose = null;
      }
    });
    this._inbound.onHello.add(() => {
      this._lastStatusTime = getTime();
      if (this._intent !== null) {
        this._tryStartBridgeSession(this._intent);
      }
    });
  }

  public start(mode: RegistrationMode): void {
    this._intent = mode;
    this._awaitingCommit = false;
    this._motionAuthorizePending = false;
    this._lastStatusTime = -1;
    this._lastSubmittedManualPose = null;
    this._baselineCaptureSessionActive = mode === "april_odom_baseline";
    this._registrationCaptureHint =
      mode === "april_odom_baseline" ? "steady" : "off";
    this._tryStartBridgeSession(mode);
    this._notifyCapturePolicyInputsChanged();
    print(`RegistrationClient: start mode=${mode}`);
  }

  public authorizeMotion(): void {
    this.requestMotionAuthorization();
  }

  public requestMotionAuthorization(): boolean {
    if (this._motionAuthorizePending) {
      return false;
    }
    if (!this._transport || !this._inbound) {
      print("RegistrationClient: requestMotionAuthorization — bridge unavailable");
      return false;
    }
    this._motionAuthorizePending = true;
    const sent = this.sendRegistrationCommand("authorize_motion");
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
    this._baselineCaptureSessionActive = false;
    this._registrationCaptureHint = "off";
    if (notifyBridge && this._session?.isConnected()) {
      this.sendRegistrationCommand("stop");
    }
    this._notifyCapturePolicyInputsChanged();
    print(
      wasBaseline
        ? "RegistrationClient: stop (april_odom_baseline)"
        : "RegistrationClient: stop (manual_pose)",
    );
  }

  public commit(): boolean {
    const sent = this.sendRegistrationCommand("commit");
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

  public sendRegistrationCommand(
    command: RegistrationCommandAction,
    mode?: RegistrationMode,
  ): boolean {
    if (!this._transport || !this._inbound) {
      return false;
    }
    const action =
      mode !== undefined
        ? `registration_command:${command}:${mode}`
        : `registration_command:${command}`;
    const sent = sendForActiveRobot(
      this._transport,
      this._inbound,
      action,
      (robotId) => buildRegistrationCommand(robotId, command, mode),
      this._sendDropLog,
    );
    if (sent && action.startsWith("registration") && action !== this._lastRegistrationCommandLogAction) {
      this._lastRegistrationCommandLogAction = action;
      print(`RegistrationClient: ${action} sent`);
    }
    return sent;
  }

  public sendRegistrationPose(position: vec3, rotation: quat): boolean {
    if (!this._transport || !this._inbound) {
      return false;
    }
    return sendForActiveRobot(
      this._transport,
      this._inbound,
      "registration_pose",
      (robotId) => buildRegistrationPose(position, rotation, robotId),
      this._sendDropLog,
    );
  }

  public beginManualPlacement(position: vec3, rotation: quat): void {
    if (!this._deps) {
      return;
    }
    this._deps.disableNavigationPlacementForRegistration();
    const pose = this._poseFromReference(position, rotation);
    this._deps.manualRegistrationAlignment.setAnchorPose(pose);
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
    this._deps?.manualRegistrationAlignment.reset();
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
      this._deps.manualRegistrationAlignment.setAnchorPose(pose);
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
    const sent = this.sendRegistrationPose(position, rotation);
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
      this._deps.manualRegistrationAlignment.setAnchorPose(pose);
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

  private _notifyCapturePolicyInputsChanged(): void {
    this.onCapturePolicyInputsChanged.emit();
  }

  private _tryStartBridgeSession(mode: RegistrationMode): boolean {
    const connected = Boolean(this._session?.isConnected());
    const hasRobotId = Boolean(this._inbound?.activeRobotId);
    if (!this._transport || !this._inbound || !connected || !hasRobotId) {
      return false;
    }
    const sent = this.sendRegistrationCommand("start", mode);
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
      this._baselineCaptureSessionActive = false;
      this._registrationCaptureHint = "off";
      this._notifyCapturePolicyInputsChanged();
    } else if (msg.phase === "succeeded") {
      this._awaitingCommit = false;
      this._intent = null;
    }
    if (this._intent === "april_odom_baseline" || this._awaitingCommit) {
      this._registrationCaptureHint = msg.capture;
      this._notifyCapturePolicyInputsChanged();
    }
    this.onRegistrationStatus.emit(msg);
  };

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
    const lastTime =
      kind === "capture" ? this._lastCaptureLogTime : this._lastSubmitLogTime;
    logThrottled(
      lastTime,
      MANUAL_REGISTRATION_LOG_INTERVAL_S,
      print,
      message,
    );
  }
}
