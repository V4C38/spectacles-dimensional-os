import {
  BridgeStatusMessage,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../Bridge/domain";
import { RobotInteractionMode } from "../Core/AppState";

export interface ManualAlignmentPose {
  position: vec3;
  rotation: quat;
}

// ================================================================
/**
 * Encapsulates manual-alignment anchor state and the quaternion
 * correction math used to remap bridge-frame robot poses to the
 * manually placed anchor frame.
 */
// ================================================================

export interface ResolvedDisplayPose {
  kind: "manual" | "corrected" | "bridge" | "none";
  /** World-space position (cm) — set for "manual" and "corrected" kinds. */
  position?: vec3;
  /** World-space rotation — set for "manual" and "corrected" kinds. */
  rotation?: quat;
}

export class ManualPoseCorrection {
  private _manualAlignmentPose: ManualAlignmentPose | null = null;
  private _preferManualPoseUntilNextRuntimePose = false;
  private _useManualPoseCorrection = false;
  private _manualPoseCorrectionRotation: quat | null = null;
  private _manualPoseCorrectionTranslation: vec3 | null = null;

  public get anchorPose(): ManualAlignmentPose | null {
    return this._manualAlignmentPose;
  }

  /** Set or clear the manual alignment anchor; resets the lazy correction transform. */
  public setAnchorPose(pose: ManualAlignmentPose | null): void {
    this._manualAlignmentPose = pose;
    this._manualPoseCorrectionRotation = null;
    this._manualPoseCorrectionTranslation = null;
  }

  /**
   * Called on enterRuntime; sets the use-correction flag based on whether the
   * current registration is approximate (manual-only).
   */
  public prepareForRuntime(isApproximate: boolean): void {
    this._preferManualPoseUntilNextRuntimePose = this._manualAlignmentPose !== null;
    this._useManualPoseCorrection =
      this._manualAlignmentPose !== null && isApproximate;
    this._manualPoseCorrectionRotation = null;
    this._manualPoseCorrectionTranslation = null;
  }

  /**
   * Update correction flags from a bridge_status message.
   * Returns true when the anchor pose should be cleared (exact registration received).
   */
  public onBridgeStatus(
    msg: BridgeStatusMessage,
    inManualPlacement: boolean,
  ): boolean {
    if (
      msg.registered &&
      msg.registration_approximate &&
      this._manualAlignmentPose
    ) {
      this._useManualPoseCorrection = true;
    }
    if (msg.registered && !msg.registration_approximate && !inManualPlacement) {
      this._useManualPoseCorrection = false;
      return true;
    }
    return false;
  }

  /** Reset correction transform and prefer-manual flag on disconnection. */
  public onDisconnected(): void {
    this._preferManualPoseUntilNextRuntimePose =
      this._manualAlignmentPose !== null;
    this._manualPoseCorrectionRotation = null;
    this._manualPoseCorrectionTranslation = null;
  }

  /** Clear all anchor and correction state (equivalent to the old clearManualAlignmentPose). */
  public reset(): void {
    this._manualAlignmentPose = null;
    this._preferManualPoseUntilNextRuntimePose = false;
    this._useManualPoseCorrection = false;
    this._manualPoseCorrectionRotation = null;
    this._manualPoseCorrectionTranslation = null;
  }

  /**
   * Resolve which pose to display and compute its world-space position/rotation.
   *
   * Decision order (matches original DimosManager._syncRobotMarkerPose +
   * _applyRobotDisplayPose, logic unchanged):
   *   1. Manual anchor during placement mode or while awaiting first runtime pose.
   *   2. Bridge pose with optional correction (anchorRotation * bridgeRotation⁻¹,
   *      lazily computed and cached on the first received bridge pose).
   *   3. Manual anchor fallback when no bridge pose has arrived yet.
   *   4. None — caller does nothing.
   *
   * Side-effects: may set _preferManualPoseUntilNextRuntimePose = false and may
   * lazily compute/cache the correction transform.
   */
  public resolveDisplayPose(
    bridgePose: PoseMessage | null,
    interactionMode: RobotInteractionMode,
  ): ResolvedDisplayPose {
    // Manual anchor takes precedence during placement or while awaiting the
    // first runtime bridge pose. Once a live pose arrives (_preferManual stays
    // true but bridgePose is now non-null), fall through to the corrected
    // branch so the correction transform is computed and the flag is cleared.
    if (
      this._manualAlignmentPose &&
      (interactionMode === "manualPlacement" ||
        (this._preferManualPoseUntilNextRuntimePose && !bridgePose))
    ) {
      return {
        kind: "manual",
        position: this._manualAlignmentPose.position,
        rotation: this._manualAlignmentPose.rotation,
      };
    }

    // Bridge pose path (with optional correction) — only outside manual-placement.
    if (bridgePose && interactionMode !== "manualPlacement") {
      const shouldApplyCorrection =
        this._manualAlignmentPose !== null && this._useManualPoseCorrection;

      if (!shouldApplyCorrection) {
        this._preferManualPoseUntilNextRuntimePose = false;
        // Caller applies bridgePose directly via robotMarker.applyPose(msg).
        return { kind: "bridge" };
      }

      // Correction path: anchorRotation * bridgeRotation⁻¹, lazily computed.
      const q = bridgePose.orientation;
      const bridgePosition = protocolMetersToLensCentimeters(bridgePose.position);
      const bridgeRotation = new quat(q[3], q[0], q[1], q[2]);

      if (
        this._manualPoseCorrectionRotation === null ||
        this._manualPoseCorrectionTranslation === null
      ) {
        const anchorPosition = this._manualAlignmentPose!.position;
        const anchorRotation = this._manualAlignmentPose!.rotation;
        this._manualPoseCorrectionRotation = anchorRotation.multiply(
          bridgeRotation.invert(),
        );
        const rotatedBridgePos =
          this._manualPoseCorrectionRotation.multiplyVec3(bridgePosition);
        this._manualPoseCorrectionTranslation =
          anchorPosition.sub(rotatedBridgePos);
      }

      const correctedRotation =
        this._manualPoseCorrectionRotation.multiply(bridgeRotation);
      const correctedPosition = this._manualPoseCorrectionRotation
        .multiplyVec3(bridgePosition)
        .add(this._manualPoseCorrectionTranslation);
      this._preferManualPoseUntilNextRuntimePose = false;
      return {
        kind: "corrected",
        position: correctedPosition,
        rotation: correctedRotation,
      };
    }

    // Fallback: show manual anchor when no bridge pose is available yet.
    if (this._manualAlignmentPose) {
      return {
        kind: "manual",
        position: this._manualAlignmentPose.position,
        rotation: this._manualAlignmentPose.rotation,
      };
    }

    return { kind: "none" };
  }
}
