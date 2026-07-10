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
  navigationOutcomeIsNone,
  navigationPlacementToggleEnabled,
  RobotRuntimeState,
  toSessionState,
} from "../AppState";
import { AppStateStore } from "../AppState";
import { COLOR_ERROR } from "../UI/UIKit";
import { UILogger } from "../UI/UILogger";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotPresenter } from "../Robot/RobotPresenter";
import {
  NavStatusMessage,
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
import { Signal } from "../Utilities/Utilities";
import {
  applyNavigationEvent,
  bumpNavResyncCooldown,
  checkNavLifecycleStaleness,
  createInitialNavEngineState,
  deriveAppNavigationState,
  deriveViewState,
  shouldSendStreamGoal,
  shouldSuppressTerminalNavStatus,
  GOAL_SEND_INTERVAL_S,
  GOAL_SEND_MIN_DISTANCE_CM,
  touchNavStatus,
  type NavEngineState,
  type NavigationEffect,
  type NavigationEvent,
} from "../../ARBridge/Navigation/NavigationModel";

const GOAL_COMMIT_LOG_INTERVAL_S = 2.0;
const GOAL_SEND_BLOCKED_LOG_INTERVAL_S = 2.0;

const WorldQueryModule = require("LensStudio:WorldQueryModule");

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
  public readonly onNavigationSettled = new Signal<"succeeded" | "failed">();

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

  private _protocolParseFailureCount = 0;
  private _uiLogger: UILogger | null = null;
  private _lastGoalSendBlockedLogTime = -GOAL_SEND_BLOCKED_LOG_INTERVAL_S;

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
    this._placement.onMarkerButtonPressed = () => {
      if (this._engine.goal !== null || this._placement.isPlacementActive()) {
        this.requestCancelGoal();
      }
    };
    this._placement.onPreviewTargetChanged = (pos, rot, _active, force) =>
      this._handleTargetChanged(pos, rot, force);

    this._placement.setRobotGroundDeadzone({
      radiusCm: _robotGroundDeadzoneRadiusCm,
      getRobotWorldPosition: () => this._robotMarker?.getWorldPosition() ?? null,
      getRobotFloorWorldY: () => this._getRobotFloorY(),
    } as RobotGroundDeadzone);
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
    this._uiLogger = deps.appStateStore.uiLogger;
    deps.appStateStore.subscribe((state) => this.applyRuntimeState(state.robotRuntime));
    const placementDeferral = this._script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    placementDeferral.bind(() => this.syncManualNavigationState());
    this._placementDeferralEvent = placementDeferral;
    this.startWatchdog();
  }

  public deferPlacementSync(): void {
    this._placementDeferralEvent?.reset(0.0);
  }

  public arm(): void {
    if (this._engine.armed && this._placement.isActive()) {
      return;
    }
    if (!this._canStartManualNavigation()) {
      return;
    }
    const initialPose = this._getNavigationPlacementStartPose();
    if (!initialPose) {
      return;
    }
    this._clearPathState();
    this._pathRenderer.clear();
    const marker = this._createDragMarker();
    this._placement.attach(marker);
    this._placement.start(initialPose.position, initialPose.rotation);
    this._log("nav arm");
    this._dispatch({ kind: "arm" });
  }

  public disarm(): void {
    if (!this._engine.armed) {
      return;
    }
    this._log("nav disarm");
    this._dispatch({ kind: "disarm" });
  }

  public cancelGoal(): void {
    this.requestCancelGoal();
  }

  public get placementEnabled(): boolean {
    return this._engine.armed;
  }

  public syncManualNavigationForOperatingMode(
    mode: AppStateData["operatingMode"],
    _state: AppStateData,
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
      if (this._engine.armed) {
        this._syncIdlePlacementPose();
        return;
      }
      this.arm();
      return;
    }
    if (this._engine.armed) {
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

    this._updatePathHeightRange();
    this._bridgePath = waypoints;
    if (this._engine.goal !== null) {
      this._dispatch({ kind: "navigating" });
      return;
    }
    this._applyViewState();
  }

  public applyNavStatus(msg: NavStatusMessage): void {
    this._protocolParseFailureCount = 0;
    this._engine = touchNavStatus(this._engine, getTime());
    const hadTrackedGoal = this._engine.goal !== null;
    const navLabel = this._applyNavStatusInner(msg);
    if (msg.phase === "recovering") {
      return;
    }
    if (navLabel === "Goal reached") {
      if (hadTrackedGoal) {
        this.onNavigationSettled.emit("succeeded");
      }
      return;
    }
    if (navLabel === "Goal failed") {
      if (hadTrackedGoal) {
        this.onNavigationSettled.emit("failed");
      }
      if (msg.error_code !== undefined) {
        this._disableNavRuntime(msg.error_code);
      }
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
    if (!this._outcomeAnimating) {
      return;
    }
    this._outcomeAnimating = false;
    this._outcomeLabel = null;
    this._applyViewState();
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
    if (!this._canCancelLocally()) {
      return;
    }
    this._log("nav goal cancel requested");
    this._dispatch({ kind: "cancelRequested" });
    if (this._cancelGoalAvailable && this._canSendNavigationGoal()) {
      this._navClient?.sendCancelGoal();
    }
  }

  public setCancelGoalAvailability(available: boolean, _reason: string | null = null): void {
    this._cancelGoalAvailable = available;
    this._applyViewState();
  }

  public syncIdleNavigationPlacement(snap: boolean = false): void {
    this._syncIdlePlacementPose(snap);
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
        sessionActive: this._engine.armed,
      },
    );
  }

  private _applyViewState(): void {
    if (!this._engine.armed || this._outcomeAnimating) {
      return;
    }
    if (!this._marker) {
      return;
    }

    const markerPose = {
      position: this._marker.worldPosition,
      rotation: this._marker.getRotation(),
    };

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
        sessionActive: this._engine.armed,
      },
    );
    if (!view) {
      return;
    }

    this._marker.apply(view.marker);
    this._placement.setInteractionPolicy(view.placement);

    if (!view.path) {
      this._pathRenderer?.clear();
      return;
    }

    const robotPosition = this._getRobotFloorPosition() ?? null;
    const goalPosition =
      this._placement.getRenderedPosition() ??
      this._marker.worldPosition ??
      null;
    if (!robotPosition || !goalPosition) {
      this._pathRenderer?.clear();
      return;
    }
    this._pathRenderer.setHeightRange(robotPosition.y, goalPosition.y);

    if (!this._bridgePath || this._bridgePath.length < 2) {
      this._pathRenderer?.clear();
      return;
    }
    this._pathRenderer.setLensPath(this._bridgePath);
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
        if (pose && this._canSendNavigationGoal()) {
          this._navClient?.sendNavGoal(pose.position, pose.rotation);
          this._lastSentGoal = {
            position: new vec3(pose.position.x, pose.position.y, pose.position.z),
            rotation: pose.rotation,
          };
          this._lastGoalSendTime = getTime();
        } else if (pose) {
          this._logGoalSendBlocked();
        }
        break;
      }
      case "resumeIdleAnchoring":
        if (!this._placement.isActivelyDragging()) {
          this._placement.resetToIdleAnchoring();
        }
        break;
      case "sendCancelGoal":
        if (this._cancelGoalAvailable && this._canSendNavigationGoal()) {
          this._navClient?.sendCancelGoal();
        }
        break;
      case "clearPath":
        this._clearPathState();
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
    force: boolean = false,
  ): boolean {
    const view = this._viewState();
    if (
      view?.shouldStreamGoal &&
      !shouldSendStreamGoal(
        getTime(),
        this._lastGoalSendTime,
        position,
        this._lastSentGoal,
        force,
      )
    ) {
      return false;
    }
    const sendToBridge = this._canSendNavigationGoal();
    this._dispatch({
      kind: "goalCommitRequested",
      sendToBridge,
      pose: {
        position: new vec3(position.x, position.y, position.z),
        rotation,
      },
    });
    this._logGoalCommit(sendToBridge);
    return this._engine.goal !== null;
  }

  private _handleDragActivated(): void {
    this._applyViewState();
    const pose = this._placement.getCurrentPose();
    if (!pose || this._engine.goal !== null) {
      return;
    }
    this._requestGoalCommit(pose.position, pose.rotation);
  }

  private _applyNavStatusInner(msg: NavStatusMessage): string {
    if (msg.phase === "recovering") {
      if (msg.retryable) {
        if (this._shouldSuppressTerminalNavStatus()) {
          this._continuePlacementNavigation();
        } else {
          this._dispatch({ kind: "navStatusRecovering" });
        }
      }
      return "Recovering";
    }
    if (msg.phase === "succeeded" || msg.phase === "failed") {
      if (this._engine.goal === null) {
        return "Idle";
      }
      if (msg.phase === "succeeded") {
        if (this._shouldSuppressTerminalNavStatus()) {
          this._continuePlacementNavigation();
          return "Goal reached (streaming)";
        }
        this._dispatch({ kind: "navStatusGoalReached" });
        return "Goal reached";
      }
      if (this._shouldSuppressTerminalNavStatus()) {
        this._continuePlacementNavigation();
        return "Goal failed (suppressed)";
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

  private _shouldSuppressTerminalNavStatus(): boolean {
    const pose = this._placement.getCurrentPose();
    const markerMoved =
      pose !== null &&
      this._lastSentGoal !== null &&
      pose.position.distance(this._lastSentGoal.position) >= GOAL_SEND_MIN_DISTANCE_CM;
    return shouldSuppressTerminalNavStatus({
      placementActive: this._placement.isPlacementActive(),
      activelyDragging: this._placement.isActivelyDragging(),
      markerMovedSinceLastGoal: markerMoved,
    });
  }

  private _continuePlacementNavigation(): void {
    this.cancelOutcome();
    const pose = this._placement.getCurrentPose();
    if (pose) {
      this._requestGoalCommit(pose.position, pose.rotation, true);
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

  private _handleTargetChanged(
    position: vec3,
    rotation: quat,
    force: boolean,
  ): void {
    if (!this._engine.armed) {
      return;
    }
    const view = this._viewState();
    if (view?.shouldStreamGoal) {
      this._requestGoalCommit(position, rotation, force);
    }
    this._applyViewState();
  }

  private _createDragMarker(): NavigationTargetMarker {
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
    marker.setDragEnabled(true);
    marker.bindEvents({
      onOutcomeResetComplete: () => {
        this._handleOutcomeResetComplete();
      },
      onConfirmTriggerUp: () => {
        const view = this._viewState();
        if (view !== null && (this._engine.goal !== null || this._placement.isPlacementActive())) {
          this.requestCancelGoal();
        }
      },
    });
    this._marker = marker;
    return marker;
  }

  private _syncIdlePlacementPose(snap: boolean = false): void {
    if (!this._engine.armed) {
      return;
    }
    if (this._placement.isActivelyDragging()) {
      return;
    }
    const view = this._viewState();
    if (view?.placement.followRobot) {
      this._placement.setInteractionPolicy(view.placement);
    }
    if (!this._placement.isIdleNavigation()) {
      return;
    }
    const pose = this._getNavigationPlacementStartPose();
    if (!pose) {
      return;
    }
    if (snap) {
      this._placement.snapIdlePose(pose.position, pose.rotation);
    } else {
      this._placement.syncIdlePose(pose.position, pose.rotation);
    }
  }

  private _logGoalSendBlocked(): void {
    if (!this._uiLogger) {
      return;
    }
    const now = getTime();
    if (now - this._lastGoalSendBlockedLogTime < GOAL_SEND_BLOCKED_LOG_INTERVAL_S) {
      return;
    }
    this._lastGoalSendBlockedLogTime = now;
    const message = "Cannot send goal — robot not connected";
    this._uiLogger.logConsole(message, COLOR_ERROR);
    this._uiLogger.show(message, COLOR_ERROR, 2.0);
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

  private _canCancelLocally(): boolean {
    if (!this._engine.armed) {
      return false;
    }
    return this._engine.goal !== null || this._placement.isPlacementActive();
  }

  private _clearPathState(): void {
    this._bridgePath = null;
    this._pathRenderer?.clear();
  }

  private _beginOutcomeAnimation(label: "Cancelled" | "Failed"): void {
    if (!this._engine.armed) {
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
        sessionActive: true,
      },
    );
    if (view) {
      this._marker?.apply(view.marker);
    }
    this._placement.setInteractionPolicy({ dragEnabled: false, followRobot: false });
  }

  private _handleOutcomeResetComplete(): void {
    this._outcomeAnimating = false;
    this._outcomeLabel = null;
    this._onOutcomeAnimationFinished();
  }

  private _onOutcomeAnimationFinished(): void {
    this._dispatch({ kind: "outcomeAnimationFinished" });
  }

  private _updatePathHeightRange(): void {
    const robotY = this._getRobotFloorY();
    const goalY = this._marker?.worldPosition.y ?? null;
    if (robotY !== null && goalY !== null) {
      this._pathRenderer.setHeightRange(robotY, goalY);
    }
  }

  private _destroyMarker(): void {
    if (!this._marker) {
      return;
    }
    this._marker.destroy();
    this._marker = null;
  }

  private _logGoalCommit(sendToBridge: boolean): void {
    const now = getTime();
    if (
      this._lastGoalCommitLogTime >= 0 &&
      now - this._lastGoalCommitLogTime < GOAL_COMMIT_LOG_INTERVAL_S
    ) {
      return;
    }
    this._lastGoalCommitLogTime = now;
    this._log(`nav goal commit sent=${sendToBridge}`);
  }

  private _log(message: string): void {
    print(`NavigationController: ${message}`);
  }
}
