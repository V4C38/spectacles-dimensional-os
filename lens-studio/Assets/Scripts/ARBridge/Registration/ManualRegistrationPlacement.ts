import {
  BridgeStatusMessage,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../Network/Protocol";
import { RobotInteractionMode } from "../../App/AppState";

export interface ManualRegistrationAnchor {
  position: vec3;
  rotation: quat;
}

// ================================================================
/**
 * Encapsulates manual-registration anchor state and the quaternion
 * placement math used to remap bridge-frame robot poses to the
 * manually placed anchor frame.
 */
// ================================================================

export type RobotMarkerPoseSource =
  | "manual_anchor"
  | "approximate_pose"
  | "world_frame_pose"
  | "none";

export interface RobotMarkerPose {
  source: RobotMarkerPoseSource;
  /** World-space position (cm) — set for manual_anchor and approximate_pose. */
  position?: vec3;
  /** World-space rotation — set for manual_anchor and approximate_pose. */
  rotation?: quat;
}

export class ManualRegistrationPlacement {
  private _registrationAnchor: ManualRegistrationAnchor | null = null;
  private _preferRegistrationAnchorUntilNextRuntimePose = false;
  private _useApproximateAlignment = false;
  private _approximateAlignmentRotation: quat | null = null;
  private _approximateAlignmentTranslation: vec3 | null = null;

  public get anchorPose(): ManualRegistrationAnchor | null {
    return this._registrationAnchor;
  }

  /** Set or clear the manual registration anchor; resets the lazy alignment transform. */
  public setAnchorPose(pose: ManualRegistrationAnchor | null): void {
    this._registrationAnchor = pose;
    this._approximateAlignmentRotation = null;
    this._approximateAlignmentTranslation = null;
  }

  /**
   * Called on enterRuntime; sets the approximate-alignment flag based on whether the
   * current registration is approximate (manual-only).
   */
  public prepareForRuntime(isApproximate: boolean): void {
    this._preferRegistrationAnchorUntilNextRuntimePose = this._registrationAnchor !== null;
    this._useApproximateAlignment =
      this._registrationAnchor !== null && isApproximate;
    this._approximateAlignmentRotation = null;
    this._approximateAlignmentTranslation = null;
  }

  /**
   * Update alignment flags from a bridge_status message.
   * Returns true when the anchor pose should be cleared (exact registration received).
   */
  public onBridgeStatus(
    msg: BridgeStatusMessage,
    inManualPlacement: boolean,
  ): boolean {
    if (
      msg.world_frame_committed &&
      msg.world_frame_approximate &&
      this._registrationAnchor
    ) {
      this._useApproximateAlignment = true;
    }
    if (msg.world_frame_committed && !msg.world_frame_approximate && !inManualPlacement) {
      this._useApproximateAlignment = false;
      return true;
    }
    return false;
  }

  /** Reset alignment transform and prefer-anchor flag on disconnection. */
  public onDisconnected(): void {
    this._preferRegistrationAnchorUntilNextRuntimePose =
      this._registrationAnchor !== null;
    this._approximateAlignmentRotation = null;
    this._approximateAlignmentTranslation = null;
  }

  /** Clear all anchor and alignment state. */
  public reset(): void {
    this._registrationAnchor = null;
    this._preferRegistrationAnchorUntilNextRuntimePose = false;
    this._useApproximateAlignment = false;
    this._approximateAlignmentRotation = null;
    this._approximateAlignmentTranslation = null;
  }

  public resolveRobotMarkerPose(
    bridgePose: PoseMessage | null,
    interactionMode: RobotInteractionMode,
  ): RobotMarkerPose {
    if (
      this._registrationAnchor &&
      (interactionMode === "manual_placement" ||
        (this._preferRegistrationAnchorUntilNextRuntimePose && !bridgePose))
    ) {
      return {
        source: "manual_anchor",
        position: this._registrationAnchor.position,
        rotation: this._registrationAnchor.rotation,
      };
    }

    if (bridgePose && interactionMode !== "manual_placement") {
      const shouldApplyAlignment =
        this._registrationAnchor !== null && this._useApproximateAlignment;

      if (!shouldApplyAlignment) {
        this._preferRegistrationAnchorUntilNextRuntimePose = false;
        return { source: "world_frame_pose" };
      }

      const q = bridgePose.orientation;
      const bridgePosition = protocolMetersToLensCentimeters(bridgePose.position);
      const bridgeRotation = new quat(q[3], q[0], q[1], q[2]);

      if (
        this._approximateAlignmentRotation === null ||
        this._approximateAlignmentTranslation === null
      ) {
        const anchorPosition = this._registrationAnchor!.position;
        const anchorRotation = this._registrationAnchor!.rotation;
        this._approximateAlignmentRotation = anchorRotation.multiply(
          bridgeRotation.invert(),
        );
        const rotatedBridgePos =
          this._approximateAlignmentRotation.multiplyVec3(bridgePosition);
        this._approximateAlignmentTranslation =
          anchorPosition.sub(rotatedBridgePos);
      }

      const alignedRotation =
        this._approximateAlignmentRotation.multiply(bridgeRotation);
      const alignedPosition = this._approximateAlignmentRotation
        .multiplyVec3(bridgePosition)
        .add(this._approximateAlignmentTranslation);
      this._preferRegistrationAnchorUntilNextRuntimePose = false;
      return {
        source: "approximate_pose",
        position: alignedPosition,
        rotation: alignedRotation,
      };
    }

    if (this._registrationAnchor) {
      return {
        source: "manual_anchor",
        position: this._registrationAnchor.position,
        rotation: this._registrationAnchor.rotation,
      };
    }

    return { source: "none" };
  }
}
