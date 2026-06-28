// ================================================================
/**
 * Navigation I/O shell: bridge, marker prefab, placement, AppState mirror.
 * Rules and derived presentation live in NavigationModel.ts.
 */
// ================================================================

import {
  AppState,
  bridgeNavigationReady,
  defaultNavigationOutcome,
  DimosAppState,
  NavigationOutcome,
  navigationOutcomeHasNavRuntimeError,
  navigationOutcomeIsNone,
  navigationPlacementToggleEnabled,
  RobotRuntimeState,
  toSessionState,
} from "../Core/AppState";
import { BridgeClient } from "../Bridge/BridgeClient";
import { DimosState } from "../Core/DimosState";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotRuntime } from "../Robot/RobotRuntime";
import {
  NavStatusMessage,
  PathMessage,
  ProtocolParseError,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../Bridge/BridgeDomain";
import {
  isCapabilityAvailable,
  capabilityUnavailableReason,
  robotFloorWorldYCm,
  runtimeDeadzoneRadiusCm,
} from "../Robot/RobotRuntimeModel";
import { NavigationTargetMarker } from "./NavigationTargetMarker";
import { NavigationPathRenderer } from "./NavigationPathRenderer";
import { RobotGroundDeadzone, SurfacePlacementController } from "./SurfacePlacementController";
import {
  applyNavigationEvent,
  buildNavViewContext,
  bumpNavResyncCooldown,
  checkNavLifecycleStaleness,
  createInitialNavEngineState,
  deriveAppNavigationState,
  deriveMarkerPresentation,
  deriveNavDisplayPhase,
  derivePathPresentation,
  derivePlacementInteractionPolicy,
  goalCommitAllowed,
  manualNavGoalConfig,
  navBehavior,
  navigationGoalPolicy,
  shouldRequestPreviewOnTargetChange,
  touchNavStatus,
  type GoalCommitKind,
  type NavEngineState,
  type NavGoalConfig,
  type NavigationEffect,
  type NavigationEvent,
} from "./NavigationModel";

const PREVIEW_INTERVAL_S = 0.25;
const GOAL_SEND_INTERVAL_S = 0.35;
const GOAL_COMMIT_LOG_INTERVAL_S = 2.0;
const GOAL_SEND_MIN_DISTANCE_CM = 20.0;
const GOAL_REACHED_RETARGET_CM = 25.0;
const PREVIEW_STALE_TARGET_DISTANCE_CM = 12.0;
const NAVIGATION_OUTCOME_FLASH_S = 1.5;

const WorldQueryModule = require("LensStudio:WorldQueryModule");

export type { NavGoalConfig } from "./NavigationModel";

export type NavigationControllerDeps = {
  eventHost: BaseScriptComponent;
  pathParentFallback: SceneObject;
  dimosState: DimosState;
  bridgeClient: BridgeClient | null;
  robotRuntime: RobotRuntime;
  robotMarker: RobotMarker | null;
  navigationMarkerPrefab: ObjectPrefab;
  robotGroundDeadzoneRadiusCm: number;
};

export class NavigationController {
  private _cancelGoalAvailable = true;
  private _engine: NavEngineState = createInitialNavEngineState();
  private _previewTarget: { position: vec3; rotation: quat } | null = null;
  private _previewBasePath: vec3[] | null = null;
  private _bridgePath: vec3[] | null = null;
  private _lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  private _lastSentGoal: { position: vec3; rotation: quat } | null = null;
  private _lastGoalSendTime = -GOAL_SEND_INTERVAL_S;
  private _pendingCommitPose: { position: vec3; rotation: quat } | null = null;

  private _navWatchdogEvent: SceneEvent | null = null;
  private _protocolParseFailureCount = 0;
  private _outcomeFlashSeq = 0;
  private _outcomeFlashDueSeq = 0;
  private _outcomeFlashEvent: DelayedCallbackEvent | null = null;
  private _outcomeAnimating = false;
  private _watchedNavigationOutcome: NavigationOutcome = defaultNavigationOutcome();
  private _marker: NavigationTargetMarker | null = null;
  private _hostBound = false;
  private _placementDeferralEvent: DelayedCallbackEvent | null = null;
  private _robotRuntime: RobotRuntime | null = null;
  private _lastGoalCommitLogTime = -1;

  constructor(
    private readonly _script: BaseScriptComponent,
    private readonly _bridgeClient: BridgeClient | null,
    private readonly _appState: AppState,
    private readonly _robotMarker: RobotMarker | null,
    private readonly _navigationMarkerPrefab: ObjectPrefab,
    private readonly _pathRenderer: NavigationPathRenderer,
    private readonly _placement: SurfacePlacementController,
    private readonly _robotGroundDeadzoneRadiusCm: number,
    private readonly _getLastPose: () => PoseMessage | null,
    private readonly _onRuntimeStateChanged: (state: RobotRuntimeState) => void,
  ) {
    this._placement.getConfig = () => this._engine.activeConfig;
    this._placement.isGoalCommitted = () => this._engine.goal !== null;
    this._placement.onDragActivated = () => this._handleDragActivated();
    this._placement.onPresentationSync = () => this._syncPresentation();
    this._placement.onConfirmed = (position, rotation) =>
      this.confirmTarget(position, rotation);
    this._placement.onCancelled = () => this.requestCancelGoal();
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
      this._handleGoalModeChanged(state.navigationGoalMode);
    });
  }

  public static create(deps: NavigationControllerDeps): NavigationController {
    if (!deps.navigationMarkerPrefab) {
      throw new Error("NavigationController: navigationMarkerPrefab is required");
    }
    const parent = deps.robotMarker?.markerRoot?.getParent() ?? deps.pathParentFallback;
    const pathRenderer = new NavigationPathRenderer(parent);
    const placement = new SurfacePlacementController(deps.eventHost, WorldQueryModule);
    return new NavigationController(
      deps.eventHost,
      deps.bridgeClient,
      deps.dimosState.store,
      deps.robotMarker,
      deps.navigationMarkerPrefab,
      pathRenderer,
      placement,
      deps.robotGroundDeadzoneRadiusCm,
      () => deps.robotRuntime?.lastPose ?? null,
      () => {},
    );
  }

  public bindHost(deps: { dimosState: DimosState; robotRuntime: RobotRuntime }): void {
    if (this._hostBound) {
      return;
    }
    this._hostBound = true;
    this._robotRuntime = deps.robotRuntime;
    deps.dimosState.subscribe((state) => this.applyRuntimeState(state.robotRuntime));
    const placementDeferral = this._script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    placementDeferral.bind(() => this.syncManualNavigationState());
    this._placementDeferralEvent = placementDeferral;
    this.startWatchdog();
  }

  public deferPlacementSync(): void {
    this._placementDeferralEvent?.reset(0.0);
  }

  public arm(config: NavGoalConfig): void {
    if (this._engine.activeConfig?.allowDrag && this._placement.isActive()) {
      return;
    }
    if (!this._canStartManualNavigation()) {
      return;
    }
    const initialPose = this._getNavigationPlacementStartPose();
    if (!initialPose) {
      return;
    }
    this._resetPreviewState();
    this._pathRenderer?.clear();
    const marker = this._spawnMarker();
    marker.setDragEnabled(true);
    this._placement.attach(marker);
    this._placement.start(initialPose.position, initialPose.rotation);
    this._log(`nav arm mode=${config.mode} allowDrag=${config.allowDrag}`);
    this._dispatch({ kind: "arm", config });
  }

  public disarm(): void {
    if (!this._engine.activeConfig) {
      return;
    }
    this._log("nav disarm");
    this._dispatch({ kind: "disarm" });
  }

  public submitGoal(position: vec3, rotation: quat, config: NavGoalConfig): boolean {
    if (!this._sharedNavigationPreconditions()) {
      return false;
    }
    if (!config.allowDrag && !this._canSendNavigationGoal() && !config.force) {
      return false;
    }
    this._ensureMarkerForGoal(position, rotation, config);
    return this._requestGoalCommit(position, rotation, "direct", config);
  }

  public confirmTarget(position: vec3, rotation: quat): void {
    if (!this._engine.activeConfig?.allowDrag) {
      return;
    }
    if (this._engine.goal !== null) {
      this.requestCancelGoal();
      return;
    }
    this._requestGoalCommit(position, rotation, "confirm", this._engine.activeConfig);
  }

  public cancelGoal(): void {
    this.requestCancelGoal();
  }

  public get placementEnabled(): boolean {
    return this._engine.activeConfig?.allowDrag === true;
  }

  public syncManualNavigationForOperatingMode(
    mode: DimosAppState["operatingMode"],
    _state: DimosAppState,
  ): void {
    if (mode === "registration" || mode === "agent") {
      this.disarm();
      return;
    }
    this.syncManualNavigationState();
  }

  public onManualNavigationToggleChanged(enabled: boolean): void {
    if (!enabled) {
      const appState = this._appState.snapshot;
      if (
        appState.operatingMode === "manual" &&
        appState.navigationState === "navigating"
      ) {
        if (isCapabilityAvailable(appState.robotRuntime, "emergency_stop")) {
          this.requestEmergencyStop();
        } else if (isCapabilityAvailable(appState.robotRuntime, "cancel_nav_goal")) {
          this.requestCancelGoal();
        }
      }
      this.disarm();
      return;
    }
    this.syncManualNavigationState({ forceEnable: true });
  }

  public syncManualNavigationState(opts?: { forceEnable?: boolean }): void {
    const state = this._appState.snapshot;
    if (state.navigationState === "navigating" && this._engine.goal !== null) {
      return;
    }
    const canMaintain =
      state.operatingMode === "manual" &&
      state.phase === "runtime" &&
      state.robotInteractionMode === "runtimeRobot" &&
      isCapabilityAvailable(state.robotRuntime, "nav");
    const wantsManual =
      Boolean(opts?.forceEnable) ||
      (navigationPlacementToggleEnabled(state) && canMaintain);

    if (wantsManual && canMaintain) {
      if (this._engine.activeConfig?.allowDrag) {
        this._syncIdlePlacementPose();
        return;
      }
      this.arm(manualNavGoalConfig(state.navigationGoalMode));
      return;
    }
    if (this._engine.activeConfig?.allowDrag) {
      this.disarm();
    }
  }

  public onHelloReset(): void {
    this.cancelOutcome();
  }

  public onDisconnect(): void {
    this.clearForDisconnect();
  }

  public applyRuntimeStateFromSnapshot(): void {
    this.applyRuntimeState(this._appState.snapshot.robotRuntime);
  }

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
    const goalY = this._marker?.worldPosition.y ?? null;
    if (robotY !== null && goalY !== null) {
      this._pathRenderer?.setHeightRange(robotY, goalY);
    }

    const waypoints =
      msg.waypoints.length >= 2
        ? msg.waypoints.map((point) => protocolMetersToLensCentimeters(point))
        : null;

    if (msg.kind === "preview") {
      if (!this._previewTarget) {
        return;
      }
      if (msg.target && !this._previewTargetMatches(msg.target)) {
        return;
      }
      this._previewBasePath = waypoints;
      this._syncPresentation();
      return;
    }

    this._bridgePath = waypoints;
    if (this._engine.goal !== null) {
      this._dispatch({ kind: "navigating" });
    }
    this._syncPresentation();
  }

  public resyncPreviewGoal(): void {
    if (!this._previewTarget || this._engine.goal !== null) {
      return;
    }
    this._maybeRequestPreview(true, this._placement.isPlacementActive());
  }

  public applyNavStatus(msg: NavStatusMessage): void {
    this._protocolParseFailureCount = 0;
    this._engine = touchNavStatus(this._engine, getTime());
    const navLabel = this._applyNavStatusInner(msg);
    if (msg.phase === "recovering") {
      this._cancelOutcomeFlashTimer();
      return;
    }
    if (navLabel === "Goal reached") {
      const config = this._engine.activeConfig;
      if (config && navBehavior(config).respawnAtRobotOnSuccess) {
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
    if (this._appState.snapshot.navigationState !== "navigating") {
      return;
    }
    this._log(`protocol ${error.kind} failures while navigating; awaiting resync`);
  }

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
    this.clearInactiveState();
  }

  public clearInactiveState(): void {
    this._dispatch({ kind: "disconnect" });
  }

  public applyRuntimeState(state: RobotRuntimeState): void {
    const appState = this._appState.snapshot;
    if (
      !state.capabilities.nav?.available &&
      navigationPlacementToggleEnabled(appState)
    ) {
      this.disarm();
    }
    this._placement?.setRobotGroundDeadzone({
      radiusCm: runtimeDeadzoneRadiusCm(state, this._robotGroundDeadzoneRadiusCm),
      getRobotWorldPosition: () => this._robotMarker?.getWorldPosition() ?? null,
      getRobotFloorWorldY: () => this._robotFloorY(),
    } as RobotGroundDeadzone);
    this.setCancelGoalAvailability(
      isCapabilityAvailable(state, "cancel_nav_goal"),
      capabilityUnavailableReason(state, "cancel_nav_goal"),
    );
    this._syncPresentation();
    this.syncManualNavigationState();
  }

  public requestEmergencyStop(): void {
    if (!isCapabilityAvailable(this._appState.snapshot.robotRuntime, "emergency_stop")) {
      return;
    }
    this._log("requestEmergencyStop");
    this._dispatch({ kind: "estopRequested" });
    this._bridgeClient?.sendEmergencyStop();
  }

  public requestCancelGoal(): void {
    if (!this._cancelGoalAvailable) {
      return;
    }
    this._log("nav goal cancel requested");
    this._dispatch({ kind: "cancelRequested" });
    this._bridgeClient?.sendCancelGoal();
  }

  public setCancelGoalAvailability(available: boolean, _reason: string | null = null): void {
    this._cancelGoalAvailable = available;
    this._syncPresentation();
  }

  public setGoalConfirmAvailability(_available: boolean): void {
    this._syncPresentation();
  }

  public onNavigationGoalModeChanged(): void {
    this._handleGoalModeChanged(this._appState.snapshot.navigationGoalMode);
  }

  public canSubmitNavigationGoal(): boolean {
    return this._sharedNavigationPreconditions();
  }

  private _viewContext() {
    return buildNavViewContext(this._engine, {
      placementActive: this._placement.isPlacementActive(),
      markerExists: this._marker !== null,
      outcomeAnimating: this._outcomeAnimating,
    });
  }

  private _dispatch(event: NavigationEvent): void {
    const result = applyNavigationEvent(this._engine, event, getTime());
    this._engine = result.state;
    for (const effect of result.effects) {
      this._applyEffect(effect);
    }
  }

  private _applyEffect(effect: NavigationEffect): void {
    switch (effect.kind) {
      case "syncAppNavigationState":
        this._syncAppNavigationState();
        break;
      case "syncMarkerPresentation":
        this._syncPresentation();
        break;
      case "sendNavGoal": {
        const pose = this._pendingCommitPose;
        if (pose && (this._canSendNavigationGoal() || this._engine.activeConfig?.force)) {
          this._bridgeClient?.sendNavGoal(pose.position, pose.rotation);
          this._lastSentGoal = {
            position: new vec3(pose.position.x, pose.position.y, pose.position.z),
            rotation: pose.rotation,
          };
          this._lastGoalSendTime = getTime();
        }
        break;
      }
      case "sendCancelGoal":
        if (this._cancelGoalAvailable && this._canSendNavigationGoal()) {
          this._bridgeClient?.sendCancelGoal();
        }
        break;
      case "clearPath":
        this._resetPreviewState();
        this._bridgePath = null;
        this._lastSentGoal = null;
        this._pathRenderer?.clear();
        break;
      case "resetNavigationOutcome":
        this._cancelOutcomeFlashTimer();
        this._appState.update({ navigationOutcome: defaultNavigationOutcome() });
        break;
      case "destroyMarker":
        this._destroyMarker();
        break;
      case "respawnMarkerAtRobot":
        if (effect.immediate) {
          this._placement?.respawnPlacingImmediately(() =>
            this._getNavigationPlacementStartPose(),
          );
        } else {
          this._placement?.respawnPlacingAt(() => this._getNavigationPlacementStartPose());
        }
        break;
      case "setPlacementInteraction":
        this._placement?.setInteractionPolicy(effect.policy);
        break;
      case "beginOutcomeAnimation":
        this._beginOutcomeAnimation(effect.label);
        break;
      case "stopPlacement":
        this._placement?.stop();
        this._placement?.detach();
        break;
      default:
        break;
    }
  }

  private _syncAppNavigationState(): void {
    const ctx = this._viewContext();
    const next = deriveAppNavigationState(ctx, this._engine.activeConfig !== null);
    const current = this._appState.snapshot;
    if (next === "navigating") {
      if (
        current.navigationState === next &&
        navigationOutcomeIsNone(current.navigationOutcome)
      ) {
        return;
      }
      this._cancelOutcomeFlashTimer();
      this._appState.update({
        navigationOutcome: defaultNavigationOutcome(),
        navigationState: next,
      });
      return;
    }
    if (current.navigationState === next) {
      return;
    }
    this._appState.update({ navigationState: next });
  }

  private _requestGoalCommit(
    position: vec3,
    rotation: quat,
    commitKind: GoalCommitKind,
    config: NavGoalConfig,
  ): boolean {
    const ctx = this._viewContext();
    if (ctx && !goalCommitAllowed(ctx, commitKind)) {
      return false;
    }
    if (commitKind === "stream" && !this._shouldSendGoal(position)) {
      return false;
    }
    const sendToBridge =
      commitKind === "direct"
        ? this._canSendNavigationGoal() || Boolean(config.force)
        : this._canSendNavigationGoal();
    this._pendingCommitPose = {
      position: new vec3(position.x, position.y, position.z),
      rotation,
    };
    this._previewTarget = {
      position: new vec3(position.x, position.y, position.z),
      rotation,
    };
    this._dispatch({
      kind: "goalCommitRequested",
      config,
      commitKind,
      sendToBridge,
    });
    this._logGoalCommit(commitKind, config.mode, sendToBridge);
    this._pendingCommitPose = null;
    return this._engine.goal !== null;
  }

  private _handleGoalModeChanged(mode: DimosAppState["navigationGoalMode"]): void {
    const config = manualNavGoalConfig(mode);
    if (
      this._engine.activeConfig?.mode === config.mode &&
      this._engine.activeConfig?.allowDrag === config.allowDrag
    ) {
      return;
    }
    if (this._engine.activeConfig?.allowDrag) {
      this._dispatch({ kind: "configChanged", config });
    }
  }

  private _handleDragActivated(): void {
    this._syncPresentation();
    const pose = this._placement.getCurrentPose();
    const config = this._engine.activeConfig;
    if (!pose || !config || config.mode !== "continuous" || this._engine.goal !== null) {
      return;
    }
    this._requestGoalCommit(pose.position, pose.rotation, "stream", config);
  }

  private _syncPresentation(): void {
    const config = this._engine.activeConfig;
    if (!config || this._outcomeAnimating) {
      return;
    }
    if (!this._marker && !config.allowDrag) {
      return;
    }
    const ctx = this._viewContext();
    if (!ctx) {
      return;
    }

    const { kind, preset } = deriveMarkerPresentation(ctx);
    const placementActive = this._placement.isPlacementActive();
    const phase = deriveNavDisplayPhase(ctx);
    this._marker?.applyPreset(config, kind, preset, {
      confirmAvailable: this._canConfirmNavigationGoal(),
      cancelAvailable: this._cancelGoalAvailable,
      showConfirmInPreview: placementActive && config.mode === "single",
      showCancelInPreview: phase === "preview" && config.mode === "continuous",
    });
    this._placement.setInteractionPolicy(
      derivePlacementInteractionPolicy(
        this._engine,
        placementActive,
        this._outcomeAnimating,
      ),
    );

    const { renderPath, style } = derivePathPresentation(ctx);
    if (!renderPath || style === null) {
      this._pathRenderer?.clear();
      return;
    }

    const robotPosition = this._getRobotFloorPosition() ?? null;
    const goalPosition =
      this._placement?.getRenderedPosition() ??
      this._previewTarget?.position ??
      this._marker?.worldPosition ??
      null;
    if (!robotPosition || !goalPosition) {
      this._pathRenderer?.clear();
      return;
    }
    this._pathRenderer?.setHeightRange(robotPosition.y, goalPosition.y);

    let points: vec3[];
    if (phase === "navigating" && this._bridgePath && this._bridgePath.length >= 2) {
      points = this._bridgePath;
    } else if (this._previewBasePath && this._previewBasePath.length >= 2) {
      points = this._previewBasePath;
    } else {
      points = [robotPosition, goalPosition];
    }
    this._pathRenderer?.setLensPath(points, style);
  }

  private _applyNavStatusInner(msg: NavStatusMessage): string {
    if (msg.phase === "recovering") {
      if (msg.retryable) {
        this._dispatch({ kind: "navStatusRecovering" });
      }
      return "Recovering";
    }
    if (msg.phase === "succeeded" || msg.phase === "failed") {
      if (this._engine.goal === null) {
        return "Idle";
      }
      if (msg.phase === "succeeded") {
        this._finishContinuousRetargetIfNeeded();
        this._dispatch({ kind: "navStatusGoalReached" });
        return "Goal reached";
      }
      this._dispatch({ kind: "navStatusGoalFailed" });
      return "Goal failed";
    }
    if (msg.phase === "navigating") {
      if (this._engine.goal !== null) {
        this._dispatch({ kind: "navigating" });
      }
      return "Navigating";
    }
    return "Idle";
  }

  private _finishContinuousRetargetIfNeeded(): void {
    const config = this._engine.activeConfig;
    if (!config || navBehavior(config).respawnAtRobotOnSuccess) {
      return;
    }
    const markerPose = this._placement.getCurrentPose();
    const markerMoved =
      markerPose &&
      this._lastSentGoal &&
      markerPose.position.distance(this._lastSentGoal.position) > GOAL_REACHED_RETARGET_CM;
    if (markerMoved && markerPose) {
      this._requestGoalCommit(markerPose.position, markerPose.rotation, "stream", config);
    }
  }

  private _tickNavLifecycleWatchdog(): void {
    this._syncIdlePlacementPose();
    if (!this._bridgeClient?.isConnected()) {
      return;
    }
    const action = checkNavLifecycleStaleness(this._engine, getTime());
    if (action === "request_resync") {
      this._engine = bumpNavResyncCooldown(this._engine, getTime());
      this._bridgeClient?.requestStatus();
      this.resyncPreviewGoal();
      return;
    }
    if (action === "recover_local") {
      this._dispatch({ kind: "staleRecovery" });
      this._setOutcome({ kind: "failed", errorCode: null });
    }
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

  private _outcomesEqual(a: NavigationOutcome, b: NavigationOutcome): boolean {
    if (a.kind !== b.kind) {
      return false;
    }
    if (a.kind === "failed" && b.kind === "failed") {
      return a.errorCode === b.errorCode;
    }
    return true;
  }

  private _armOutcomeFlashTimer(): void {
    this._outcomeFlashSeq += 1;
    this._outcomeFlashDueSeq = this._outcomeFlashSeq;
    if (!this._outcomeFlashEvent) {
      this._outcomeFlashEvent = this._script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
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

  private _disableNavRuntime(errorCode: number): void {
    const appState = this._appState.snapshot;
    const capabilities = {
      ...appState.robotRuntime.capabilities,
      nav: { available: false, reason: `Bridge Error (${errorCode})` },
    };
    const runtimeState: RobotRuntimeState = { ...appState.robotRuntime, capabilities };
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
    return isCapabilityAvailable(this._appState.snapshot.robotRuntime, "nav");
  }

  private _canStartManualNavigation(): boolean {
    const state = this._appState.snapshot;
    const session = toSessionState(state);
    if (session.phase !== "runtime" || session.operating !== "manual") {
      return false;
    }
    if (session.navigation === "navigating") {
      return false;
    }
    if (!this._sharedNavigationPreconditions()) {
      return false;
    }
    return state.robotInteractionMode === "runtimeRobot";
  }

  private _canSendNavigationGoal(): boolean {
    return (
      bridgeNavigationReady(this._appState.snapshot.bridgeSnapshot) &&
      isCapabilityAvailable(this._appState.snapshot.robotRuntime, "nav")
    );
  }

  private _canConfirmNavigationGoal(): boolean {
    return (
      isCapabilityAvailable(this._appState.snapshot.robotRuntime, "nav") &&
      !navigationOutcomeHasNavRuntimeError(this._appState.snapshot.navigationOutcome)
    );
  }

  private _handlePreviewTargetChanged(
    position: vec3,
    rotation: quat,
    placementActive: boolean,
    force: boolean,
  ): void {
    const config = this._engine.activeConfig;
    if (!config) {
      return;
    }
    this._previewTarget = { position: new vec3(position.x, position.y, position.z), rotation };
    const ctx = this._viewContext();
    if (ctx && navigationGoalPolicy(ctx) === "stream") {
      this._requestGoalCommit(position, rotation, "stream", config);
    }
    if (shouldRequestPreviewOnTargetChange(ctx)) {
      this._maybeRequestPreview(force, placementActive || !config.allowDrag);
    }
    this._syncPresentation();
  }

  private _shouldSendGoal(position: vec3): boolean {
    const now = getTime();
    if (now - this._lastGoalSendTime < GOAL_SEND_INTERVAL_S) {
      return false;
    }
    if (!this._lastSentGoal) {
      return true;
    }
    return this._lastSentGoal.position.distance(position) >= GOAL_SEND_MIN_DISTANCE_CM;
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
        this._bridgeClient?.sendPreviewGoal(
          this._previewTarget.position,
          this._previewTarget.rotation,
        ) ?? false;
      if (sent) {
        return;
      }
    }
    this._previewBasePath = null;
  }

  private _canRequestPreviewPath(placementActive: boolean): boolean {
    return (
      (placementActive || !this._engine.activeConfig?.allowDrag) &&
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

  private _beginOutcomeAnimation(label: "Cancelled" | "Failed"): void {
    const config = this._engine.activeConfig;
    if (!config) {
      return;
    }
    this._outcomeAnimating = true;
    this._marker?.showOutcomeReset(config, label, {
      cancelAvailable: this._cancelGoalAvailable,
    });
    this._placement.setInteractionPolicy({ dragEnabled: false, followRobot: false });
  }

  private _ensureMarkerForGoal(position: vec3, rotation: quat, config: NavGoalConfig): void {
    if (this._marker) {
      if (!config.allowDrag) {
        this._marker.setPose(position, rotation);
        this._marker.setDragEnabled(false);
        this._bindDisplayOnlyMarkerEvents(this._marker);
      }
      return;
    }
    const marker = this._spawnMarker();
    marker.setPose(position, rotation);
    marker.setDragEnabled(config.allowDrag);
    if (!config.allowDrag) {
      this._bindDisplayOnlyMarkerEvents(marker);
    }
    if (config.allowDrag && this._engine.activeConfig?.allowDrag) {
      this._placement.attach(marker);
    }
    this._previewTarget = { position: new vec3(position.x, position.y, position.z), rotation };
    this._maybeRequestPreview(true, !config.allowDrag);
    this._syncPresentation();
  }

  private _syncIdlePlacementPose(): void {
    if (!this._engine.activeConfig?.allowDrag || !this._placement?.isIdleFollowingRobot()) {
      return;
    }
    const pose = this._getNavigationPlacementStartPose();
    if (!pose) {
      return;
    }
    this._placement.syncIdlePose(pose.position, pose.rotation);
  }

  private _getNavigationPlacementStartPose(): { position: vec3; rotation: quat } | null {
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

  private _bindDisplayOnlyMarkerEvents(marker: NavigationTargetMarker): void {
    marker.bindEvents({
      onConfirmTriggerUp: () => {
        const ctx = this._viewContext();
        if (ctx && (ctx.goal !== null || this._placement.isPlacementActive())) {
          this.requestCancelGoal();
        }
      },
      onOutcomeResetComplete: () => {
        this._handleOutcomeAnimationFinished();
      },
    });
  }

  private _handleOutcomeAnimationFinished(): void {
    this._outcomeAnimating = false;
    this._dispatch({ kind: "outcomeAnimationFinished" });
    if (this._engine.activeConfig?.allowDrag && this._placement.isActive()) {
      this._placement.respawnPlacingAt(() => this._getNavigationPlacementStartPose());
    }
  }

  private _spawnMarker(): NavigationTargetMarker {
    this._destroyMarker();
    const root = this._navigationMarkerPrefab.instantiate(this._script.getSceneObject());
    const marker = root.getComponent(
      NavigationTargetMarker.getTypeName(),
    ) as NavigationTargetMarker | null;
    if (!marker) {
      root.destroy();
      throw new Error("NavigationController: prefab is missing NavigationTargetMarker component");
    }
    marker.ensureReady();
    marker.bindEvents({
      onOutcomeResetComplete: () => this._handleOutcomeAnimationFinished(),
    });
    this._marker = marker;
    return marker;
  }

  private _destroyMarker(): void {
    if (!this._marker) {
      return;
    }
    this._marker.destroy();
    this._marker = null;
  }

  private _logGoalCommit(
    commitKind: GoalCommitKind,
    mode: NavGoalConfig["mode"],
    sendToBridge: boolean,
  ): void {
    const now = getTime();
    if (
      commitKind === "stream" &&
      this._lastGoalCommitLogTime >= 0 &&
      now - this._lastGoalCommitLogTime < GOAL_COMMIT_LOG_INTERVAL_S
    ) {
      return;
    }
    if (commitKind === "stream") {
      this._lastGoalCommitLogTime = now;
    }
    this._log(`nav goal commit kind=${commitKind} mode=${mode} sent=${sendToBridge}`);
  }

  private _log(message: string): void {
    print(`NavigationController: ${message}`);
  }
}
