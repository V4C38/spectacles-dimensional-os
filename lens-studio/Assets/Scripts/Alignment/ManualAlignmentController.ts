import { BridgeClient } from "../Network/BridgeClient";
import { RobotMarker } from "../Visuals/RobotMarker";

// ================================================================
/** Drives manual robot-marker placement and sends manual alignment poses over the bridge. */
// ================================================================

const MANUAL_MARKER_DOWN_CM = 35.0;

export interface ManualAlignmentPose {
  position: vec3;
  rotation: quat;
}

export function manualMarkerPoseFromReference(
  position: vec3,
  rotation: quat,
): ManualAlignmentPose {
  return {
    position: new vec3(position.x, position.y - MANUAL_MARKER_DOWN_CM, position.z),
    // Pass the raw rotation; the bridge owns flattening when the pose is submitted.
    // quat constructor is (w, x, y, z)
    rotation: new quat(rotation.w, rotation.x, rotation.y, rotation.z),
  };
}

export function manualMarkerPoseFromMarkerWorldPose(
  position: vec3,
  rotation: quat,
): ManualAlignmentPose {
  return {
    position: new vec3(position.x, position.y, position.z),
    // quat constructor is (w, x, y, z)
    rotation: new quat(rotation.w, rotation.x, rotation.y, rotation.z),
  };
}

export class ManualAlignmentController {
  private _manualPlacementMode = false;

  constructor(
    private readonly _bridgeClient: BridgeClient | null,
    private readonly _robotMarker: RobotMarker | null,
  ) {}

  public get isManualPlacementMode(): boolean {
    return this._manualPlacementMode;
  }

  public placeRobotMarkerInFrontOf(reference: SceneObject): void {
    if (!reference) {
      return;
    }
    const transform = reference.getTransform();
    this.placeRobotMarkerPose(
      manualMarkerPoseFromReference(
        transform.getWorldPosition(),
        transform.getWorldRotation(),
      ),
    );
  }

  public beginPlacement(reference: SceneObject): void {
    if (!reference) {
      return;
    }
    const transform = reference.getTransform();
    this.beginPlacementPose(
      manualMarkerPoseFromReference(
        transform.getWorldPosition(),
        transform.getWorldRotation(),
      ),
    );
  }

  public placeRobotMarkerPose(pose: ManualAlignmentPose): void {
    if (!this._robotMarker) {
      return;
    }
    this._robotMarker.applyManualPose(pose.position, pose.rotation);
  }

  public beginPlacementPose(pose: ManualAlignmentPose): void {
    this._manualPlacementMode = true;
    this.placeRobotMarkerPose(pose);
  }

  public cancelPlacement(): void {
    this._manualPlacementMode = false;
  }

  public startSession(hasBridgeConnection: boolean): boolean {
    if (!hasBridgeConnection) {
      return true;
    }
    return this._bridgeClient?.sendAlignStart() ?? false;
  }

  public submitCandidate(
    position: vec3,
    rotation: quat,
    hasBridgeConnection: boolean,
  ): boolean {
    if (!hasBridgeConnection) {
      return true;
    }
    return (
      this._bridgeClient?.sendAlignManualPose(
        position,
        rotation,
      ) ?? false
    );
  }

  public stopSession(hasBridgeConnection: boolean): void {
    if (hasBridgeConnection) {
      this._bridgeClient?.sendAlignStop();
    }
  }

  public captureCandidate(): { position: vec3; rotation: quat } | null {
    const position = this._robotMarker?.getWorldPosition() ?? null;
    const rotation = this._robotMarker?.getWorldRotation() ?? null;
    if (!position || !rotation) {
      return null;
    }
    return {
      position: new vec3(position.x, position.y, position.z),
      // quat constructor is (w, x, y, z)
      rotation: new quat(rotation.w, rotation.x, rotation.y, rotation.z),
    };
  }
}
