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

const PREVIEW_INTERVAL_S = 0.25;
const PREVIEW_TAIL_BLEND_POINTS = 3;
const PREVIEW_DIRTY_DISTANCE_CM = 5.0;
const PREVIEW_STALE_TARGET_DISTANCE_CM = 12.0;
const NAV_STATUS_STALE_TIMEOUT_S = 8.0;
const NAV_STATUS_RESYNC_COOLDOWN_S = 2.0;
const NAV_STATUS_LOCAL_RECOVERY_S = 16.0;

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
  private _navGoalActive = false;
  private _cancelGoalAvailable = true;
  private _previewTarget: { position: vec3; rotation: quat } | null = null;
  private _previewBasePath: vec3[] | null = null;
  private _lastPreviewSamplePosition: vec3 | null = null;
  private _previewDirty = false;
  private _lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  private _lastNavStatusTime = -NAV_STATUS_STALE_TIMEOUT_S;
  private _lastNavStatusResyncTime = -NAV_STATUS_RESYNC_COOLDOWN_S;
  private _navExecutingSince = -NAV_STATUS_STALE_TIMEOUT_S;
  /** Bridge broadcasts idle until the first executing path; ignore idle reconcile meanwhile. */
  private _awaitingPathHandoff = false;

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
        placementActive,
        force,
      ) => {
        this._handlePreviewTargetChanged(
          position,
          rotation,
          placementActive,
          force,
        );
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
      this._options.onNavigationModeChanged("placingGoal");
      return;
    }

    if (!this._placementEnabled) {
      return;
    }
    print("NavigationController: placement disabled");
    this._clearPathHandoff();
    this._navGoalActive = false;
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
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._options.placementController?.stop();
    this._resetPreviewState();
    this._options.pathRenderer?.clear();
    this._options.onNavigationModeChanged("idle");
  }

  public requestEmergencyStop(): void {
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._options.bridgeClient?.sendEmergencyStop();
    this._returnToPlacingFromExecuting();
  }

  public requestCancelGoal(): void {
    if (!this._cancelGoalAvailable) {
      return;
    }
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._options.bridgeClient?.sendCancelGoal();
    this._returnToPlacingFromExecuting();
  }

  public applyPath(msg: PathMessage): void {
    if (this._navGoalActive && msg.waypoints.length >= 2) {
      this._clearPathHandoff();
      this._assertExecutingVisuals();
    }
    this._options.pathRenderer?.setProtocolPath(msg.waypoints, "executing");
  }

  public applyPathPreview(msg: PathPreviewMessage): void {
    if (
      !this._placementEnabled ||
      !this._previewTarget ||
      !(this._options.placementController?.isPlacementActive() ?? false)
    ) {
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
    this._lastNavStatusTime = getTime();

    if (this.reconcileResyncedNavStatus(msg)) {
      return "Recovered";
    }

    if (msg.recovering) {
      this._clearPathHandoff();
      this._navGoalActive = false;
      this._options.pathRenderer?.clear();
      if (this._placementEnabled) {
        this._respawnGoalMarkerAtRobot();
        this._options.onNavigationModeChanged("placingGoal");
      } else {
        this._options.onNavigationModeChanged("idle");
      }
      return "Recovering";
    }

    if (msg.goal_reached || msg.goal_failed) {
      if (!this._navGoalActive) {
        return "Idle";
      }
      this._finishActiveNavigationGoal();
      return msg.goal_reached ? "Goal reached" : "Goal failed";
    }

    if (msg.state === "following_path") {
      if (this._placementEnabled && this._navGoalActive) {
        this._enterExecutingFromBridge();
      }
      return "Navigating";
    }
    if (msg.state === "recovery") {
      if (this._placementEnabled && this._navGoalActive) {
        this._enterExecutingFromBridge();
      }
      return "Recovery";
    }
    return "Idle";
  }

  public reconcileResyncedNavStatus(msg: NavStatusMessage): boolean {
    if (!this._navGoalActive) {
      return false;
    }
    if (
      msg.recovering ||
      msg.goal_reached ||
      msg.goal_failed ||
      msg.state === "following_path" ||
      msg.state === "recovery"
    ) {
      return false;
    }
    if (msg.state !== "idle") {
      return false;
    }
    if (this._awaitingPathHandoff) {
      return false;
    }
    print(
      "NavigationController: resynced nav_status is idle while executing; recovering locally",
    );
    this.recoverFromStaleExecution();
    return true;
  }

  public checkNavLifecycleStaleness(
    now: number = getTime(),
  ): "ok" | "request_resync" | "recover_local" {
    if (!this._navGoalActive) {
      return "ok";
    }
    const elapsed = now - this._lastNavStatusTime;
    if (elapsed < NAV_STATUS_STALE_TIMEOUT_S) {
      return "ok";
    }
    if (now - this._lastNavStatusResyncTime >= NAV_STATUS_RESYNC_COOLDOWN_S) {
      this._lastNavStatusResyncTime = now;
      return "request_resync";
    }
    if (now - this._navExecutingSince >= NAV_STATUS_LOCAL_RECOVERY_S) {
      return "recover_local";
    }
    return "ok";
  }

  public recoverFromStaleExecution(): void {
    if (!this._navGoalActive) {
      return;
    }
    print("NavigationController: recovering from stale navigation lifecycle");
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._options.pathRenderer?.clear();
    this._returnToPlacingFromExecuting();
  }

  public setGoalConfirmAvailability(available: boolean): void {
    this._options.goalRenderer?.setConfirmAvailability(available);
  }

  private _handleGoalConfirmed(position: vec3, rotation: quat): void {
    if (!this._placementEnabled) {
      return;
    }
    print(
      `NavigationController: goal confirmed at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`,
    );
    this._navGoalActive = true;
    this._markNavExecuting();
    this._resetPreviewState();
    this._assertExecutingVisuals();
    this._options.onNavigationModeChanged("executingGoal");

    if (this._options.canSendNavGoal()) {
      this._awaitingPathHandoff = true;
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
    placementActive: boolean,
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
    this._maybeRequestPreview(force, placementActive);
    this._renderPreviewPath(placementActive);
  }

  private _maybeRequestPreview(force: boolean, placementActive: boolean): void {
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

    if (this._canRequestPreviewPath(placementActive)) {
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

  private _renderPreviewPath(
    placementActive: boolean = this._options.placementController?.isPlacementActive()
      ?? false,
  ): void {
    if (!this._placementEnabled || !placementActive) {
      this._options.pathRenderer?.clear();
      return;
    }
    const robotPosition = this._options.getRobotFloorPosition?.() ?? null;
    const goalPosition = this._options.placementController?.getRenderedPosition()
      ?? this._previewTarget?.position
      ?? null;
    if (!robotPosition || !goalPosition) {
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
    const placementActive =
      this._options.placementController?.isPlacementActive() ?? false;
    if (!pose) {
      this._renderPreviewPath(placementActive);
      return;
    }
    this._handlePreviewTargetChanged(
      pose.position,
      pose.rotation,
      placementActive,
      true,
    );
  }

  private _markNavExecuting(): void {
    const now = getTime();
    this._navExecutingSince = now;
    this._lastNavStatusTime = now;
  }

  private _clearPathHandoff(): void {
    this._awaitingPathHandoff = false;
  }

  private _assertExecutingVisuals(): void {
    this._options.pathRenderer?.restyle("executing");
    this._options.placementController?.showExecuting();
  }

  private _enterExecutingFromBridge(): void {
    this._clearPathHandoff();
    this._markNavExecuting();
    this._assertExecutingVisuals();
    this._options.onNavigationModeChanged("executingGoal");
  }

  private _returnToPlacingFromExecuting(): void {
    if (this._placementEnabled) {
      this._options.placementController?.resumePlacing();
      this._refreshPreviewNow();
      this._options.onNavigationModeChanged("placingGoal");
      return;
    }
    this._options.onNavigationModeChanged("idle");
  }

  private _canRequestPreviewPath(placementActive: boolean): boolean {
    return (
      placementActive &&
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

    const tailSpan = Math.min(PREVIEW_TAIL_BLEND_POINTS, adjusted.length - 1);
    const anchorIndex = adjusted.length - tailSpan - 1;
    const anchor = adjusted[anchorIndex];
    const bridgeGoal = adjusted[adjusted.length - 1];

    for (let index = 0; index < tailSpan; index++) {
      const t = (index + 1) / tailSpan;
      adjusted[anchorIndex + 1 + index] = this._quadraticBezierPoint(
        anchor,
        bridgeGoal,
        goalPosition,
        t,
      );
    }

    return adjusted;
  }

  private _quadraticBezierPoint(
    p0: vec3,
    p1: vec3,
    p2: vec3,
    t: number,
  ): vec3 {
    const u = 1.0 - t;
    return new vec3(
      u * u * p0.x + 2.0 * u * t * p1.x + t * t * p2.x,
      u * u * p0.y + 2.0 * u * t * p1.y + t * t * p2.y,
      u * u * p0.z + 2.0 * u * t * p1.z + t * t * p2.z,
    );
  }

  private _resetPreviewState(): void {
    this._previewTarget = null;
    this._previewBasePath = null;
    this._lastPreviewSamplePosition = null;
    this._previewDirty = false;
    this._lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  }

  private _finishActiveNavigationGoal(): void {
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._resetPreviewState();
    this._options.pathRenderer?.clear();
    if (this._placementEnabled) {
      this._respawnGoalMarkerAtRobot();
      this._options.onNavigationModeChanged("placingGoal");
      return;
    }
    this._options.onNavigationModeChanged("idle");
  }

  /** Hide executing marker, then respawn at robot floor pose (same pose source as placement enable). */
  private _respawnGoalMarkerAtRobot(): void {
    const getPose = this._options.getGoalResetPose;
    if (getPose) {
      this._options.placementController?.respawnPlacingAt(getPose);
      return;
    }
    this._options.placementController?.resumePlacing();
  }
}
