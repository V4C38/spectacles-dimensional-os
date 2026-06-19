// ================================================================
/**
 * Single owner of the bridge alignment session (marker and manual modes).
 * Replaces TagAlignmentSession + ManualAlignmentCoordinator + ManualAlignmentController.
 *
 * Design invariant: the session tracks *intent* (method or none) separately
 * from *bridge confirmation*. ensureSession() re-sends align_start{method}
 * whenever intent is set but confirmation is cleared — which happens on
 * every disconnect and on every hello. This unconditional re-arm on hello
 * fixes B1 (manual session never re-armed when bridge connects late).
 */
// ================================================================

import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { BridgeClient } from "../Bridge/BridgeClient";
import {
  AlignStatusMessage,
} from "../Bridge/Protocol";
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
const MANUAL_ALIGN_LOG_INTERVAL_S = 2.0;
const NO_RESPONSE_TIMEOUT_S = 10.0;
/** Skip bridge resend when marker pose is unchanged within these tolerances. */
const MANUAL_POSE_POSITION_EPS_CM = 0.5;
const MANUAL_POSE_ROTATION_EPS_RAD = 0.02;

export interface AlignmentSessionDeps {
  poseCorrection: ManualPoseCorrection;
  hasBridgeConnection: () => boolean;
  isCapabilityAvailable: (cap: string) => boolean;
  getInteractionMode: () => RobotInteractionMode;
  setInteractionMode: (mode: RobotInteractionMode) => void;
  getIsRuntimePhase: () => boolean;
  disableNavigationPlacementForAlignment: () => void;
}

export class AlignmentSession {
  public readonly onAlignStatus = new Signal<AlignStatusMessage>();

  constructor(
    private readonly bridgeClient: BridgeClient | null,
    private readonly frameCapture: FrameCaptureController | null,
    private readonly robotMarker: RobotMarker | null,
  ) {}

  /** Intent: the method we want to run. Null = no session desired. */
  private _intent: "tag" | "manual" | null = null;
  private _assist: boolean = false;
  /** Bridge confirmation: cleared on every disconnect/hello so ensureSession re-arms. */
  private _bridgeSessionConfirmed = false;
  private _awaitingCommit = false;
  /** Timestamp of last align_status received while session active. */
  private _lastAlignStatusTime = -1;
  private _lastCaptureLogTime = -1;
  private _lastSubmitLogTime = -1;
  private _lastSubmittedManualPose: {
    position: vec3;
    rotation: quat;
  } | null = null;
  private _deps: AlignmentSessionDeps | null = null;
  private _bound = false;

  /** Called after construction to inject non-component deps. */
  public initialize(deps: AlignmentSessionDeps): void {
    this._deps = deps;
  }

  public bind(): void {
    if (this._bound || !this.bridgeClient) {
      return;
    }
    this._bound = true;
    this.bridgeClient.onAlignStatus.add(this._onAlignStatus);
    this.bridgeClient.onConnectionChanged.add((connected) => {
      if (!connected) {
        // Clear confirmation so ensureSession will re-arm on next hello.
        this._bridgeSessionConfirmed = false;
        this._lastAlignStatusTime = -1;
        this._lastSubmittedManualPose = null;
      }
    });
    this.bridgeClient.onHello.add(() => {
      // Every hello clears the confirmed flag so ensureSession sends a fresh
      // align_start. This is the B1 fix — works for both auto and manual modes.
      this._bridgeSessionConfirmed = false;
      this._lastAlignStatusTime = getTime();
    });
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Start a new alignment session with the given method.
   * Sets intent, attempts to send align_start to the bridge (non-blocking —
   * ensureSession() will retry on the next hello if the bridge isn't ready).
   */
  public start(method: "tag" | "manual", assist: boolean = false): void {
    this._intent = method;
    this._assist = method === "tag" && assist;
    this._awaitingCommit = false;
    this._bridgeSessionConfirmed = false;
    this._lastAlignStatusTime = -1;
    this._lastSubmittedManualPose = null;
    this._tryStartBridgeSession(method);
    if (this.frameCapture) {
      this.frameCapture.setMode(method === "tag" ? "setup" : "off");
    }
    print(`AlignmentSession: start method=${method} assist=${this._assist}`);
  }

  public confirmAssist(): void {
    if (this.bridgeClient) {
      this.bridgeClient.sendAssistConfirm();
    }
  }

  public stop(): void {
    if (this._intent === null && !this._awaitingCommit) {
      return;
    }
    const shouldSendStop = this._bridgeSessionConfirmed;
    const wasMarker = this._intent === "tag";
    this._intent = null;
    this._awaitingCommit = false;
    this._bridgeSessionConfirmed = false;
    this._lastAlignStatusTime = -1;
    this._lastSubmittedManualPose = null;
    if (shouldSendStop && this.bridgeClient) {
      this.bridgeClient.sendAlignStop();
    }
    if (this.frameCapture) {
      const registered = Boolean(
        this.bridgeClient?.lastBridgeStatus?.registered,
      );
      this.frameCapture.setMode(registered ? "runtime" : "off");
    }
    if (wasMarker) {
      print("AlignmentSession: stop (marker)");
    } else {
      print("AlignmentSession: stop (manual)");
    }
  }

  public commit(): boolean {
    if (!this.bridgeClient) {
      return false;
    }
    const sent = this.bridgeClient.sendAlignCommit();
    if (sent) {
      this._awaitingCommit = true;
      this._intent = null;
      print("AlignmentSession: align_commit sent");
    }
    return sent;
  }

  /**
   * Re-arm bridge session if intent is set and confirmation is cleared.
   * Called by SetupWizard on every hello (B1 fix).
   */
  public ensureSession(): boolean {
    if (this._intent === null || this._bridgeSessionConfirmed) {
      return this._bridgeSessionConfirmed;
    }
    return this._tryStartBridgeSession(this._intent);
  }

  public hasActiveIntent(): boolean {
    return this._intent !== null;
  }

  /**
   * Begin manual placement: drop marker below view position and enable
   * drag interaction. Disables nav placement.
   */
  public beginManualPlacement(position: vec3, rotation: quat): void {
    if (!this._deps) {
      return;
    }
    this._deps.disableNavigationPlacementForAlignment();
    const pose = this._poseFromReference(position, rotation);
    this._deps.poseCorrection.setAnchorPose(pose);
    const p = pose.position;
    const r = pose.rotation;
    print(
      `AlignmentSession: beginManualPlacement pos=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) rot=(${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)},${r.w.toFixed(3)})`,
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

  /**
   * Capture current robot marker pose and send align_manual_pose to bridge.
   * Returns true if submitted successfully.
   */
  public captureAndSubmitManualPose(force: boolean = false): boolean {
    const position = this.robotMarker?.getWorldPosition() ?? null;
    const rotation = this.robotMarker?.getRotation() ?? null;
    if (!position || !rotation) {
      this._logThrottled(
        "capture",
        "AlignmentSession: marker position/rotation unavailable",
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
      this.bridgeClient?.sendAlignManualPose(position, rotation) ?? false;
    if (sent) {
      this._lastSubmittedManualPose = {
        position: cloneVec3(position),
        rotation: cloneQuat(rotation),
      };
    } else {
      this._logThrottled(
        "submit",
        "AlignmentSession: align_manual_pose send failed",
      );
    }
    return sent;
  }

  /** Finalize alignment offline: set pose correction from current marker. */
  public finalizeOffline(): boolean {
    const position = this.robotMarker?.getWorldPosition() ?? null;
    const rotation = this.robotMarker?.getRotation() ?? null;
    if (!position || !rotation) {
      print("AlignmentSession: finalizeOffline — marker position unavailable");
      return false;
    }
    const pose = this._poseFromMarkerWorld(position, rotation);
    if (this._deps) {
      this._deps.poseCorrection.setAnchorPose(pose);
    }
    const r = rotation;
    print(
      `AlignmentSession: finalizeOffline pos=(${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}) rot=(${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)},${r.w.toFixed(3)})`,
    );
    return true;
  }

  /** Preferred calibration mode based on bridge capabilities. */
  public preferredMode(): "auto" | "manualOnly" | "manualAvailable" {
    if (!this._deps) {
      return "auto";
    }
    const hasAlign = this._deps.isCapabilityAvailable("align");
    const hasManual = this._deps.isCapabilityAvailable("align_manual");
    if (this._deps.hasBridgeConnection() && !hasAlign && hasManual) {
      return "manualOnly";
    }
    if (hasManual) {
      return "manualAvailable";
    }
    return "auto";
  }

  /**
   * Returns whether we are past the no-response timeout: the session has
   * been active for more than NO_RESPONSE_TIMEOUT_S with no align_status.
   */
  public isNoResponseTimeout(): boolean {
    if (this._intent === null || this._lastAlignStatusTime < 0) {
      return false;
    }
    return getTime() - this._lastAlignStatusTime > NO_RESPONSE_TIMEOUT_S;
  }

  // ── Internals ──────────────────────────────────────────────────

  private _tryStartBridgeSession(method: "tag" | "manual"): boolean {
    const connected = Boolean(this.bridgeClient?.isConnected());
    const hasRobotId = Boolean(this.bridgeClient?.activeRobotId);
    if (!this.bridgeClient || !connected || !hasRobotId) {
      return false;
    }
    const assist =
      method === "tag" &&
      this._assist &&
      Boolean(this._deps?.isCapabilityAvailable("align_assist"));
    const sent = this.bridgeClient.sendAlignStart(method, assist);
    if (sent) {
      this._bridgeSessionConfirmed = true;
      this._lastAlignStatusTime = getTime();
      if (method === "manual") {
        this._lastSubmittedManualPose = null;
      }
      print(`AlignmentSession: align_start{method:${method},assist:${assist}} sent`);
    }
    return sent;
  }

  private _onAlignStatus = (msg: AlignStatusMessage): void => {
    this._lastAlignStatusTime = getTime();
    if (msg.state === "failed" && (this._intent !== null || this._awaitingCommit)) {
      print(
        `AlignmentSession: align_status failed "${msg.message || "unknown"}"`,
      );
      this._intent = null;
      this._awaitingCommit = false;
      this._bridgeSessionConfirmed = false;
      if (this.frameCapture) {
        this.frameCapture.setMode("off");
      }
    }
    this.onAlignStatus.emit(msg);
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
    const now = getTime();
    const lastTime =
      kind === "capture" ? this._lastCaptureLogTime : this._lastSubmitLogTime;
    if (lastTime >= 0 && now - lastTime < MANUAL_ALIGN_LOG_INTERVAL_S) {
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
