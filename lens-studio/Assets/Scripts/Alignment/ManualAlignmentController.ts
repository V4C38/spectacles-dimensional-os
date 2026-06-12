import { BridgeClient } from "../Network/BridgeClient";
import { RobotMarker } from "../Visuals/RobotMarker";
import { cloneQuat, cloneVec3 } from "../Shared/MathUtils";

// ================================================================
/** Drives manual robot-marker placement and sends manual alignment poses over the bridge. */
// ================================================================

const MANUAL_MARKER_DOWN_CM = 35.0;
const MANUAL_ALIGN_LOG_INTERVAL_S = 2.0;

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
    rotation: cloneQuat(rotation),
  };
}

export function manualMarkerPoseFromMarkerWorldPose(
  position: vec3,
  rotation: quat,
): ManualAlignmentPose {
  return {
    position: cloneVec3(position),
    rotation: cloneQuat(rotation),
  };
}

export class ManualAlignmentController {
  private _lastCaptureLogTime = -1;
  private _lastSubmitLogTime = -1;

  constructor(
    private readonly _bridgeClient: BridgeClient | null,
    private readonly _robotMarker: RobotMarker | null,
  ) {}

  public placeRobotMarkerPose(pose: ManualAlignmentPose): void {
    if (!this._robotMarker) {
      return;
    }
    this._robotMarker.applyManualPose(pose.position, pose.rotation);
  }

  public beginPlacementPose(pose: ManualAlignmentPose): void {
    this.placeRobotMarkerPose(pose);
  }

  public cancelPlacement(): void {}

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
    const sent =
      this._bridgeClient?.sendAlignManualPose(
        position,
        rotation,
      ) ?? false;
    if (!sent) {
      this._logThrottled(
        "submit",
        "ManualAlignmentController: align_manual_pose send failed (no robot id or socket closed)",
      );
    }
    return sent;
  }

  public stopSession(hasBridgeConnection: boolean): void {
    if (hasBridgeConnection) {
      this._bridgeClient?.sendAlignStop();
    }
  }

  public captureCandidate(): { position: vec3; rotation: quat } | null {
    const position = this._robotMarker?.getWorldPosition() ?? null;
    const rotation = this._robotMarker?.getRotation() ?? null;
    if (!position || !rotation) {
      const missing = !position ? "position" : "rotation";
      this._logThrottled(
        "capture",
        `ManualAlignmentController: marker ${missing} unavailable`,
      );
      return null;
    }
    return {
      position: cloneVec3(position),
      rotation: cloneQuat(rotation),
    };
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
