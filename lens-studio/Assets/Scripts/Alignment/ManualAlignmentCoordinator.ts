// ================================================================
/**
 * Encapsulates all manual robot-alignment logic: owns the
 * ManualAlignmentController, pose-capture throttle, and capability
 * queries. Consumed by DimosManager via injected callbacks so the
 * coordinator never holds a direct reference back to the component.
 */
// ================================================================

import { RobotMarker } from "../Visuals/RobotMarker";
import { BridgeClient } from "../Network/BridgeClient";
import { ManualPoseCorrection } from "./ManualPoseCorrection";
import {
  ManualAlignmentController,
  manualMarkerPoseFromMarkerWorldPose,
  manualMarkerPoseFromReference,
} from "./ManualAlignmentController";
import { RobotInteractionMode } from "../AppState";

export interface ManualAlignmentCoordinatorDeps {
  bridgeClient: BridgeClient | null;
  robotMarker: RobotMarker | null;
  poseCorrection: ManualPoseCorrection;
  hasBridgeConnection: () => boolean;
  isCapabilityAvailable: (cap: string) => boolean;
  getInteractionMode: () => RobotInteractionMode;
  setInteractionMode: (mode: RobotInteractionMode) => void;
  getIsActive: () => boolean;
  disableNavigationPlacementForAlignment: () => void;
}

export class ManualAlignmentCoordinator {
  private readonly _controller: ManualAlignmentController;
  private _lastCaptureLogTime = -1;

  constructor(private readonly _deps: ManualAlignmentCoordinatorDeps) {
    this._controller = new ManualAlignmentController(
      _deps.bridgeClient,
      _deps.robotMarker,
    );
  }

  public canUseMarkerAlignment(): boolean {
    return this._deps.isCapabilityAvailable("align");
  }

  public canUseManualAlignment(): boolean {
    return this._deps.isCapabilityAvailable("align_manual");
  }

  public preferredCalibrationMode(): "auto" | "manualOnly" | "manualAvailable" {
    if (
      this._deps.hasBridgeConnection() &&
      !this.canUseMarkerAlignment() &&
      this.canUseManualAlignment()
    ) {
      return "manualOnly";
    }
    if (this.canUseManualAlignment()) {
      return "manualAvailable";
    }
    return "auto";
  }

  public beginPlacementAt(position: vec3, rotation: quat): void {
    this._deps.disableNavigationPlacementForAlignment();
    const pose = manualMarkerPoseFromReference(position, rotation);
    this._deps.poseCorrection.setAnchorPose(pose);
    const p = pose.position;
    const r = pose.rotation;
    this._log(
      `beginManualAlignmentPlacementAt: initial pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) rot=(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)}, ${r.w.toFixed(3)})`,
    );
    this._controller.beginPlacementPose(pose);
    this._deps.setInteractionMode("manualPlacement");
  }

  public clearPose(): void {
    this._deps.poseCorrection.reset();
  }

  public cancelPlacement(): void {
    this._controller.cancelPlacement();
    if (this._deps.getInteractionMode() === "manualPlacement") {
      this._deps.setInteractionMode(this._deps.getIsActive() ? "runtimeRobot" : "hidden");
    }
  }

  public freezePlacement(): void {
    if (this._deps.getInteractionMode() !== "manualPlacement") {
      return;
    }
    const rm = this._deps.robotMarker;
    if (!rm) {
      return;
    }
    rm.setVisible(true);
    rm.setToggleEnabled(false);
    rm.setMenuEnabled(false);
    rm.setManualPlacementEnabled(false);
  }

  public startSession(): boolean {
    return this._controller.startSession(this._deps.hasBridgeConnection()) ?? false;
  }

  public stopSession(): void {
    this._controller.stopSession(this._deps.hasBridgeConnection());
  }

  public captureCandidate(): boolean {
    const candidate = this._controller.captureCandidate();
    if (!candidate) {
      this._logThrottled("captureManualAlignmentCandidate: no marker pose");
      return false;
    }
    this._deps.poseCorrection.setAnchorPose(
      manualMarkerPoseFromMarkerWorldPose(candidate.position, candidate.rotation),
    );
    const submitted = this._submitCandidate(candidate.position, candidate.rotation);
    if (!submitted) {
      this._logThrottled("captureManualAlignmentCandidate: align_manual_pose send failed");
    }
    return submitted;
  }

  public finalizeOfflineAlignment(): boolean {
    const candidate = this._controller.captureCandidate();
    if (!candidate) {
      this._log("finalizeOfflineManualAlignment: no candidate captured");
      return false;
    }
    const pose = manualMarkerPoseFromMarkerWorldPose(candidate.position, candidate.rotation);
    this._deps.poseCorrection.setAnchorPose(pose);
    const r = candidate.rotation;
    this._log(
      `finalizeOfflineManualAlignment: captured pos=(${candidate.position.x.toFixed(1)}, ${candidate.position.y.toFixed(1)}, ${candidate.position.z.toFixed(1)}) rot=(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)}, ${r.w.toFixed(3)})`,
    );
    return true;
  }

  private _submitCandidate(position: vec3, rotation: quat): boolean {
    const markerPose = manualMarkerPoseFromMarkerWorldPose(position, rotation);
    return (
      this._controller.submitCandidate(
        position,
        markerPose.rotation,
        this._deps.hasBridgeConnection(),
      ) ?? false
    );
  }

  private _logThrottled(message: string): void {
    const now = getTime();
    if (this._lastCaptureLogTime >= 0 && now - this._lastCaptureLogTime < 2.0) {
      return;
    }
    this._lastCaptureLogTime = now;
    this._log(message);
  }

  private _log(message: string): void {
    print(`ManualAlignmentCoordinator: ${message}`);
  }
}
