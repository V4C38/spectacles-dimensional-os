import { BridgeClient } from "../Network/BridgeClient";
import { NavigationMode } from "../AppState";
import {
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  protocolMetersToLensCentimeters,
} from "../Network/Protocol";
import { PathRenderer } from "../Visuals/PathRenderer";
import { NavigationMarkerView } from "./NavigationMarkerView";
import { PlacementController } from "./PlacementController";

// ================================================================
/** State machine for goal placement, nav-goal submission, path display, and nav-status handling. */
// ================================================================

const PREVIEW_INTERVAL_S = 0.5;
const PREVIEW_DIRTY_DISTANCE_CM = 5.0;
const PREVIEW_STALE_TARGET_DISTANCE_CM = 12.0;

export interface NavigationControllerOptions {
  bridgeClient: BridgeClient | null;
  goalRenderer: NavigationMarkerView | null;
  pathRenderer: PathRenderer | null;
  placementController: PlacementController | null;
  onNavigationModeChanged: (mode: NavigationMode) => void;
  canStartPlacement: () => boolean;
  canSendNavGoal: () => boolean;
  getRobotFloorPosition?: () => vec3 | null;
  getGoalResetPose?: () => { position: vec3; rotation: quat } | null;
}

export class NavigationController {
  private _placementEnabled = false;
  private _cancelGoalAvailable = true;
  private _previewTarget: { position: vec3; rotation: quat } | null = null;
  private _previewBasePath: vec3[] | null = null;
  private _lastPreviewSamplePosition: vec3 | null = null;
  private _previewDirty = false;
  private _lastPreviewRequestTime = -PREVIEW_INTERVAL_S;

  constructor(private readonly _options: NavigationControllerOptions) {
    if (this._options.placementController) {
      this._options.placementController.onConfirmed = (position, rotation) => {
        this._handleGoalConfirmed(position, rotation);
      };
      this._options.placementController.onCancelled = () => {
        this._handleGoalCancelled();
      };
      this._options.placementController.onPreviewTargetChanged = (
        position,
        rotation,
        isDragging,
        force,
      ) => {
        this._handlePreviewTargetChanged(position, rotation, isDragging, force);
      };
    }
  }

  public setPlacementEnabled(
    enabled: boolean,
    initialPose: { position: vec3; rotation: quat } | null = null,
  ): void {
    if (enabled) {
      if (this._placementEnabled) {
        print("NavigationController: placement already enabled");
        return;
      }
      if (!this._options.canStartPlacement()) {
        print("NavigationController: cannot start placement (precondition failed)");
        return;
      }
      if (!initialPose) {
        print("NavigationController: cannot start placement (no initial pose)");
        return;
      }
      print("NavigationController: placement enabled");
      this._placementEnabled = true;
      this._resetPreviewState();
      this._options.pathRenderer?.clear();
      this._options.placementController?.start(
        initialPose.position,
        initialPose.rotation,
      );
      this._handlePreviewTargetChanged(
        initialPose.position,
        initialPose.rotation,
        false,
        true,
      );
      this._options.onNavigationModeChanged("placingGoal");
      return;
    }

    if (!this._placementEnabled) {
      return;
    }
    print("NavigationController: placement disabled");
    this._options.placementController?.stop();
    this._resetPreviewState();
    this._options.pathRenderer?.clear();
    this._placementEnabled = false;
    this._options.onNavigationModeChanged("idle");
  }

  public get placementEnabled(): boolean {
    return this._placementEnabled;
  }

  public clearInactiveState(): void {
    this._placementEnabled = false;
    this._options.placementController?.stop();
    this._resetPreviewState();
    this._options.pathRenderer?.clear();
    this._options.onNavigationModeChanged("idle");
  }

  public requestEmergencyStop(): void {
    this._options.bridgeClient?.sendEmergencyStop();
    if (this._placementEnabled) {
      this._options.placementController?.showPlacing();
      this._refreshPreviewNow();
      this._options.onNavigationModeChanged("placingGoal");
    } else {
      this._options.onNavigationModeChanged("idle");
    }
  }

  public requestCancelGoal(): void {
    if (!this._cancelGoalAvailable) {
      return;
    }
    this._options.bridgeClient?.sendCancelGoal();
    if (this._placementEnabled) {
      this._options.placementController?.showPlacing();
      this._refreshPreviewNow();
      this._options.onNavigationModeChanged("placingGoal");
    } else {
      this._options.onNavigationModeChanged("idle");
    }
  }

  public applyPath(msg: PathMessage): void {
    this._options.pathRenderer?.setProtocolPath(msg.waypoints, "executing");
  }

  public applyPathPreview(msg: PathPreviewMessage): void {
    if (!this._placementEnabled || !this._previewTarget) {
      return;
    }
    if (!this._previewTargetMatches(msg.target)) {
      return;
    }
    if (msg.waypoints.length >= 2) {
      this._previewBasePath = msg.waypoints.map((point) =>
        protocolMetersToLensCentimeters(point)
      );
      this._renderPreviewPath();
      return;
    }
    this._previewBasePath = null;
    this._renderPreviewPath();
  }

  public setCancelGoalAvailability(
    available: boolean,
    _reason: string | null = null,
  ): void {
    this._cancelGoalAvailable = available;
    this._options.goalRenderer?.setCancelActionAvailability(available);
  }

  public applyNavStatus(msg: NavStatusMessage): string {
    if (msg.goal_reached) {
      this._resetPreviewState();
      this._options.pathRenderer?.clear();
      if (this._placementEnabled) {
        const newPose = this._options.getGoalResetPose?.() ?? null;
        if (newPose) {
          this._options.placementController?.showPlacingAtNewPose(
            newPose.position,
            newPose.rotation,
          );
          this._handlePreviewTargetChanged(
            newPose.position,
            newPose.rotation,
            false,
            true,
          );
        } else {
          this._options.placementController?.showPlacing();
        }
        this._options.onNavigationModeChanged("placingGoal");
      } else {
        this._options.onNavigationModeChanged("idle");
      }
      return "Goal reached";
    }

    if (msg.state === "following_path") {
      if (this._placementEnabled) {
        this._options.onNavigationModeChanged("executingGoal");
      }
      return "Navigating";
    }
    if (msg.state === "recovery") {
      if (this._placementEnabled) {
        this._options.onNavigationModeChanged("executingGoal");
      }
      return "Recovery";
    }
    return "Idle";
  }

  private _handleGoalConfirmed(position: vec3, rotation: quat): void {
    print(
      `NavigationController: goal confirmed at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`,
    );
    this._resetPreviewState();
    this._options.pathRenderer?.restyle("executing");
    this._options.placementController?.showExecuting();
    this._options.onNavigationModeChanged("executingGoal");

    if (this._options.canSendNavGoal()) {
      this._options.bridgeClient?.sendNavGoal(position, rotation);
      return;
    }

    print(
      "NavigationController: executing locally without sending nav_goal",
    );
  }

  private _handleGoalCancelled(): void {
    print("NavigationController: goal cancelled");
    this.requestCancelGoal();
  }

  private _handlePreviewTargetChanged(
    position: vec3,
    rotation: quat,
    _isDragging: boolean,
    force: boolean,
  ): void {
    if (!this._placementEnabled) {
      return;
    }
    this._previewTarget = {
      position: new vec3(position.x, position.y, position.z),
      rotation,
    };
    if (
      force ||
      !this._lastPreviewSamplePosition ||
      this._lastPreviewSamplePosition.distance(position) >= PREVIEW_DIRTY_DISTANCE_CM
    ) {
      this._previewDirty = true;
      this._lastPreviewSamplePosition = new vec3(position.x, position.y, position.z);
    }
    this._maybeRequestPreview(force);
    this._renderPreviewPath();
  }

  private _maybeRequestPreview(force: boolean): void {
    if (!this._previewTarget) {
      return;
    }
    const now = getTime();
    if (!force && !this._previewDirty) {
      return;
    }
    if (!force && now - this._lastPreviewRequestTime < PREVIEW_INTERVAL_S) {
      return;
    }

    this._previewDirty = false;
    this._lastPreviewRequestTime = now;

    if (this._canRequestPreviewPath()) {
      const sent = this._options.bridgeClient?.sendPlanPath(
        this._previewTarget.position,
        this._previewTarget.rotation,
      ) ?? false;
      if (sent) {
        return;
      }
    }
    this._previewBasePath = null;
  }

  private _renderPreviewPath(): void {
    const robotPosition = this._options.getRobotFloorPosition?.() ?? null;
    const goalPosition = this._options.placementController?.getRenderedPosition()
      ?? this._previewTarget?.position
      ?? null;
    if (!robotPosition || !goalPosition || !this._placementEnabled) {
      this._options.pathRenderer?.clear();
      return;
    }
    this._options.pathRenderer?.setHeightRange(robotPosition.y, goalPosition.y);
    if (!this._previewBasePath || this._previewBasePath.length < 2) {
      this._options.pathRenderer?.setLensPath(
        [robotPosition, goalPosition],
        "preview",
      );
      return;
    }
    this._options.pathRenderer?.setLensPath(
      this._tailAdjustedPreviewPath(this._previewBasePath, goalPosition),
      "preview",
    );
  }

  private _refreshPreviewNow(): void {
    const pose = this._options.placementController?.getCurrentPose() ?? null;
    if (!pose) {
      this._renderPreviewPath();
      return;
    }
    this._handlePreviewTargetChanged(pose.position, pose.rotation, false, true);
  }

  private _canRequestPreviewPath(): boolean {
    return (
      this._options.canSendNavGoal() &&
      (this._options.bridgeClient?.isCapabilityAvailable("plan_preview") ?? false)
    );
  }

  private _previewTargetMatches(targetMeters: [number, number, number]): boolean {
    if (!this._previewTarget) {
      return false;
    }
    return this._previewTarget.position.distance(
      protocolMetersToLensCentimeters(targetMeters),
    ) <= PREVIEW_STALE_TARGET_DISTANCE_CM;
  }

  private _tailAdjustedPreviewPath(points: vec3[], goalPosition: vec3): vec3[] {
    const adjusted = points.map((point) => new vec3(point.x, point.y, point.z));
    if (adjusted.length < 2) {
      return adjusted;
    }

    const tailCount = Math.max(1, Math.min(3, Math.floor(adjusted.length / 4)));
    const tailStart = Math.max(0, adjusted.length - tailCount);
    const lastPoint = adjusted[adjusted.length - 1];
    const delta = new vec3(
      goalPosition.x - lastPoint.x,
      goalPosition.y - lastPoint.y,
      goalPosition.z - lastPoint.z,
    );

    for (let index = tailStart; index < adjusted.length; index++) {
      const tailProgress = tailCount === 1
        ? 1
        : (index - tailStart) / (tailCount - 1);
      const weight =
        tailProgress * tailProgress * (3.0 - 2.0 * tailProgress);
      const point = adjusted[index];
      adjusted[index] = new vec3(
        point.x + delta.x * weight,
        point.y + delta.y * weight,
        point.z + delta.z * weight,
      );
    }

    adjusted[adjusted.length - 1] = new vec3(
      goalPosition.x,
      goalPosition.y,
      goalPosition.z,
    );
    return adjusted;
  }

  private _resetPreviewState(): void {
    this._previewTarget = null;
    this._previewBasePath = null;
    this._lastPreviewSamplePosition = null;
    this._previewDirty = false;
    this._lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  }
}
