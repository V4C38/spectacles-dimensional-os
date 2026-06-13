// ================================================================
/**
 * Single owner of the navigation subsystem: goal placement, path
 * display, nav-status state machine, lifecycle watchdog, outcome
 * flash, and placement gating.
 *
 * Merged from NavigationCoordinator + NavigationController +
 * NavigationOutcomeTracker (P2). Constructor takes concrete refs —
 * no deps-lambda bundle; capability reads go through AppState.
 */
// ================================================================

import {
  AppState,
  NavigationMode,
  NavigationOutcome,
  RobotRuntimeState,
  robotFloorWorldYCm,
} from "../Core/AppState";
import { BridgeClient } from "../Bridge/BridgeClient";
import { RobotMarker } from "../Robot/RobotMarker";
import {
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  ProtocolParseError,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../Bridge/Protocol";
import {
  isCapabilityAvailable,
  capabilityUnavailableReason,
  runtimeDeadzoneRadiusCm,
} from "../Core/RobotRuntime";
import { NavigationMarkerView } from "./NavigationMarkerView";
import { PathRenderer } from "./PathRenderer";
import { PlacementController, RobotGroundDeadzone } from "./PlacementController";

const PREVIEW_INTERVAL_S = 0.25;
const PREVIEW_TAIL_BLEND_POINTS = 3;
const PREVIEW_DIRTY_DISTANCE_CM = 5.0;
const PREVIEW_STALE_TARGET_DISTANCE_CM = 12.0;
const NAV_STATUS_STALE_TIMEOUT_S = 8.0;
const NAV_STATUS_RESYNC_COOLDOWN_S = 2.0;
const NAV_STATUS_LOCAL_RECOVERY_S = 16.0;
const NAVIGATION_OUTCOME_FLASH_S = 1.5;

export class NavigationController {
  // ── Placement / goal state ─────────────────────────────────────
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

  // ── Watchdog / gating state ────────────────────────────────────
  private _navWatchdogEvent: SceneEvent | null = null;
  private _protocolParseFailureCount = 0;

  // ── Outcome-flash state (was NavigationOutcomeTracker) ─────────
  private _outcomeSeq = 0;
  private _outcomeDueSeq = 0;
  private _outcomeEvent: DelayedCallbackEvent | null = null;

  constructor(
    private readonly _script: BaseScriptComponent,
    private readonly _bridgeClient: BridgeClient | null,
    private readonly _appState: AppState,
    private readonly _robotMarker: RobotMarker | null,
    private readonly _goalRenderer: NavigationMarkerView,
    private readonly _pathRenderer: PathRenderer,
    private readonly _placement: PlacementController,
    private readonly _robotGroundDeadzoneRadiusCm: number,
    private readonly _getLastPose: () => PoseMessage | null,
    private readonly _onRuntimeStateChanged: (state: RobotRuntimeState) => void,
  ) {
    this._placement.onConfirmed = (position, rotation) =>
      this._handleGoalConfirmed(position, rotation);
    this._placement.onCancelled = () => this._handleGoalCancelled();
    this._placement.onPreviewTargetChanged = (pos, rot, active, force) =>
      this._handlePreviewTargetChanged(pos, rot, active, force);

    this._placement.setRobotGroundDeadzone({
      radiusCm: _robotGroundDeadzoneRadiusCm,
      getRobotWorldPosition: () => this._robotMarker?.getWorldPosition() ?? null,
      getRobotFloorWorldY: () => this._robotFloorY(),
    } as RobotGroundDeadzone);
  }

  // ── Bridge event handlers ──────────────────────────────────────

  public startWatchdog(): void {
    if (this._navWatchdogEvent) {
      return;
    }
    const event = this._script.createEvent("UpdateEvent");
    event.bind(() => this._tickNavLifecycleWatchdog());
    this._navWatchdogEvent = event;
  }

  public applyPath(msg: PathMessage): void {
    const robotY = this._robotFloorY();
    const goalY = this._goalRenderer?.worldPosition.y ?? null;
    if (robotY !== null && goalY !== null) {
      this._pathRenderer?.setHeightRange(robotY, goalY);
    }
    if (this._navGoalActive && msg.waypoints.length >= 2) {
      this._clearPathHandoff();
      this._assertExecutingVisuals();
    }
    this._pathRenderer?.setProtocolPath(msg.waypoints, "executing");
  }

  public applyPathPreview(msg: PathPreviewMessage): void {
    if (
      !this._placementEnabled ||
      !this._previewTarget ||
      !(this._placement?.isPlacementActive() ?? false)
    ) {
      return;
    }
    if (!this._previewTargetMatches(msg.target)) {
      return;
    }
    if (msg.waypoints.length >= 2) {
      this._previewBasePath = msg.waypoints.map((point) =>
        protocolMetersToLensCentimeters(point),
      );
      this._renderPreviewPath();
      return;
    }
    this._previewBasePath = null;
    this._renderPreviewPath();
  }

  public applyNavStatus(msg: NavStatusMessage): void {
    this._protocolParseFailureCount = 0;
    const navLabel = this._applyNavStatusInner(msg);

    if (msg.recovering) {
      this._cancelOutcome();
      return;
    }
    if (navLabel === "Goal reached") {
      this._setOutcome("success");
      return;
    }
    if (navLabel === "Goal failed") {
      if (msg.error_code !== undefined) {
        this._disableNavRuntime(msg.error_code);
        return;
      }
      this._setOutcome("failed");
    }
  }

  public handleProtocolError(error: ProtocolParseError): void {
    this._protocolParseFailureCount += 1;
    if (this._protocolParseFailureCount < 3) {
      return;
    }
    if (this._appState.snapshot.navigationMode !== "executingGoal") {
      return;
    }
    this._log(
      `protocol ${error.kind} failures while navigating (${this._protocolParseFailureCount}); awaiting resync`,
    );
  }

  // ── Lifecycle / state coordination ────────────────────────────

  public cancelOutcome(): void {
    this._cancelOutcome();
  }

  public clearForDisconnect(): void {
    this.clearInactiveState();
    this._protocolParseFailureCount = 0;
    this._cancelOutcome();
  }

  public resetForUserDisconnect(): void {
    this._clearOutcome();
    this._setNavigationMode("idle");
    this.clearInactiveState();
  }

  public syncPlacementState(): void {
    this._syncNavigationPlacementState();
  }

  public onPlacementEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      const appState = this._appState.snapshot;
      const stopActiveNavigation =
        appState.operatingMode === "manual" &&
        appState.navigationMode === "executingGoal";
      if (stopActiveNavigation) {
        if (isCapabilityAvailable(appState.robotRuntime, "emergency_stop")) {
          this._log(
            "setNavigationPlacementEnabled: stopping active navigation via emergency stop",
          );
          this.requestEmergencyStop();
        } else if (isCapabilityAvailable(appState.robotRuntime, "cancel_goal")) {
          this._log(
            "setNavigationPlacementEnabled: stopping active navigation via cancel goal",
          );
          this.requestCancelGoal();
        }
      }
      this.setPlacementEnabled(false);
      this._setNavigationMode("idle");
      return;
    }
    this._syncNavigationPlacementState();
  }

  public applyRuntimeState(state: RobotRuntimeState): void {
    if (
      !state.capabilities.nav?.available &&
      this._appState.snapshot.navigationPlacementEnabled
    ) {
      this._appState.update({ navigationPlacementEnabled: false });
    }
    this._placement?.setRobotGroundDeadzone({
      radiusCm: runtimeDeadzoneRadiusCm(state, this._robotGroundDeadzoneRadiusCm),
      getRobotWorldPosition: () => this._robotMarker?.getWorldPosition() ?? null,
      getRobotFloorWorldY: () => this._robotFloorY(),
    } as RobotGroundDeadzone);
    this.setCancelGoalAvailability(
      isCapabilityAvailable(state, "cancel_goal"),
      capabilityUnavailableReason(state, "cancel_goal"),
    );
    this.setGoalConfirmAvailability(this._canConfirmNavigationGoal());
    this._syncNavigationPlacementState();
  }

  public requestEmergencyStop(): void {
    if (!isCapabilityAvailable(this._appState.snapshot.robotRuntime, "emergency_stop")) {
      return;
    }
    this._log("requestEmergencyStop");
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._bridgeClient?.sendEmergencyStop();
    this._returnToPlacingFromExecuting();
  }

  public setNavigationMode(mode: NavigationMode): void {
    this._setNavigationMode(mode);
  }

  public canStartPlacement(): boolean {
    return this._canStartNavigationPlacement();
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
      if (!this._canStartNavigationPlacement()) {
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
      this._pathRenderer?.clear();
      this._placement?.start(initialPose.position, initialPose.rotation);
      this._setNavigationMode("placingGoal");
      return;
    }

    if (!this._placementEnabled) {
      return;
    }
    print("NavigationController: placement disabled");
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._placement?.stop();
    this._resetPreviewState();
    this._pathRenderer?.clear();
    this._placementEnabled = false;
    this._setNavigationMode("idle");
  }

  public get placementEnabled(): boolean {
    return this._placementEnabled;
  }

  public clearInactiveState(): void {
    this._placementEnabled = false;
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._placement?.stop();
    this._resetPreviewState();
    this._pathRenderer?.clear();
    this._setNavigationMode("idle");
  }

  public requestCancelGoal(): void {
    if (!this._cancelGoalAvailable) {
      return;
    }
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._bridgeClient?.sendCancelGoal();
    this._returnToPlacingFromExecuting();
  }

  public setCancelGoalAvailability(
    available: boolean,
    _reason: string | null = null,
  ): void {
    this._cancelGoalAvailable = available;
    this._goalRenderer?.setCancelActionAvailability(available);
  }

  public setGoalConfirmAvailability(available: boolean): void {
    this._goalRenderer?.setConfirmAvailability(available);
  }

  // ── Private: nav-status state machine ─────────────────────────

  private _applyNavStatusInner(msg: NavStatusMessage): string {
    this._lastNavStatusTime = getTime();

    if (this._reconcileResyncedNavStatus(msg)) {
      return "Recovered";
    }

    if (msg.recovering) {
      this._clearPathHandoff();
      this._navGoalActive = false;
      this._pathRenderer?.clear();
      if (this._placementEnabled) {
        this._respawnGoalMarkerAtRobot();
        this._setNavigationMode("placingGoal");
      } else {
        this._setNavigationMode("idle");
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

  private _reconcileResyncedNavStatus(msg: NavStatusMessage): boolean {
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
    this._recoverFromStaleExecution();
    return true;
  }

  private _recoverFromStaleExecution(): void {
    if (!this._navGoalActive) {
      return;
    }
    print("NavigationController: recovering from stale navigation lifecycle");
    this._clearPathHandoff();
    this._navGoalActive = false;
    this._pathRenderer?.clear();
    this._returnToPlacingFromExecuting();
  }

  // ── Private: watchdog ──────────────────────────────────────────

  private _tickNavLifecycleWatchdog(): void {
    if (!this._bridgeClient?.isConnected()) {
      return;
    }
    const action = this._checkNavLifecycleStaleness();
    if (action === "request_resync") {
      this._log("nav lifecycle stale; requesting bridge status resync");
      this._bridgeClient?.requestStatus();
      return;
    }
    if (action === "recover_local") {
      this._log("nav lifecycle stale after resync; recovering locally");
      this._recoverFromStaleExecution();
      this._setOutcome("failed");
    }
  }

  private _checkNavLifecycleStaleness(
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

  // ── Private: outcome flash (was NavigationOutcomeTracker) ──────

  private _setOutcome(outcome: "success" | "failed"): void {
    this._cancelOutcome();
    this._appState.update({ navigationOutcome: outcome });
    this._scheduleOutcomeFlash();
  }

  private _scheduleOutcomeFlash(): void {
    this._outcomeSeq += 1;
    this._outcomeDueSeq = this._outcomeSeq;
    if (!this._outcomeEvent) {
      this._outcomeEvent = this._script.createEvent(
        "DelayedCallbackEvent",
      ) as DelayedCallbackEvent;
      this._outcomeEvent.bind(() => {
        if (this._outcomeSeq !== this._outcomeDueSeq) {
          return;
        }
        this._clearOutcome();
      });
    }
    (this._outcomeEvent as DelayedCallbackEvent).reset(NAVIGATION_OUTCOME_FLASH_S);
  }

  private _cancelOutcome(): void {
    this._outcomeSeq += 1;
  }

  private _clearOutcome(): void {
    this._cancelOutcome();
    if (this._appState.snapshot.navigationOutcome === "none") {
      return;
    }
    this._appState.update({ navigationOutcome: "none" });
  }

  private _scheduleOutcomeFlashAfterUpdate(): void {
    this._cancelOutcome();
    this._scheduleOutcomeFlash();
  }

  // ── Private: gating ────────────────────────────────────────────

  private _disableNavRuntime(errorCode: number): void {
    const appState = this._appState.snapshot;
    const capabilities = {
      ...appState.robotRuntime.capabilities,
      nav: {
        available: false,
        reason: `Bridge Error (${errorCode})`,
      },
    };
    const runtimeState: RobotRuntimeState = {
      ...appState.robotRuntime,
      capabilities,
    };
    this._cancelOutcome();
    this._appState.update({
      navRuntimeErrorCode: errorCode,
      navigationOutcome: "failed",
      robotRuntime: runtimeState,
    } as any);
    this._scheduleOutcomeFlashAfterUpdate();
    this._onRuntimeStateChanged(runtimeState);
  }

  private _canStartNavigationPlacement(): boolean {
    const state = this._appState.snapshot;
    if (state.operatingMode !== "manual") {
      return false;
    }
    if (state.phase !== "runtime") {
      return false;
    }
    if (!isCapabilityAvailable(state.robotRuntime, "nav")) {
      return false;
    }
    return state.robotInteractionMode === "runtimeRobot";
  }

  private _canSendNavigationGoal(): boolean {
    return (
      (this._bridgeClient?.isConnected() ?? false) &&
      isCapabilityAvailable(this._appState.snapshot.robotRuntime, "nav") &&
      (this._bridgeClient?.lastBridgeStatus?.registered ?? false)
    );
  }

  private _canConfirmNavigationGoal(): boolean {
    return (
      isCapabilityAvailable(this._appState.snapshot.robotRuntime, "nav") &&
      (this._appState.snapshot as any).navRuntimeErrorCode === null
    );
  }

  private _setNavigationMode(mode: NavigationMode): void {
    const state = this._appState.snapshot;
    if (mode === "executingGoal") {
      if (
        state.navigationMode === mode &&
        (state as any).navigationOutcome === "none"
      ) {
        return;
      }
      this._cancelOutcome();
      this._appState.update({
        navigationOutcome: "none",
        navigationMode: mode,
      } as any);
      return;
    }
    if (state.navigationMode === mode) {
      return;
    }
    this._appState.update({ navigationMode: mode });
  }

  private _syncNavigationPlacementState(): void {
    const state = this._appState.snapshot;
    if (!state.navigationPlacementEnabled || !this._canStartNavigationPlacement()) {
      this.setPlacementEnabled(false);
      if (state.navigationMode !== "idle") {
        this._setNavigationMode("idle");
      }
      return;
    }
    if (this._placementEnabled) {
      return;
    }
    const initialPose = this._getNavigationPlacementStartPose();
    if (!initialPose) {
      return;
    }
    this.setPlacementEnabled(true, initialPose);
  }

  // ── Private: preview & path ────────────────────────────────────

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
    this._setNavigationMode("executingGoal");

    if (this._canSendNavigationGoal()) {
      this._awaitingPathHandoff = true;
      this._bridgeClient?.sendNavGoal(position, rotation);
      return;
    }
    print("NavigationController: executing locally without sending nav_goal");
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
      const sent =
        this._bridgeClient?.sendPlanPath(
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
    placementActive: boolean = this._placement?.isPlacementActive() ?? false,
  ): void {
    if (!this._placementEnabled || !placementActive) {
      this._pathRenderer?.clear();
      return;
    }
    const robotPosition = this._getRobotFloorPosition() ?? null;
    const goalPosition =
      this._placement?.getRenderedPosition() ??
      this._previewTarget?.position ??
      null;
    if (!robotPosition || !goalPosition) {
      this._pathRenderer?.clear();
      return;
    }
    this._pathRenderer?.setHeightRange(robotPosition.y, goalPosition.y);
    if (!this._previewBasePath || this._previewBasePath.length < 2) {
      this._pathRenderer?.setLensPath([robotPosition, goalPosition], "preview");
      return;
    }
    this._pathRenderer?.setLensPath(
      this._tailAdjustedPreviewPath(this._previewBasePath, goalPosition),
      "preview",
    );
  }

  private _refreshPreviewNow(): void {
    const pose = this._placement?.getCurrentPose() ?? null;
    const placementActive = this._placement?.isPlacementActive() ?? false;
    if (!pose) {
      this._renderPreviewPath(placementActive);
      return;
    }
    this._handlePreviewTargetChanged(pose.position, pose.rotation, placementActive, true);
  }

  private _canRequestPreviewPath(placementActive: boolean): boolean {
    return (
      placementActive &&
      this._canSendNavigationGoal() &&
      isCapabilityAvailable(this._appState.snapshot.robotRuntime, "plan_preview")
    );
  }

  private _previewTargetMatches(targetMeters: [number, number, number]): boolean {
    if (!this._previewTarget) {
      return false;
    }
    return (
      this._previewTarget.position.distance(
        protocolMetersToLensCentimeters(targetMeters),
      ) <= PREVIEW_STALE_TARGET_DISTANCE_CM
    );
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

  private _quadraticBezierPoint(p0: vec3, p1: vec3, p2: vec3, t: number): vec3 {
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
    this._pathRenderer?.clear();
    if (this._placementEnabled) {
      this._respawnGoalMarkerAtRobot();
      this._setNavigationMode("placingGoal");
      return;
    }
    this._setNavigationMode("idle");
  }

  private _respawnGoalMarkerAtRobot(): void {
    const getPose = () => this._getNavigationPlacementStartPose();
    if (getPose) {
      this._placement?.respawnPlacingAt(getPose);
      return;
    }
    this._placement?.resumePlacing();
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
    this._pathRenderer?.restyle("executing");
    this._placement?.showExecuting();
  }

  private _enterExecutingFromBridge(): void {
    this._clearPathHandoff();
    this._markNavExecuting();
    this._assertExecutingVisuals();
    this._setNavigationMode("executingGoal");
  }

  private _returnToPlacingFromExecuting(): void {
    if (this._placementEnabled) {
      this._placement?.resumePlacing();
      this._refreshPreviewNow();
      this._setNavigationMode("placingGoal");
      return;
    }
    this._setNavigationMode("idle");
  }

  // ── Private: pose helpers ──────────────────────────────────────

  private _getNavigationPlacementStartPose(): {
    position: vec3;
    rotation: quat;
  } | null {
    const markerPosition = this._robotMarker?.getWorldPosition() ?? null;
    const markerRotation = this._robotMarker?.getRotation() ?? null;
    if (markerPosition && markerRotation) {
      const floorPosition = this._getRobotFloorPosition(markerPosition);
      if (!floorPosition) {
        return null;
      }
      return { position: floorPosition, rotation: markerRotation };
    }
    const lastPose = this._getLastPose();
    if (!lastPose) {
      return null;
    }
    const q = lastPose.orientation;
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    const position = protocolMetersToLensCentimeters(lastPose.position);
    const floorPosition = this._getRobotFloorPosition(position);
    if (!floorPosition) {
      return null;
    }
    return { position: floorPosition, rotation };
  }

  private _robotFloorY(
    sourceY: number | null = this._robotMarker?.getWorldPosition()?.y ?? null,
  ): number | null {
    if (sourceY === null) {
      return null;
    }
    return robotFloorWorldYCm(sourceY, this._appState.snapshot.robotRuntime);
  }

  private _getRobotFloorPosition(
    position: vec3 | null = this._robotMarker?.getWorldPosition() ?? null,
  ): vec3 | null {
    if (!position) {
      return null;
    }
    const floorY = this._robotFloorY(position.y);
    if (floorY === null) {
      return null;
    }
    return new vec3(position.x, floorY, position.z);
  }

  private _log(message: string): void {
    print(`NavigationController: ${message}`);
  }
}
