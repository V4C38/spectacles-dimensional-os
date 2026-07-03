// ================================================================
/**
 * Navigation controller: placement, marker/path presentation, and bridge I/O.
 * Wire I/O is delegated to NavigationClient; nav rules via NavigationModel.
 */
// ================================================================

import {
  AppState,
  bridgeNavigationReady,
  defaultNavigationOutcome,
  AppStateData,
  NavigationOutcome,
  navigationOutcomeHasNavRuntimeError,
  navigationOutcomeIsNone,
  navigationPlacementToggleEnabled,
  RobotRuntimeState,
  toSessionState,
} from "../AppState";
import { AppStateStore } from "../AppState";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotPresenter } from "../Robot/RobotPresenter";
import {
  NavStatusMessage,
  NavGoalUpdateMessage,
  PathMessage,
  ProtocolParseError,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../../ARBridge/Network/Protocol";
import { NavigationClient } from "../../ARBridge/Navigation/NavigationClient";
import { ARBridgeSession } from "../../ARBridge/Network/ARBridgeSession";
import { StatusClient } from "../../ARBridge/Status/StatusClient";
import {
  isCapabilityAvailable,
  capabilityUnavailableReason,
  robotFloorWorldYCm,
  runtimeDeadzoneRadiusCm,
} from "../Robot/RobotRuntimeModel";
import { NavigationPathRenderer } from "./NavigationPathRenderer";
import { NavigationTargetMarker } from "./NavigationTargetMarker";
import { GroundPlacement, RobotGroundDeadzone } from "./GroundPlacement";
import {
  applyNavigationEvent,
  bumpNavResyncCooldown,
  checkNavLifecycleStaleness,
  createInitialNavEngineState,
  deriveAppNavigationState,
  deriveViewState,
  goalCommitAllowed,
  manualNavGoalConfig,
  shouldRequestPreviewOnTargetChange,
  touchNavStatus,
  type GoalCommitKind,
  type NavEngineState,
  type NavGoalConfig,
  type NavigationEffect,
  type NavigationEvent,
} from "../../ARBridge/Navigation/NavigationModel";

const GOAL_SEND_INTERVAL_S = 0.35;
const GOAL_COMMIT_LOG_INTERVAL_S = 2.0;
const GOAL_SEND_MIN_DISTANCE_CM = 20.0;
const GOAL_REACHED_RETARGET_CM = 25.0;
const PREVIEW_INTERVAL_S = 0.25;
const PREVIEW_STALE_TARGET_DISTANCE_CM = 12.0;

const WorldQueryModule = require("LensStudio:WorldQueryModule");

export type { NavGoalConfig } from "../../ARBridge/Navigation/NavigationModel";

export type NavigationControllerDeps = {
  eventHost: BaseScriptComponent;
  pathParentFallback: SceneObject;
  appStateStore: AppStateStore;
  navClient: NavigationClient | null;
  session: ARBridgeSession | null;
  statusClient: StatusClient | null;
  robotPresenter: RobotPresenter;
  robotMarker: RobotMarker | null;
  navigationMarkerPrefab: ObjectPrefab;
  robotGroundDeadzoneRadiusCm: number;
};

export class NavigationController {
  private _cancelGoalAvailable = true;
  private _engine: NavEngineState = createInitialNavEngineState();
  private _lastSentGoal: { position: vec3; rotation: quat } | null = null;
  private _lastGoalSendTime = -GOAL_SEND_INTERVAL_S;

  private _navWatchdogEvent: SceneEvent | null = null;
  private _hostBound = false;
  private _placementDeferralEvent: DelayedCallbackEvent | null = null;
  private _lastGoalCommitLogTime = -1;

  private _marker: NavigationTargetMarker | null = null;
  private _outcomeAnimating = false;
  private _outcomeLabel: "Cancelled" | "Failed" | null = null;
  private _bridgePath: vec3[] | null = null;
  private _previewBasePath: vec3[] | null = null;

  private _previewTarget: { position: vec3; rotation: quat } | null = null;
  private _lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  private _protocolParseFailureCount = 0;

  constructor(
    private readonly _script: BaseScriptComponent,
    private readonly _navClient: NavigationClient | null,
    private readonly _session: ARBridgeSession | null,
    private readonly _statusClient: StatusClient | null,
    private readonly _appState: AppState,
    private readonly _robotMarker: RobotMarker | null,
    private readonly _navigationMarkerPrefab: ObjectPrefab,
    private readonly _pathRenderer: NavigationPathRenderer,
    private readonly _placement: GroundPlacement,
    private readonly _robotGroundDeadzoneRadiusCm: number,
    private readonly _getLastPose: () => PoseMessage | null,
  ) {
    this._placement.onDragActivated = () => this._handleDragActivated();
    this._placement.onPresentationSync = () => this._applyViewState();
    this._placement.onConfirmPressed = (position, rotation) => {
      const config = this._engine.activeConfig;
      if (this._engine.goal !== null || config?.mode === "continuous") {
        this.requestCancelGoal();
      } else {
        this.confirmTarget(position, rotation);
      }
    };
    this._placement.onPreviewTargetChanged = (pos, rot, active, force) =>
      this._handlePreviewTargetChanged(pos, rot, active, force);

    this._placement.setRobotGroundDeadzone({
      radiusCm: _robotGroundDeadzoneRadiusCm,
      getRobotWorldPosition: () => this._robotMarker?.getWorldPosition() ?? null,
      getRobotFloorWorldY: () => this._getRobotFloorY(),
    } as RobotGroundDeadzone);

    this._appState.subscribe((state) => {
      this._handleGoalModeChanged(state.navigationGoalMode);
    });
  }

  public static create(deps: NavigationControllerDeps): NavigationController {
    if (!deps.navigationMarkerPrefab) {
      throw new Error("NavigationController: navigationMarkerPrefab is required");
    }
    const parent = deps.robotMarker?.markerRoot?.getParent() ?? deps.pathParentFallback;
    const pathRenderer = new NavigationPathRenderer(parent);
    const placement = new GroundPlacement(deps.eventHost, WorldQueryModule);
    return new NavigationController(
      deps.eventHost,
      deps.navClient,
      deps.session,
      deps.statusClient,
      deps.appStateStore.store,
      deps.robotMarker,
      deps.navigationMarkerPrefab,
      pathRenderer,
      placement,
      deps.robotGroundDeadzoneRadiusCm,
      () => deps.robotPresenter?.lastPose ?? null,
    );
  }

  public bindHost(deps: { appStateStore: AppStateStore; robotPresenter: RobotPresenter }): void {
    if (this._hostBound) {
      return;
    }
    this._hostBound = true;
    deps.appStateStore.subscribe((state) => this.applyRuntimeState(state.robotRuntime));
    const placementDeferral = this._script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    placementDeferral.bind(() => this.syncManualNavigationState());
    this._placementDeferralEvent = placementDeferral;
    this.startWatchdog();
  }

  public deferPlacementSync(): void {
    this._placementDeferralEvent?.reset(0.0);
  }

  public arm(config: NavGoalConfig): void {
    if (this._engine.activeConfig?.interactive && this._placement.isActive()) {
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
    this._pathRenderer.clear();
    const marker = this._createDragMarker();
    this._placement.attach(marker);
    this._placement.start(initialPose.position, initialPose.rotation);
    this._log(`nav arm mode=${config.mode} interactive=${config.interactive}`);
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
    if (!config.interactive && !this._canSendNavigationGoal() && !config.force) {
      return false;
    }
    this._ensureMarkerForGoal(position, rotation, config);
    return this._requestGoalCommit(position, rotation, "direct", config);
  }

  public confirmTarget(position: vec3, rotation: quat): void {
    if (!this._engine.activeConfig?.interactive) {
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
    return this._engine.activeConfig?.interactive === true;
  }

  public syncManualNavigationForOperatingMode(
    mode: AppStateData["operatingMode"],
    _state: AppStateData,
  ): void {
    if (mode === "registration") {
      this.disarm();
      return;
    }
    if (mode === "agent" && this._engine.activeConfig?.source !== "remote") {
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
      if (this._engine.activeConfig?.interactive) {
        this._syncIdlePlacementPose();
        return;
      }
      this.arm(manualNavGoalConfig(state.navigationGoalMode));
      return;
    }
    if (this._engine.activeConfig?.interactive) {
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
      this._updatePathHeightRange();
      this._previewBasePath = waypoints;
      this._applyViewState();
      return;
    }

    this._updatePathHeightRange();
    this._bridgePath = waypoints;
    if (this._engine.goal !== null) {
      this._dispatch({ kind: "navigating" });
      return;
    }
    this._applyViewState();
  }

  public resyncPreviewGoal(): void {
    if (!this._previewTarget || this._engine.goal !== null) {
      return;
    }
    this._maybeRequestPreview(true, this._placement.isPlacementActive());
  }

  public applyNavGoalUpdate(msg: NavGoalUpdateMessage): void {
    const pose = this._poseFromWire(msg.position, msg.orientation);
    this._previewTarget = {
      position: new vec3(pose.position.x, pose.position.y, pose.position.z),
      rotation: pose.rotation,
    };
    this._dispatch({
      kind: "navGoalUpdate",
      source: msg.source,
      pose,
      active: msg.active,
    });
  }

  public applyNavStatus(msg: NavStatusMessage): void {
    this._protocolParseFailureCount = 0;
    this._engine = touchNavStatus(this._engine, getTime());
    const navLabel = this._applyNavStatusInner(msg);
    if (msg.phase === "recovering") {
      return;
    }
    if (navLabel === "Goal reached") {
      const config = this._engine.activeConfig;
      if (config && config.mode === "single" && config.interactive) {
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
    this._log(
      `protocol ${error.kind} failures while navigating; awaiting resync`,
    );
  }

  public cancelOutcome(): void {
    // Outcome flash timer removed; no-op for hello reset compatibility.
  }

  public clearForDisconnect(): void {
    this.clearInactiveState();
    this._protocolParseFailureCount = 0;
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
      getRobotFloorWorldY: () => this._getRobotFloorY(),
    } as RobotGroundDeadzone);
    this.setCancelGoalAvailability(
      isCapabilityAvailable(state, "cancel_nav_goal"),
      capabilityUnavailableReason(state, "cancel_nav_goal"),
    );
    this._applyViewState();
    this.syncManualNavigationState();
  }

  public requestEmergencyStop(): void {
    if (!isCapabilityAvailable(this._appState.snapshot.robotRuntime, "emergency_stop")) {
      return;
    }
    this._log("requestEmergencyStop");
    this._dispatch({ kind: "estopRequested" });
    this._navClient?.sendEmergencyStop();
  }

  public requestCancelGoal(): void {
    if (!this._cancelGoalAvailable) {
      return;
    }
    this._log("nav goal cancel requested");
    this._dispatch({ kind: "cancelRequested" });
    this._navClient?.sendCancelGoal();
  }

  public setCancelGoalAvailability(available: boolean, _reason: string | null = null): void {
    this._cancelGoalAvailable = available;
    this._applyViewState();
  }

  public onNavigationGoalModeChanged(): void {
    this._handleGoalModeChanged(this._appState.snapshot.navigationGoalMode);
  }

  public canSubmitNavigationGoal(): boolean {
    return this._sharedNavigationPreconditions();
  }

  private _viewState() {
    const marker = this._marker !== null
      ? {
          position: this._placement.getCurrentPose()?.position ?? new vec3(0, 0, 0),
          rotation: this._placement.getCurrentPose()?.rotation ?? quat.quatIdentity(),
        }
      : null;
    return deriveViewState(
      this._engine,
      {
        placementActive: this._placement.isPlacementActive(),
        activelyDragging: this._placement.isActivelyDragging(),
        markerExists: this._marker !== null,
        outcomeAnimating: this._outcomeAnimating,
        outcomeLabel: this._outcomeLabel,
        markerPose: marker,
      },
      {
        cancelAvailable: this._cancelGoalAvailable,
        confirmAvailable: this._canConfirmNavigationGoal(),
        sessionActive: this._engine.activeConfig !== null,
      },
    );
  }

  private _applyViewState(): void {
    const config = this._engine.activeConfig;
    if (!config || this._outcomeAnimating) {
      return;
    }
    if (!this._marker && !config.interactive) {
      return;
    }

    const markerPose = this._marker
      ? {
          position: this._marker.worldPosition,
          rotation: this._marker.getRotation(),
        }
      : null;

    const view = deriveViewState(
      this._engine,
      {
        placementActive: this._placement.isPlacementActive(),
        activelyDragging: this._placement.isActivelyDragging(),
        markerExists: this._marker !== null,
        outcomeAnimating: this._outcomeAnimating,
        outcomeLabel: this._outcomeLabel,
        markerPose,
      },
      {
        cancelAvailable: this._cancelGoalAvailable,
        confirmAvailable: this._canConfirmNavigationGoal(),
        sessionActive: this._engine.activeConfig !== null,
      },
    );
    if (!view) {
      return;
    }

    this._marker?.apply(config, view.marker);
    this._placement.setInteractionPolicy(view.placement);

    const path = view.path;
    if (!path) {
      this._pathRenderer?.clear();
      return;
    }

    const robotPosition = this._getRobotFloorPosition() ?? null;
    const goalPosition =
      this._placement.getRenderedPosition() ??
      this._previewTarget?.position ??
      this._marker?.worldPosition ??
      null;
    if (!robotPosition || !goalPosition) {
      this._pathRenderer?.clear();
      return;
    }
    this._pathRenderer.setHeightRange(robotPosition.y, goalPosition.y);

    let points: vec3[] | null = null;
    if (path.style === "navigating" && this._bridgePath && this._bridgePath.length >= 2) {
      points = this._bridgePath;
    } else if (this._previewBasePath && this._previewBasePath.length >= 2) {
      points = this._previewBasePath;
    }
    if (!points) {
      this._pathRenderer?.clear();
      return;
    }
    this._pathRenderer.setLensPath(points, path.style);
  }

  private _dispatch(event: NavigationEvent): void {
    const result = applyNavigationEvent(this._engine, event, getTime());
    this._engine = result.state;
    for (const effect of result.effects) {
      this._applyEffect(effect);
    }
    this._applyViewState();
  }

  private _applyEffect(effect: NavigationEffect): void {
    switch (effect.kind) {
      case "syncAppNavigationState":
        this._syncAppNavigationState();
        break;
      case "syncMarkerPresentation":
        break;
      case "sendNavGoal": {
        const pose = effect.pose;
        if (pose && (this._canSendNavigationGoal() || this._engine.activeConfig?.force)) {
          this._navClient?.sendNavGoal(pose.position, pose.rotation);
          this._lastSentGoal = {
            position: new vec3(pose.position.x, pose.position.y, pose.position.z),
            rotation: pose.rotation,
          };
          this._lastGoalSendTime = getTime();
        }
        break;
      }
      case "respawnMarkerAt": {
        const pose = effect.pose ?? this._getNavigationPlacementStartPose();
        if (!pose) {
          break;
        }
        if (effect.animated) {
          this._placement.respawnPlacingAt(() => pose);
        } else {
          this._placement.respawnPlacingImmediately(() => pose);
        }
        break;
      }
      case "ensureMarkerAt": {
        this._ensureMarkerForGoal(effect.pose.position, effect.pose.rotation, effect.config);
        if (this._marker) {
          this._marker.setPose(effect.pose.position, effect.pose.rotation);
        }
        break;
      }
      case "sendCancelGoal":
        if (this._cancelGoalAvailable && this._canSendNavigationGoal()) {
          this._navClient?.sendCancelGoal();
        }
        break;
      case "clearPath":
        this._resetPreviewState();
        this._lastSentGoal = null;
        break;
      case "resetNavigationOutcome":
        this._appState.update({ navigationOutcome: defaultNavigationOutcome() });
        break;
      case "destroyMarker":
        this._destroyMarker();
        break;
      case "setPlacementInteraction":
        this._placement.setInteractionPolicy(effect.policy);
        break;
      case "beginOutcomeAnimation":
        this._beginOutcomeAnimation(effect.label);
        break;
      case "stopPlacement":
        this._placement.stop();
        this._placement.detach();
        break;
      default:
        break;
    }
  }

  private _syncAppNavigationState(): void {
    const view = this._viewState();
    const next = deriveAppNavigationState(view);
    const current = this._appState.snapshot;
    if (next === "navigating") {
      if (
        current.navigationState === next &&
        navigationOutcomeIsNone(current.navigationOutcome)
      ) {
        return;
      }
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
    const view = this._viewState();
    if (view && !goalCommitAllowed(view, commitKind)) {
      return false;
    }
    if (commitKind === "stream" && !this._shouldSendGoal(position)) {
      return false;
    }
    const sendToBridge =
      commitKind === "direct"
        ? this._canSendNavigationGoal() || Boolean(config.force)
        : this._canSendNavigationGoal();
    this._previewTarget = {
      position: new vec3(position.x, position.y, position.z),
      rotation,
    };
    this._dispatch({
      kind: "goalCommitRequested",
      config,
      commitKind,
      sendToBridge,
      pose: {
        position: new vec3(position.x, position.y, position.z),
        rotation,
      },
    });
    this._logGoalCommit(commitKind, config.mode, sendToBridge);
    return this._engine.goal !== null;
  }

  private _handleGoalModeChanged(mode: AppStateData["navigationGoalMode"]): void {
    const config = manualNavGoalConfig(mode);
    if (
      this._engine.activeConfig?.mode === config.mode &&
      this._engine.activeConfig?.interactive === config.interactive
    ) {
      return;
    }
    if (this._engine.activeConfig?.interactive) {
      this._dispatch({ kind: "configChanged", config });
    }
  }

  private _handleDragActivated(): void {
    this._applyViewState();
    const pose = this._placement.getCurrentPose();
    const config = this._engine.activeConfig;
    if (!pose || !config || config.mode !== "continuous" || this._engine.goal !== null) {
      return;
    }
    this._requestGoalCommit(pose.position, pose.rotation, "stream", config);
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
    if (!config || config.mode !== "continuous") {
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
    if (!this._session?.isConnected()) {
      return;
    }
    const action = checkNavLifecycleStaleness(this._engine, getTime());
    if (action === "request_resync") {
      this._engine = bumpNavResyncCooldown(this._engine, getTime());
      this._statusClient?.requestStatus();
      this.resyncPreviewGoal();
      return;
    }
    if (action === "recover_local") {
      this._dispatch({ kind: "staleRecovery" });
      this._setOutcome({ kind: "failed", errorCode: null });
    }
  }

  private _setOutcome(outcome: NavigationOutcome): void {
    this._appState.update({ navigationOutcome: outcome });
  }

  private _clearOutcome(): void {
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
    this._previewTarget = {
      position: new vec3(position.x, position.y, position.z),
      rotation,
    };
    const view = this._viewState();
    if (view?.shouldStreamGoal) {
      this._requestGoalCommit(position, rotation, "stream", config);
    }
    if (shouldRequestPreviewOnTargetChange(view)) {
      this._maybeRequestPreview(force, placementActive || !config.interactive);
    }
    this._applyViewState();
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

  /** Returns true when a new marker was created. */
  private _ensureMarkerForGoal(
    position: vec3,
    rotation: quat,
    config: NavGoalConfig,
  ): boolean {
    if (this._marker) {
      if (!config.interactive) {
        this._marker.setPose(position, rotation);
        this._marker.setDragEnabled(false);
        this._bindDisplayOnlyMarkerEvents(this._marker);
      }
      return false;
    }
    const marker = this._spawnMarker();
    marker.setPose(position, rotation);
    marker.setDragEnabled(config.interactive);
    if (!config.interactive) {
      this._bindDisplayOnlyMarkerEvents(marker);
    }
    if (config.interactive && this._engine.activeConfig?.interactive) {
      this._placement.attach(marker);
    }
    this._previewTarget = {
      position: new vec3(position.x, position.y, position.z),
      rotation,
    };
    this._maybeRequestPreview(true, !config.interactive);
    return true;
  }

  public syncIdlePlacementFollow(): void {
    this._syncIdlePlacementPose();
  }

  private _syncIdlePlacementPose(): void {
    if (!this._engine.activeConfig?.interactive) {
      return;
    }
    const view = this._viewState();
    if (view?.placement.followRobot) {
      this._placement.setInteractionPolicy(view.placement);
    }
    if (!this._placement.isIdleFollowingRobot()) {
      return;
    }
    const pose = this._getNavigationPlacementStartPose();
    if (!pose) {
      return;
    }
    this._placement.syncIdlePose(pose.position, pose.rotation);
  }

  private _poseFromWire(
    positionMeters: [number, number, number],
    orientation?: [number, number, number, number],
  ): { position: vec3; rotation: quat } {
    const rotation = orientation
      ? new quat(orientation[3], orientation[0], orientation[1], orientation[2])
      : quat.quatIdentity();
    return {
      position: protocolMetersToLensCentimeters(positionMeters),
      rotation,
    };
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

  private _getRobotFloorY(
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
    const floorY = this._getRobotFloorY(position.y);
    if (floorY === null) {
      return null;
    }
    return new vec3(position.x, floorY, position.z);
  }

  private _resetPreviewState(): void {
    this._previewTarget = null;
    this._bridgePath = null;
    this._previewBasePath = null;
    this._pathRenderer?.clear();
    this._lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
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
        this._navClient?.sendPreviewGoal(
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
    const appState = this._appState.snapshot;
    return (
      (placementActive || !this._engine.activeConfig?.interactive) &&
      bridgeNavigationReady(appState.bridgeSnapshot) &&
      isCapabilityAvailable(appState.robotRuntime, "nav") &&
      isCapabilityAvailable(appState.robotRuntime, "plan_preview")
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

  private _createDragMarker(): NavigationTargetMarker {
    const marker = this._spawnMarker();
    marker.setDragEnabled(true);
    return marker;
  }

  private _beginOutcomeAnimation(label: "Cancelled" | "Failed"): void {
    const config = this._engine.activeConfig;
    if (!config) {
      return;
    }
    this._outcomeAnimating = true;
    this._outcomeLabel = label;
    const markerPose = this._marker
      ? {
          position: this._marker.worldPosition,
          rotation: this._marker.getRotation(),
        }
      : null;
    const view = deriveViewState(
      this._engine,
      {
        placementActive: false,
        activelyDragging: false,
        markerExists: this._marker !== null,
        outcomeAnimating: true,
        outcomeLabel: label,
        markerPose,
      },
      {
        cancelAvailable: this._cancelGoalAvailable,
        confirmAvailable: false,
        sessionActive: true,
      },
    );
    if (view) {
      this._marker?.apply(config, view.marker);
    }
    this._placement.setInteractionPolicy({ dragEnabled: false, followRobot: false });
  }

  private _updatePathHeightRange(): void {
    const robotY = this._getRobotFloorY();
    const goalY = this._marker?.worldPosition.y ?? null;
    if (robotY !== null && goalY !== null) {
      this._pathRenderer.setHeightRange(robotY, goalY);
    }
  }

  private _bindDisplayOnlyMarkerEvents(marker: NavigationTargetMarker): void {
    marker.bindEvents({
      onConfirmTriggerUp: () => {
        const view = this._viewState();
        if (view !== null && (this._engine.goal !== null || this._placement.isPlacementActive())) {
          this.requestCancelGoal();
        }
      },
      onOutcomeResetComplete: () => {
        this._handleOutcomeResetComplete();
      },
    });
  }

  private _handleOutcomeResetComplete(): void {
    this._outcomeAnimating = false;
    this._outcomeLabel = null;
    this._onOutcomeAnimationFinished();
  }

  private _spawnMarker(): NavigationTargetMarker {
    this._destroyMarker();
    const root = this._navigationMarkerPrefab.instantiate(
      this._script.getSceneObject(),
    );
    const marker = root.getComponent(
      NavigationTargetMarker.getTypeName(),
    ) as NavigationTargetMarker | null;
    if (!marker) {
      root.destroy();
      throw new Error(
        "NavigationController: prefab is missing NavigationTargetMarker component",
      );
    }
    marker.ensureReady();
    marker.bindEvents({
      onOutcomeResetComplete: () => {
        this._handleOutcomeResetComplete();
      },
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

  private _onOutcomeAnimationFinished(): void {
    this._dispatch({ kind: "outcomeAnimationFinished" });
    if (this._engine.activeConfig?.interactive && this._placement.isActive()) {
      this._placement.respawnPlacingAt(() => this._getNavigationPlacementStartPose());
    }
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
