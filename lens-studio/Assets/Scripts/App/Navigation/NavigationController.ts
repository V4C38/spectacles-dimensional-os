// ================================================================
/**
 * Navigation controller: placement, marker/path presentation, and bridge I/O.
 * Wire I/O is delegated to NavigationClient; nav rules via NavigationModel.
 */
// ================================================================

import {
  AppState,
  bridgeNavigationReady,
  defaultNavigationError,
  AppStateData,
  NavigationErrorState,
  navigationErrorIsNone,
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
import { NavigationMarker } from "./NavigationMarker";
import { GroundPlacement, RobotGroundDeadzone } from "./GroundPlacement";
import {
  applyNavigationPresentation,
  buildNavigationInputs,
  createWorldMeshHintState,
  NavigationPathRenderer,
  planNavStatusEvent,
  resetWorldMeshHint,
  shouldStreamGoalNow,
  type WorldMeshHintState,
} from "./NavigationPresentation";
import { Signal } from "../Utilities/Utilities";
import {
  applyNavigationEvent,
  bumpNavResyncCooldown,
  checkNavLifecycleStaleness,
  createInitialNavigationSession,
  deriveNavigationState,
  idleAnchorEnabled,
  resolveRetryableNavIntent,
  shouldSendStreamGoal,
  shouldSkipStaleLocalRecovery,
  shouldSuppressTerminalNavState,
  GOAL_SEND_INTERVAL_S,
  GOAL_SEND_MIN_DISTANCE_CM,
  touchNavStatus,
  type NavigationSession,
  type NavigationEffect,
  type NavigationEvent,
} from "../../ARBridge/Navigation/NavigationModel";

const GOAL_COMMIT_LOG_INTERVAL_S = 2.0;
const GOAL_SEND_BLOCKED_LOG_INTERVAL_S = 2.0;

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
  deviceTracking: DeviceTracking;
  worldMeshObject: SceneObject;
  worldMeshVisual: RenderMeshVisual;
};

export class NavigationController {
  public readonly onNavigationResolved = new Signal<"succeeded" | "failed">();

  private _cancelGoalAvailable = true;
  private _navSession: NavigationSession = createInitialNavigationSession();
  private _lastSentGoal: { position: vec3; rotation: quat } | null = null;
  private _lastGoalSendTime = -GOAL_SEND_INTERVAL_S;

  private _navWatchdogEvent: SceneEvent | null = null;
  private _hostBound = false;
  private _placementDeferralEvent: DelayedCallbackEvent | null = null;
  private _lastGoalCommitLogTime = -1;

  private _marker: NavigationMarker | null = null;
  private _bridgePath: vec3[] | null = null;

  private _protocolParseFailureCount = 0;
  private _uiLogger: UILogger | null = null;
  private _lastGoalSendBlockedLogTime = -GOAL_SEND_BLOCKED_LOG_INTERVAL_S;
  private _worldMeshHintState: WorldMeshHintState = createWorldMeshHintState();
  private readonly _worldMeshObject: SceneObject;
  private readonly _worldMeshVisual: RenderMeshVisual;

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
    private readonly _deviceTracking: DeviceTracking,
    worldMeshObject: SceneObject,
    worldMeshVisual: RenderMeshVisual,
    private readonly _robotGroundDeadzoneRadiusCm: number,
    private readonly _getLastPose: () => PoseMessage | null,
  ) {
    this._worldMeshObject = worldMeshObject;
    this._worldMeshVisual = worldMeshVisual;
    this._placement.onDragActivated = () => this._handleDragActivated();
    this._placement.onPresentationSync = () => this._applyPresentation();
    this._placement.onMarkerButtonPressed = () => {
      if (this._navSession.goal !== null || this._placement.isPlacementActive()) {
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
    const placement = new GroundPlacement(deps.eventHost, deps.deviceTracking);
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
      deps.deviceTracking,
      deps.worldMeshObject,
      deps.worldMeshVisual,
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
    if (this._navSession.navSessionActive && this._placement.isActive()) {
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
    this._dispatch({ kind: "sessionOn" });
  }

  public disarm(): void {
    if (!this._navSession.navSessionActive) {
      return;
    }
    this._log("nav disarm");
    this._dispatch({ kind: "sessionOff" });
    this._placement.stop();
    this._placement.detach();
    this._destroyMarker();
    this._clearPathState();
  }

  public cancelGoal(): void {
    this.requestCancelGoal();
  }

  public get placementEnabled(): boolean {
    return this._navSession.navSessionActive;
  }

  public syncNavigationForOperatingMode(
    mode: AppStateData["operatingMode"],
    _state: AppStateData,
  ): void {
    if (mode === "registrationMode") {
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
    if (state.navigationState === "navigating" && this._navSession.goal !== null) {
      return;
    }
    const navModeArmed =
      state.operatingMode === "manual" || state.operatingMode === "agent";
    const canMaintain =
      navModeArmed &&
      state.phase === "runtime" &&
      state.robotInteractionMode === "runtimeRobot" &&
      isCapabilityAvailable(state.robotRuntime, "nav");
    const wantsArmed =
      Boolean(opts?.forceEnable) ||
      (navigationPlacementToggleEnabled(state) && canMaintain);

    if (wantsArmed && canMaintain) {
      if (this._navSession.navSessionActive) {
        this._syncIdlePlacementPose();
        return;
      }
      this.arm();
      return;
    }
    if (this._navSession.navSessionActive) {
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
    this._robotMarker?.setPathGoal(waypoints?.[waypoints.length - 1] ?? null);
    this._dispatch({ kind: "pathReceived" });
  }

  public applyNavStatus(msg: NavStatusMessage): void {
    this._protocolParseFailureCount = 0;
    this._navSession = touchNavStatus(this._navSession, getTime());
    const hadTrackedGoal = this._navSession.goal !== null;
    const plan = planNavStatusEvent(
      this._navSession,
      msg,
      this._shouldSuppressTerminalNavState(),
    );
    if (plan.kind === "continuePlacement") {
      this._continuePlacementNavigation();
    } else {
      this._dispatch(plan.event);
    }
    this._applyAgentGoalFromNavStatus(msg);
    if (msg.state === "navIntent" && msg.retryable) {
      return;
    }
    if (msg.state === "resolved" && msg.outcome === "succeeded") {
      if (hadTrackedGoal) {
        this.onNavigationResolved.emit("succeeded");
      }
      return;
    }
    if (msg.state === "resolved" && msg.outcome === "failed") {
      if (hadTrackedGoal) {
        this.onNavigationResolved.emit("failed");
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
    if (this._navSession.presentation.kind !== "resolved") {
      return;
    }
    this._dispatch({ kind: "presentationCleared" });
  }

  public clearForDisconnect(): void {
    this.clearInactiveState();
    this._protocolParseFailureCount = 0;
    this._placement.stop();
    this._placement.detach();
    this._destroyMarker();
    this._clearPathState();
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
    this._applyPresentation();
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
  }

  public setCancelGoalAvailability(available: boolean, _reason: string | null = null): void {
    this._cancelGoalAvailable = available;
    this._applyPresentation();
  }

  public syncIdleNavigationPlacement(snap: boolean = false): void {
    this._syncIdlePlacementPose(snap);
  }

  private _applyPresentation(): void {
    applyNavigationPresentation({
      placement: this._placement,
      marker: this._marker,
      pathRenderer: this._pathRenderer,
      bridgePath: this._bridgePath,
      session: this._navSession,
      cancelAvailable: this._cancelGoalAvailable,
      appState: this._appState,
      robotFloorPosition: this._getRobotFloorPosition(),
      worldMeshObject: this._worldMeshObject,
      worldMeshVisual: this._worldMeshVisual,
      worldMeshHintState: this._worldMeshHintState,
      placementBlockReason: this._placement.getPlacementBlockReason(),
    });
  }

  private _dispatch(event: NavigationEvent): void {
    const result = applyNavigationEvent(this._navSession, event, getTime());
    this._navSession = result.state;
    for (const effect of result.wireEffects) {
      this._applyWireEffect(effect);
    }
    this._applySessionEventSideEffects(event);
    this._applyPresentation();
  }

  private _applyWireEffect(effect: NavigationEffect): void {
    switch (effect.kind) {
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
      case "sendCancelGoal":
        if (this._cancelGoalAvailable && this._canSendNavigationGoal()) {
          this._navClient?.sendCancelGoal();
        }
        break;
      default:
        break;
    }
  }

  private _applySessionEventSideEffects(event: NavigationEvent): void {
    switch (event.kind) {
      case "commitGoal":
        this._appState.update({ navigationError: defaultNavigationError() });
        break;
      case "navStatus":
        if (event.state === "navIntent" && event.retryable) {
          this._handleRetryableNavIntent();
        } else if (event.state === "resolved") {
          this._clearPathState();
          this._lastSentGoal = null;
          if (!this._placement.isActivelyDragging()) {
            this._placement.resetToIdleAnchoring();
            if (event.outcome === "succeeded") {
              this._syncIdlePlacementPose(true);
            }
          }
        }
        break;
      case "cancelRequested":
      case "estopRequested":
      case "watchdogFailed":
        this._clearPathState();
        this._lastSentGoal = null;
        if (!this._placement.isActivelyDragging()) {
          this._placement.resetToIdleAnchoring();
        }
        break;
      case "disconnect":
      case "sessionOff":
        resetWorldMeshHint(
          this._worldMeshHintState,
          this._worldMeshObject,
          this._worldMeshVisual.mainMaterial.mainPass as any,
        );
        break;
      default:
        break;
    }
  }

  private _requestGoalCommit(
    position: vec3,
    rotation: quat,
    force: boolean = false,
  ): boolean {
    const inputs = buildNavigationInputs(
      this._placement,
      this._marker,
      this._cancelGoalAvailable,
    );
    if (
      shouldStreamGoalNow(this._navSession, inputs) &&
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
      kind: "commitGoal",
      sendToBridge,
      pose: {
        position: new vec3(position.x, position.y, position.z),
        rotation,
      },
    });
    this._logGoalCommit(sendToBridge);
    return this._navSession.goal !== null;
  }

  private _handleDragActivated(): void {
    this._applyPresentation();
    const pose = this._placement.getCurrentPose();
    if (!pose) {
      return;
    }
    // Latest-wins takeover: a drag during an active (user or agent) goal commits a
    // new user goal without an explicit cancel.
    this._requestGoalCommit(pose.position, pose.rotation, true);
  }

  private _handleRetryableNavIntent(): void {
    const action = resolveRetryableNavIntent(
      this._navSession,
      this._shouldSuppressTerminalNavState(),
    );
    if (action === "holdNavIntent") {
      this._continuePlacementNavigation();
      return;
    }
    if (action === "holdNavigating") {
      return;
    }
    if (!this._placement.isActivelyDragging()) {
      this._placement.resetToIdleAnchoring();
    }
  }

  private _shouldSuppressTerminalNavState(): boolean {
    const pose = this._placement.getCurrentPose();
    const markerMoved =
      pose !== null &&
      this._lastSentGoal !== null &&
      pose.position.distance(this._lastSentGoal.position) >= GOAL_SEND_MIN_DISTANCE_CM;
    return shouldSuppressTerminalNavState({
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
    const action = checkNavLifecycleStaleness(this._navSession, getTime());
    if (action === "request_resync") {
      this._navSession = bumpNavResyncCooldown(this._navSession, getTime());
      this._statusClient?.requestStatus();
      return;
    }
    if (action === "recover_local") {
      const pathWaypointCount = this._bridgePath?.length ?? 0;
      if (shouldSkipStaleLocalRecovery(this._navSession, pathWaypointCount)) {
        return;
      }
      this._dispatch({ kind: "watchdogFailed" });
      this._setNavigationError({ kind: "failed", errorCode: null });
    }
  }

  private _setNavigationError(error: NavigationErrorState): void {
    this._appState.update({ navigationError: error });
  }

  private _clearOutcome(): void {
    if (navigationErrorIsNone(this._appState.snapshot.navigationError)) {
      return;
    }
    this._appState.update({ navigationError: defaultNavigationError() });
  }

  private _disableNavRuntime(errorCode: number): void {
    const appState = this._appState.snapshot;
    const capabilities = {
      ...appState.robotRuntime.capabilities,
      nav: { available: false, reason: `Bridge Error (${errorCode})` },
    };
    const runtimeState: RobotRuntimeState = { ...appState.robotRuntime, capabilities };
    this._appState.update({
      navigationError: { kind: "failed", errorCode },
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
    if (!this._navSession.navSessionActive) {
      return;
    }
    const inputs = buildNavigationInputs(
      this._placement,
      this._marker,
      this._cancelGoalAvailable,
    );
    if (shouldStreamGoalNow(this._navSession, inputs)) {
      this._requestGoalCommit(position, rotation, force);
    }
    this._applyPresentation();
  }

  private _createDragMarker(): NavigationMarker {
    this._destroyMarker();
    const root = this._navigationMarkerPrefab.instantiate(
      this._script.getSceneObject(),
    );
    const marker = root.getComponent(
      NavigationMarker.getTypeName(),
    ) as NavigationMarker | null;
    if (!marker) {
      root.destroy();
      throw new Error(
        "NavigationController: prefab is missing NavigationMarker component",
      );
    }
    marker.ensureReady();
    marker.setDragEnabled(true);
    marker.bindEvents({
      onOutcomeResetComplete: () => {
        this._handleOutcomeResetComplete();
      },
      onConfirmTriggerUp: () => {
        if (this._navSession.goal !== null || this._placement.isPlacementActive()) {
          this.requestCancelGoal();
        }
      },
    });
    this._marker = marker;
    return marker;
  }

  private _syncIdlePlacementPose(snap: boolean = false): void {
    if (!this._navSession.navSessionActive) {
      return;
    }
    if (this._placement.isActivelyDragging()) {
      return;
    }
    const navigationState = deriveNavigationState(
      this._navSession,
      buildNavigationInputs(this._placement, this._marker, this._cancelGoalAvailable),
    );
    this._placement.setIdleAnchor(idleAnchorEnabled(navigationState));
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

  private _applyAgentGoalFromNavStatus(msg: NavStatusMessage): void {
    const goal = msg.goal;
    if (goal?.source !== "agent" || this._placement.isActivelyDragging()) {
      return;
    }
    if (!this._navSession.navSessionActive) {
      this.syncManualNavigationState({ forceEnable: true });
    }
    if (!this._placement.isActive()) {
      return;
    }
    const position = protocolMetersToLensCentimeters(goal.position);
    const q = goal.orientation;
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    this._placement.applyAuthoritativePose(position, rotation);
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
    if (!this._navSession.navSessionActive) {
      return false;
    }
    return this._navSession.goal !== null || this._placement.isPlacementActive();
  }

  private _clearPathState(): void {
    this._bridgePath = null;
    this._robotMarker?.setPathGoal(null);
    this._pathRenderer?.clear();
  }

  private _handleOutcomeResetComplete(): void {
    this._dispatch({ kind: "resolvedPresentationFinished" });
    this._syncIdlePlacementPose(true);
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
