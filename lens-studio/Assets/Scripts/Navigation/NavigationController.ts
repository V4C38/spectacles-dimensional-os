// ================================================================
/**
 * Single owner of the navigation subsystem: profile FSM, goal placement,
 * path display, nav-status lifecycle, watchdog, and outcome flash.
 *
 * State layers (keep in sync when changing navigation behavior):
 * - AppState.navigationState — user-visible armed / placing / executing (DimOS)
 * - _lifecycle.phase — bridge path wait: idle | placing | awaitingPath | executing
 * - _markerPhase — profile FSM UX: hidden | idle | preview | navigating | outcomeReset
 * - SurfacePlacementController._state — drag gesture: idleFollowingRobot | dragged | executing
 *
 * Sync invariants:
 * - _syncMarkerPresentation runs on marker phase change and on navEnabled/navDisabled/
 *   profileChanged/outcomeResetComplete; capability-only updates may call it directly.
 * - apply() refreshes button presentation even when profile+phase are unchanged.
 * - applyNavigatingPolicy must not call back into _syncMarkerPresentation (recursion guard).
 */
// ================================================================

import {
  AppState,
  defaultNavigationOutcome,
  NavigationOutcome,
  NavigationState,
  navigationOutcomeHasNavRuntimeError,
  navigationOutcomeIsNone,
  RobotRuntimeState,
  toSessionState,
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
  robotFloorWorldYCm,
  runtimeDeadzoneRadiusCm,
} from "../Robot/RobotRuntimeModel";
import { NavigationMarkerView } from "./NavigationMarkerView";
import { NavigationPathRenderer } from "./NavigationPathRenderer";
import { SurfacePlacementController, RobotGroundDeadzone } from "./SurfacePlacementController";
import {
  deriveNavigationProfile,
  goalCommitAllowed,
  GoalCommitVia,
  navigationGoalPolicy,
  navigationMarkerTransition,
  navigationProfileSpec,
  NavigationMarkerPhase,
  NavigationMarkerProfile,
  NavigationSessionEvent,
  shouldSendGoalOnDragThreshold,
} from "./NavigationProfile";

const PREVIEW_INTERVAL_S = 0.25;
const GOAL_SEND_INTERVAL_S = 0.35;
const GOAL_SEND_MIN_DISTANCE_CM = 20.0;
const GOAL_REACHED_RETARGET_CM = 25.0;
const PREVIEW_STALE_TARGET_DISTANCE_CM = 12.0;
const NAV_STATUS_STALE_TIMEOUT_S = 8.0;
const NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S = 2.0;
const NAV_STATUS_RESYNC_MAX_COOLDOWN_S = 8.0;
const NAV_STATUS_LOCAL_RECOVERY_S = 16.0;
const NAVIGATION_OUTCOME_FLASH_S = 1.5;

type NavigationPhase = "idle" | "placing" | "awaitingPath" | "executing";

interface NavigationLifecycle {
  phase: NavigationPhase;
  goalActive: boolean;
  lastNavStatusTime: number;
  lastNavStatusResyncTime: number;
  navStatusResyncCooldownS: number;
  navExecutingSince: number;
}

type NavVisualResetReason =
  | "disconnect"
  | "cancel"
  | "estop"
  | "stale"
  | "placement_off"
  | "goal_done"
  | "recovering";

export class NavigationController {
  private _placementEnabled = false;
  private _cancelGoalAvailable = true;
  private _profile: NavigationMarkerProfile = "manualSingle";
  private _markerPhase: NavigationMarkerPhase = "hidden";
  private _previewTarget: { position: vec3; rotation: quat } | null = null;
  private _previewBasePath: vec3[] | null = null;
  private _lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  private _lastSentGoal: { position: vec3; rotation: quat } | null = null;
  private _lastGoalSendTime = -GOAL_SEND_INTERVAL_S;
  private _lifecycle: NavigationLifecycle = {
    phase: "idle",
    goalActive: false,
    lastNavStatusTime: -NAV_STATUS_STALE_TIMEOUT_S,
    lastNavStatusResyncTime: -NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
    navStatusResyncCooldownS: NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
    navExecutingSince: -NAV_STATUS_STALE_TIMEOUT_S,
  };

  private _navWatchdogEvent: SceneEvent | null = null;
  private _protocolParseFailureCount = 0;

  private _outcomeFlashSeq = 0;
  private _outcomeFlashDueSeq = 0;
  private _outcomeFlashEvent: DelayedCallbackEvent | null = null;
  private _watchedNavigationOutcome: NavigationOutcome = defaultNavigationOutcome();

  constructor(
    private readonly _script: BaseScriptComponent,
    private readonly _bridgeClient: BridgeClient | null,
    private readonly _appState: AppState,
    private readonly _robotMarker: RobotMarker | null,
    private readonly _goalRenderer: NavigationMarkerView,
    private readonly _pathRenderer: NavigationPathRenderer,
    private readonly _placement: SurfacePlacementController,
    private readonly _robotGroundDeadzoneRadiusCm: number,
    private readonly _getLastPose: () => PoseMessage | null,
    private readonly _onRuntimeStateChanged: (state: RobotRuntimeState) => void,
  ) {
    this._syncProfileFromAppState();
    this._placement.getProfile = () => this._profile;
    this._placement.onSessionEvent = (event) => this._handlePlacementSessionEvent(event);
    this._placement.onPresentationSync = () => this._syncMarkerPresentation();
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

    this._watchedNavigationOutcome = this._appState.snapshot.navigationOutcome;
    this._appState.subscribe((state) => {
      this._handleNavigationOutcomeChanged(state.navigationOutcome);
      this._handleAppStateProfileFields(state.operatingMode, state.navigationGoalMode);
    });
  }

  public onNavigationProfileChanged(): void {
    this._handleAppStateProfileFields(
      this._appState.snapshot.operatingMode,
      this._appState.snapshot.navigationGoalMode,
    );
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
    if (this._lifecycle.goalActive && msg.waypoints.length >= 2) {
      this._lifecycle.phase = "executing";
      this._enterExecutingVisuals();
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
      this._cancelOutcomeFlashTimer();
      return;
    }
    if (navLabel === "Goal reached") {
      if (navigationProfileSpec(this._profile).respawnOnSuccess) {
        this._setOutcome({ kind: "success" });
      }
      return;
    }
    if (navLabel === "Goal failed") {
      if (msg.error_code !== undefined) {
        this._disableNavRuntime(msg.error_code);
        return;
      }
      this._setOutcome({ kind: "failed", errorCode: null });
    }
  }

  public handleProtocolError(error: ProtocolParseError): void {
    this._protocolParseFailureCount += 1;
    if (this._protocolParseFailureCount < 3) {
      return;
    }
    if (this._appState.snapshot.navigationState !== "executingGoal") {
      return;
    }
    this._log(
      `protocol ${error.kind} failures while navigating (${this._protocolParseFailureCount}); awaiting resync`,
    );
  }

  // ── Lifecycle / state coordination ────────────────────────────

  public cancelOutcome(): void {
    this._cancelOutcomeFlashTimer();
  }

  public clearForDisconnect(): void {
    this.clearInactiveState();
    this._protocolParseFailureCount = 0;
    this._cancelOutcomeFlashTimer();
  }

  public resetForUserDisconnect(): void {
    this._clearOutcome();
    this._setNavigationState("off");
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
        appState.navigationState === "executingGoal";
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
      this._setNavigationState("off");
      return;
    }
    this._setNavigationState("armed");
    this._syncNavigationPlacementState();
  }

  public applyRuntimeState(state: RobotRuntimeState): void {
    const appState = this._appState.snapshot;
    if (
      !state.capabilities.nav?.available &&
      (appState.navigationState === "armed" ||
        appState.navigationState === "placingGoal")
    ) {
      this._appState.update({ navigationState: "off" });
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
    this._syncMarkerPresentation();
    this._syncNavigationPlacementState();
  }

  public requestEmergencyStop(): void {
    if (!isCapabilityAvailable(this._appState.snapshot.robotRuntime, "emergency_stop")) {
      return;
    }
    this._log("requestEmergencyStop");
    this._resetNavigationVisuals("estop", { outcomeLabel: "Cancelled" });
    this._bridgeClient?.sendEmergencyStop();
  }

  public setNavigationState(state: NavigationState): void {
    this._setNavigationState(state);
  }

  public beginAgentGoal(): boolean {
    if (!this._canStartAgentNavigation()) {
      return false;
    }
    this._syncProfileFromAppState();
    this._setNavigationState("placingGoal");
    return true;
  }

  public submitAgentGoal(position: vec3, rotation: quat): boolean {
    if (!this._canStartAgentNavigation()) {
      return false;
    }
    this._syncProfileFromAppState();
    this._dispatch({ kind: "agentGoalSubmitted" });
    this._resetPreviewState();
    this._pathRenderer?.clear();
    this._setNavigationState("executingGoal");
    this._commitGoal(position, rotation, { via: "agent", force: true });
    return this._lifecycle.goalActive;
  }

  public canStartPlacement(): boolean {
    return this._canStartManualNavigationPlacement();
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
      if (!this._canStartManualNavigationPlacement()) {
        print("NavigationController: cannot start placement (precondition failed)");
        return;
      }
      if (!initialPose) {
        print("NavigationController: cannot start placement (no initial pose)");
        return;
      }
      print("NavigationController: placement enabled");
      this._syncProfileFromAppState();
      this._placementEnabled = true;
      this._lifecycle.phase = "placing";
      this._resetPreviewState();
      this._pathRenderer?.clear();
      this._placement?.start(initialPose.position, initialPose.rotation);
      this._dispatch({ kind: "navEnabled" });
      this._setNavigationState("placingGoal");
      return;
    }

    if (!this._placementEnabled) {
      return;
    }
    print("NavigationController: placement disabled");
    this._resetNavigationVisuals("placement_off", { stopPlacement: true });
    this._setNavigationState(this._idleNavigationState());
  }

  public get placementEnabled(): boolean {
    return this._placementEnabled;
  }

  public clearInactiveState(): void {
    this._resetNavigationVisuals("disconnect", {
      stopPlacement: true,
      resetResyncCooldown: true,
    });
    this._setNavigationState("off");
  }

  public requestCancelGoal(): void {
    if (!this._cancelGoalAvailable) {
      return;
    }
    this._resetNavigationVisuals("cancel", { outcomeLabel: "Cancelled" });
    this._bridgeClient?.sendCancelGoal();
  }

  public setCancelGoalAvailability(
    available: boolean,
    _reason: string | null = null,
  ): void {
    this._cancelGoalAvailable = available;
    this._syncMarkerPresentation();
  }

  public setGoalConfirmAvailability(_available: boolean): void {
    this._syncMarkerPresentation();
  }

  // ── Profile FSM ────────────────────────────────────────────────

  private _handleAppStateProfileFields(
    operatingMode: typeof this._appState.snapshot.operatingMode,
    navigationGoalMode: typeof this._appState.snapshot.navigationGoalMode,
  ): void {
    const nextProfile = deriveNavigationProfile(operatingMode, navigationGoalMode);
    if (nextProfile === this._profile) {
      return;
    }

    const wasActiveNavigation =
      this._lifecycle.goalActive ||
      this._markerPhase === "navigating" ||
      this._appState.snapshot.navigationState === "executingGoal";

    if (wasActiveNavigation) {
      this._cancelActiveGoalForProfileSwitch();
    }

    this._profile = nextProfile;
    this._dispatch({ kind: "profileChanged" });

    if (this._placementEnabled && wasActiveNavigation) {
      this._markerPhase = "idle";
      this._lifecycle.phase = "placing";
      this._resetPreviewState();
      this._lastSentGoal = null;
      this._pathRenderer?.clear();
      this._syncMarkerPresentation();
      this._placement.syncInteractionPolicy();
      this._setNavigationState("placingGoal");
    }
  }

  private _syncProfileFromAppState(): void {
    const state = this._appState.snapshot;
    this._profile = deriveNavigationProfile(state.operatingMode, state.navigationGoalMode);
  }

  private _handlePlacementSessionEvent(event: NavigationSessionEvent): void {
    const pose = this._placement.getCurrentPose();
    this._dispatch(event);
    if (event.kind === "dragThresholdCrossed" && pose) {
      if (shouldSendGoalOnDragThreshold(this._profile, this._markerPhase)) {
        this._commitGoal(pose.position, pose.rotation, { via: "stream", force: true });
      }
    }
  }

  private _dispatch(event: NavigationSessionEvent): void {
    const previousPhase = this._markerPhase;
    const next = navigationMarkerTransition(this._profile, this._markerPhase, event);
    if (next !== null) {
      this._markerPhase = next;
    }
    const phaseChanged = this._markerPhase !== previousPhase;
    const alwaysSync =
      event.kind === "profileChanged" ||
      event.kind === "outcomeResetComplete" ||
      event.kind === "navEnabled" ||
      event.kind === "navDisabled";
    if (phaseChanged || alwaysSync) {
      this._syncMarkerPresentation();
    }
  }

  private _syncMarkerPresentation(): void {
    if (!navigationProfileSpec(this._profile).usesSurfacePlacement) {
      return;
    }
    if (this._markerPhase === "hidden" && !this._placementEnabled) {
      return;
    }
    if (this._markerPhase === "outcomeReset") {
      return;
    }
    const placementActive = this._placement.isPlacementActive();
    this._goalRenderer.apply(this._profile, this._markerPhase, {
      confirmAvailable: this._canConfirmNavigationGoal(),
      cancelAvailable: this._cancelGoalAvailable,
      showConfirmInPreview: placementActive,
    });
    if (this._markerPhase === "navigating") {
      this._placement.applyNavigatingPolicy();
    } else if (this._placementEnabled) {
      this._placement.syncInteractionPolicy();
    }
  }

  // ── Private: nav-status state machine ─────────────────────────

  private _applyNavStatusInner(msg: NavStatusMessage): string {
    this._lifecycle.lastNavStatusTime = getTime();
    this._lifecycle.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;

    if (this._reconcileResyncedNavStatus(msg)) {
      return "Recovered";
    }

    if (msg.recovering) {
      this._resetNavigationVisuals("recovering", { outcomeLabel: "Failed" });
      return "Recovering";
    }

    if (msg.goal_reached || msg.goal_failed) {
      if (!this._lifecycle.goalActive) {
        return "Idle";
      }
      this._finishActiveNavigationGoal(msg.goal_reached);
      return msg.goal_reached ? "Goal reached" : "Goal failed";
    }

    if (msg.state === "following_path") {
      if (this._lifecycle.goalActive) {
        this._enterExecutingFromBridge();
      }
      return "Navigating";
    }
    if (msg.state === "recovery") {
      if (this._lifecycle.goalActive) {
        this._enterExecutingFromBridge();
      }
      return "Recovery";
    }
    return "Idle";
  }

  private _reconcileResyncedNavStatus(_msg: NavStatusMessage): boolean {
    return false;
  }

  private _recoverFromStaleExecution(): void {
    if (!this._lifecycle.goalActive) {
      return;
    }
    print("NavigationController: recovering from stale navigation lifecycle");
    this._resetNavigationVisuals("stale", { outcomeLabel: "Failed" });
  }

  // ── Private: watchdog ──────────────────────────────────────────

  private _tickNavLifecycleWatchdog(): void {
    this._syncIdlePlacementPose();
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
      this._setOutcome({ kind: "failed", errorCode: null });
    }
  }

  private _checkNavLifecycleStaleness(
    now: number = getTime(),
  ): "ok" | "request_resync" | "recover_local" {
    if (!this._lifecycle.goalActive) {
      return "ok";
    }
    const elapsed = now - this._lifecycle.lastNavStatusTime;
    if (elapsed < NAV_STATUS_STALE_TIMEOUT_S) {
      return "ok";
    }
    if (
      now - this._lifecycle.lastNavStatusResyncTime >=
      this._lifecycle.navStatusResyncCooldownS
    ) {
      this._lifecycle.lastNavStatusResyncTime = now;
      this._lifecycle.navStatusResyncCooldownS = Math.min(
        this._lifecycle.navStatusResyncCooldownS * 2.0,
        NAV_STATUS_RESYNC_MAX_COOLDOWN_S,
      );
      return "request_resync";
    }
    if (now - this._lifecycle.navExecutingSince >= NAV_STATUS_LOCAL_RECOVERY_S) {
      return "recover_local";
    }
    return "ok";
  }

  // ── Private: outcome flash ─────────────────────────────────────

  private _outcomesEqual(a: NavigationOutcome, b: NavigationOutcome): boolean {
    if (a.kind !== b.kind) {
      return false;
    }
    if (a.kind === "failed" && b.kind === "failed") {
      return a.errorCode === b.errorCode;
    }
    return true;
  }

  private _handleNavigationOutcomeChanged(outcome: NavigationOutcome): void {
    if (this._outcomesEqual(outcome, this._watchedNavigationOutcome)) {
      return;
    }
    this._watchedNavigationOutcome = outcome;
    this._cancelOutcomeFlashTimer();
    if (outcome.kind === "success" || outcome.kind === "failed") {
      this._armOutcomeFlashTimer();
    }
  }

  private _armOutcomeFlashTimer(): void {
    this._outcomeFlashSeq += 1;
    this._outcomeFlashDueSeq = this._outcomeFlashSeq;
    if (!this._outcomeFlashEvent) {
      this._outcomeFlashEvent = this._script.createEvent(
        "DelayedCallbackEvent",
      ) as DelayedCallbackEvent;
      this._outcomeFlashEvent.bind(() => {
        if (this._outcomeFlashSeq !== this._outcomeFlashDueSeq) {
          return;
        }
        if (navigationOutcomeIsNone(this._appState.snapshot.navigationOutcome)) {
          return;
        }
        this._appState.update({ navigationOutcome: defaultNavigationOutcome() });
      });
    }
    (this._outcomeFlashEvent as DelayedCallbackEvent).reset(NAVIGATION_OUTCOME_FLASH_S);
  }

  private _cancelOutcomeFlashTimer(): void {
    this._outcomeFlashSeq += 1;
  }

  private _setOutcome(outcome: NavigationOutcome): void {
    this._appState.update({ navigationOutcome: outcome });
  }

  private _clearOutcome(): void {
    this._cancelOutcomeFlashTimer();
    if (navigationOutcomeIsNone(this._appState.snapshot.navigationOutcome)) {
      return;
    }
    this._appState.update({ navigationOutcome: defaultNavigationOutcome() });
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
    this._appState.update({
      navigationOutcome: { kind: "failed", errorCode },
      robotRuntime: runtimeState,
    });
    this._onRuntimeStateChanged(runtimeState);
  }

  private _sharedNavigationPreconditions(): boolean {
    const session = toSessionState(this._appState.snapshot);
    if (session.phase !== "runtime") {
      return false;
    }
    if (!isCapabilityAvailable(this._appState.snapshot.robotRuntime, "nav")) {
      return false;
    }
    return true;
  }

  private _canStartManualNavigationPlacement(): boolean {
    const state = this._appState.snapshot;
    const session = toSessionState(state);
    if (session.phase !== "runtime") {
      return false;
    }
    if (session.operating !== "manual") {
      return false;
    }
    if (session.navigation !== "armed") {
      return false;
    }
    if (!this._sharedNavigationPreconditions()) {
      return false;
    }
    return state.robotInteractionMode === "runtimeRobot";
  }

  private _canStartAgentNavigation(): boolean {
    const session = toSessionState(this._appState.snapshot);
    if (session.phase !== "runtime") {
      return false;
    }
    if (session.operating !== "agent") {
      return false;
    }
    return this._sharedNavigationPreconditions();
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
      !navigationOutcomeHasNavRuntimeError(this._appState.snapshot.navigationOutcome)
    );
  }

  private _manualPlacementIntent(): boolean {
    const state = this._appState.snapshot;
    return (
      state.operatingMode === "manual" &&
      (state.navigationState === "armed" ||
        state.navigationState === "placingGoal" ||
        state.navigationState === "executingGoal")
    );
  }

  private _idleNavigationState(): NavigationState {
    return this._manualPlacementIntent() ? "armed" : "off";
  }

  private _setNavigationState(state: NavigationState): void {
    const current = this._appState.snapshot;
    if (state === "executingGoal") {
      if (
        current.navigationState === state &&
        navigationOutcomeIsNone(current.navigationOutcome)
      ) {
        return;
      }
      this._cancelOutcomeFlashTimer();
      this._appState.update({
        navigationOutcome: defaultNavigationOutcome(),
        navigationState: state,
      });
      return;
    }
    if (current.navigationState === state) {
      return;
    }
    this._appState.update({ navigationState: state });
  }

  private _syncNavigationPlacementState(): void {
    const state = this._appState.snapshot;
    if (state.navigationState === "executingGoal") {
      return;
    }

    const wantsManualPlacement =
      state.navigationState === "armed" || state.navigationState === "placingGoal";
    const canMaintainManualPlacement =
      state.operatingMode === "manual" &&
      state.phase === "runtime" &&
      state.robotInteractionMode === "runtimeRobot" &&
      isCapabilityAvailable(state.robotRuntime, "nav");

    if (wantsManualPlacement && canMaintainManualPlacement) {
      if (this._placementEnabled) {
        this._syncIdlePlacementPose();
        return;
      }
      const initialPose = this._getNavigationPlacementStartPose();
      if (!initialPose) {
        return;
      }
      this.setPlacementEnabled(true, initialPose);
      return;
    }

    this.setPlacementEnabled(false);
    if (state.navigationState !== "off") {
      this._setNavigationState(this._idleNavigationState());
    }
  }

  // ── Private: lifecycle reset ───────────────────────────────────

  private _resetNavigationVisuals(
    reason: NavVisualResetReason,
    opts?: {
      outcomeLabel?: "Cancelled" | "Failed";
      respawnAtRobot?: boolean;
      stopPlacement?: boolean;
      resetResyncCooldown?: boolean;
    },
  ): void {
    this._lifecycle.goalActive = false;
    if (
      this._lifecycle.phase === "awaitingPath" ||
      this._lifecycle.phase === "executing"
    ) {
      this._lifecycle.phase =
        this._placementEnabled && !opts?.stopPlacement ? "placing" : "idle";
    }

    this._resetPreviewState();
    this._lastSentGoal = null;
    this._pathRenderer?.clear();

    if (opts?.resetResyncCooldown) {
      this._lifecycle.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;
    }
    if (opts?.stopPlacement) {
      this._placementEnabled = false;
      this._lifecycle.phase = "idle";
      this._placement?.stop();
      this._dispatch({ kind: "navDisabled" });
    } else if (opts?.outcomeLabel) {
      this._beginOutcomeReset(opts.outcomeLabel);
    } else if (opts?.respawnAtRobot) {
      this._respawnGoalMarkerAtRobot();
    } else if (reason === "goal_done") {
      this._dispatch({ kind: "goalReached" });
    }
  }

  // ── Private: goals & preview ───────────────────────────────────

  private _handleGoalConfirmed(position: vec3, rotation: quat): void {
    if (!this._placementEnabled) {
      return;
    }
    if (this._markerPhase === "navigating") {
      this.requestCancelGoal();
      return;
    }
    print(
      `NavigationController: goal confirmed at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`,
    );
    const wasPreview = this._markerPhase === "preview";
    this._dispatch({ kind: "confirmPressed" });
    if (wasPreview) {
      this._commitGoal(position, rotation, { via: "confirm", force: true });
    }
  }

  private _commitGoal(
    position: vec3,
    rotation: quat,
    opts: { force?: boolean; via: GoalCommitVia },
  ): void {
    if (!goalCommitAllowed(this._profile, this._markerPhase, opts.via)) {
      return;
    }
    if (!opts.force && opts.via === "stream" && !this._shouldSendGoal(position)) {
      return;
    }
    if (!this._canSendNavigationGoal()) {
      print("NavigationController: executing locally without sending nav_goal");
      this._lifecycle.goalActive = true;
      this._lifecycle.phase = "executing";
      this._enterExecutingVisuals();
      this._setNavigationState("executingGoal");
      return;
    }

    const startingGoal = !this._lifecycle.goalActive;
    this._lifecycle.goalActive = true;
    this._markNavExecuting();
    if (startingGoal || opts.via === "confirm") {
      this._resetPreviewState();
      this._pathRenderer?.clear();
      this._setNavigationState("executingGoal");
      this._lifecycle.phase = "awaitingPath";
    }
    this._bridgeClient?.sendNavGoal(position, rotation);
    this._lastSentGoal = {
      position: new vec3(position.x, position.y, position.z),
      rotation,
    };
    this._lastGoalSendTime = getTime();
    this._enterExecutingVisuals();
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
    const policy = navigationGoalPolicy(this._profile, this._markerPhase);
    if (policy === "preview") {
      this._maybeRequestPreview(force, placementActive);
    } else if (policy === "redispatch") {
      this._commitGoal(position, rotation, { via: "stream", force });
    }
    this._renderPreviewPath(placementActive);
  }

  private _shouldSendGoal(position: vec3): boolean {
    const now = getTime();
    if (now - this._lastGoalSendTime < GOAL_SEND_INTERVAL_S) {
      return false;
    }
    if (!this._lastSentGoal) {
      return true;
    }
    return (
      this._lastSentGoal.position.distance(position) >= GOAL_SEND_MIN_DISTANCE_CM
    );
  }

  private _maybeRequestPreview(force: boolean, placementActive: boolean): void {
    if (!this._previewTarget) {
      return;
    }
    const now = getTime();
    if (!force && now - this._lastPreviewRequestTime < PREVIEW_INTERVAL_S) {
      return;
    }
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
      if (this._markerPhase !== "navigating") {
        this._pathRenderer?.clear();
      }
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
    const pathStyle =
      this._markerPhase === "navigating" ? "executing" : "preview";
    if (!this._previewBasePath || this._previewBasePath.length < 2) {
      this._pathRenderer?.setLensPath([robotPosition, goalPosition], pathStyle);
      return;
    }
    this._pathRenderer?.setLensPath(this._previewBasePath, pathStyle);
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

  private _resetPreviewState(): void {
    this._previewTarget = null;
    this._previewBasePath = null;
    this._lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  }

  private _finishActiveNavigationGoal(succeeded: boolean): void {
    if (!succeeded) {
      this._lifecycle.goalActive = false;
      this._lifecycle.phase = this._placementEnabled ? "placing" : "idle";
      this._resetPreviewState();
      this._lastSentGoal = null;
      this._pathRenderer?.clear();
      this._setOutcome({ kind: "failed", errorCode: null });
      this._beginOutcomeReset("Failed");
      return;
    }

    const spec = navigationProfileSpec(this._profile);
    const markerPose = this._placement.getCurrentPose();
    const markerMoved =
      markerPose &&
      this._lastSentGoal &&
      markerPose.position.distance(this._lastSentGoal.position) >
        GOAL_REACHED_RETARGET_CM;

    if (!spec.respawnOnSuccess && markerMoved && markerPose) {
      this._commitGoal(markerPose.position, markerPose.rotation, {
        via: "stream",
        force: true,
      });
      return;
    }

    this._lifecycle.goalActive = false;
    this._lifecycle.phase = this._placementEnabled ? "placing" : "idle";
    this._resetPreviewState();
    this._lastSentGoal = null;
    this._pathRenderer?.clear();
    this._dispatch({ kind: "goalReached" });

    if (this._placementEnabled) {
      if (spec.respawnOnSuccess) {
        this._respawnGoalMarkerAtRobot();
        this._setNavigationState("placingGoal");
      } else {
        this._setNavigationState("placingGoal");
      }
      return;
    }
    this._setNavigationState(this._idleNavigationState());
  }

  private _respawnGoalMarkerAtRobot(): void {
    this._placement?.respawnPlacingAt(() => this._getNavigationPlacementStartPose());
  }

  private _markNavExecuting(): void {
    const now = getTime();
    this._lifecycle.navExecutingSince = now;
    this._lifecycle.lastNavStatusTime = now;
  }

  private _enterExecutingVisuals(): void {
    this._pathRenderer?.restyle("executing");
    this._placement?.applyNavigatingPolicy();
  }

  private _enterExecutingFromBridge(): void {
    this._lifecycle.phase = "executing";
    this._markNavExecuting();
    if (this._markerPhase !== "navigating") {
      this._dispatch({ kind: "goalDispatched" });
    }
    this._enterExecutingVisuals();
    this._setNavigationState("executingGoal");
  }

  private _beginOutcomeReset(label: "Cancelled" | "Failed"): void {
    if (this._markerPhase !== "outcomeReset") {
      const event =
        label === "Failed"
          ? ({ kind: "goalFailed" } as const)
          : ({ kind: "cancelPressed" } as const);
      const next = navigationMarkerTransition(this._profile, this._markerPhase, event);
      if (next !== null) {
        this._markerPhase = next;
      }
    }
    this._goalRenderer.showOutcomeReset(this._profile, label, {
      cancelAvailable: this._cancelGoalAvailable,
    });
    if (this._placementEnabled) {
      this._placement.beginOutcomeReset(
        label,
        () => this._getNavigationPlacementStartPose(),
      );
      this._setNavigationState("placingGoal");
      return;
    }
    this._setNavigationState(this._idleNavigationState());
  }

  private _cancelActiveGoalForProfileSwitch(): void {
    if (
      this._lifecycle.goalActive &&
      this._cancelGoalAvailable &&
      this._canSendNavigationGoal()
    ) {
      this._bridgeClient?.sendCancelGoal();
    }
    this._lifecycle.goalActive = false;
    if (
      this._lifecycle.phase === "awaitingPath" ||
      this._lifecycle.phase === "executing"
    ) {
      this._lifecycle.phase = this._placementEnabled ? "placing" : "idle";
    }
    this._resetPreviewState();
    this._lastSentGoal = null;
    this._pathRenderer?.clear();
  }

  private _syncIdlePlacementPose(): void {
    if (!this._placementEnabled || !this._placement?.isIdleFollowingRobot()) {
      return;
    }
    const pose = this._getNavigationPlacementStartPose();
    if (!pose) {
      return;
    }
    this._placement.syncIdlePose(pose.position, pose.rotation);
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
