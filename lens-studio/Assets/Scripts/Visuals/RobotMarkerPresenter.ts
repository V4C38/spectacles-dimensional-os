// ================================================================
/**
 * Applies robot-marker interaction modes and resolves/forwards display poses
 * to the RobotMarker component. Extracted from DimosManager; holds no
 * Lens scene-event logic — all state is read through injected callbacks.
 */
// ================================================================

import { RobotMarker } from "./RobotMarker";
import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { ManualPoseCorrection, ResolvedDisplayPose } from "../Alignment/ManualPoseCorrection";
import { RobotMenuController } from "../UI/RobotMenuController";
import { OperatingMode, RobotInteractionMode } from "../AppState";
import { PoseMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";

export interface RobotMarkerPresenterDeps {
  robotMarker: RobotMarker | null;
  frameCaptureController: FrameCaptureController | null;
  poseCorrection: ManualPoseCorrection;
  getRobotMenuController: () => RobotMenuController | null;
  getIsActive: () => boolean;
  getOperatingMode: () => OperatingMode;
  getLastPose: () => PoseMessage | null;
  getInteractionMode: () => RobotInteractionMode;
  syncNavigationPlacementState: () => void;
}

export class RobotMarkerPresenter {
  constructor(private readonly _deps: RobotMarkerPresenterDeps) {}

  public isReady(): boolean {
    const marker = this._deps.robotMarker as RobotMarker | null;
    return marker != null && typeof marker.setVisible === "function";
  }

  /**
   * Apply the given interaction mode to the robot marker and its floating
   * menu. Mirrors the hidden/manualPlacement/runtimeRobot switch previously
   * inside DimosManager._applyRobotInteractionMode.
   */
  public applyInteractionMode(mode: RobotInteractionMode): void {
    if (!this.isReady()) {
      return;
    }
    const marker = this._deps.robotMarker!;
    const menu = this._deps.getRobotMenuController();
    switch (mode) {
      case "hidden":
        marker.setManualPlacementEnabled(false);
        marker.setToggleEnabled(false);
        marker.setMenuEnabled(false);
        marker.setVisible(false);
        menu?.hide();
        this._deps.syncNavigationPlacementState();
        return;
      case "manualPlacement":
        marker.setVisible(true);
        marker.setToggleEnabled(false);
        marker.setMenuEnabled(false);
        marker.setManualPlacementEnabled(true);
        menu?.hide();
        this.syncPose();
        this._deps.syncNavigationPlacementState();
        return;
      case "runtimeRobot":
        const isActive = this._deps.getIsActive();
        marker.setVisible(isActive);
        marker.setToggleEnabled(isActive);
        marker.setMenuEnabled(isActive);
        marker.setManualPlacementEnabled(false);
        if (isActive) {
          menu?.setOperatingMode(this._deps.getOperatingMode());
          this.syncPose();
        } else {
          menu?.hide();
        }
        this._deps.syncNavigationPlacementState();
        return;
    }
  }

  /**
   * Re-resolve the display pose from the current last bridge pose and
   * apply it to the marker. Equivalent to the former
   * DimosManager._syncRobotMarkerPose.
   */
  public syncPose(): void {
    if (!this._deps.robotMarker) {
      return;
    }
    const lastPose = this._deps.getLastPose();
    const resolved = this._deps.poseCorrection.resolveDisplayPose(
      lastPose,
      this._deps.getInteractionMode(),
    );
    this._applyResolvedPose(resolved, lastPose);
  }

  /**
   * Apply an already-resolved display pose to the marker. Use when the
   * caller has already computed the resolved pose (e.g. in the onPose
   * bridge event handler where the raw bridge message is available directly).
   */
  public applyResolvedPose(resolved: ResolvedDisplayPose, bridgePose: PoseMessage | null): void {
    this._applyResolvedPose(resolved, bridgePose);
  }

  private _applyResolvedPose(resolved: ResolvedDisplayPose, bridgePose: PoseMessage | null): void {
    if (!this._deps.robotMarker) {
      return;
    }
    const marker = this._deps.robotMarker;
    switch (resolved.kind) {
      case "manual":
        marker.applyManualPose(resolved.position!, resolved.rotation!);
        break;
      case "bridge":
        if (bridgePose) {
          marker.applyPose(bridgePose);
          const worldPos = protocolMetersToLensCentimeters(bridgePose.position);
          this._deps.frameCaptureController?.setRobotWorldPosition(worldPos);
        }
        break;
      case "corrected":
        marker.applyRuntimeLensPose(resolved.position!, resolved.rotation!);
        break;
      case "none":
        break;
    }
  }
}
