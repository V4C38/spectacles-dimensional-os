// ================================================================
/**
 * Owns all navigation subsystem objects and policy: PlacementController,
 * NavigationController, PathRenderer, NavigationMarkerView,
 * NavigationOutcomeTracker, the lifecycle watchdog, and the gating logic
 * that decides when placement/goals can be activated or stopped.
 *
 * DimosManager constructs this coordinator and delegates bridge-handler
 * calls plus public navigation actions to it.
 */
// ================================================================

import { BridgeClient } from "../Network/BridgeClient";
import { RobotMarker } from "../Visuals/RobotMarker";
import { PathRenderer } from "../Visuals/PathRenderer";
import { NavigationMarkerView } from "./NavigationMarkerView";
import { PlacementController, RobotGroundDeadzone } from "./PlacementController";
import { NavigationOutcomeTracker } from "./NavigationOutcomeTracker";
import { NavigationController } from "./NavigationController";
import {
  DimosAppState,
  NavigationMode,
  RobotRuntimeState,
  robotFloorWorldYCm,
} from "../AppState";
import {
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  ProtocolParseError,
  protocolMetersToLensCentimeters,
  PoseMessage,
} from "../Network/Protocol";
import { runtimeDeadzoneRadiusCm } from "../Robot/RobotRuntime";

const WorldQueryModule = require("LensStudio:WorldQueryModule");

export interface NavigationCoordinatorDeps {
  scriptComponent: BaseScriptComponent;
  bridgeClient: BridgeClient | null;
  robotMarker: RobotMarker | null;
  placementRayOrigin: SceneObject | null;
  navigationMarkerRoot: SceneObject;
  pathParent: SceneObject;
  robotGroundDeadzoneRadiusCm: number;
  getAppState: () => DimosAppState;
  setAppState: (patch: Partial<DimosAppState>) => void;
  isCapabilityAvailable: (cap: string) => boolean;
  capabilityUnavailableReason: (cap: string) => string | null;
  getIsActive: () => boolean;
  getLastPose: () => PoseMessage | null;
  hasBridgeConnection: () => boolean;
  onRuntimeStateChanged: (state: RobotRuntimeState) => void;
}

export class NavigationCoordinator {
  private readonly _goalRenderer: NavigationMarkerView;
  private readonly _pathRenderer: PathRenderer;
  private readonly _placementController: PlacementController;
  private readonly _navigationController: NavigationController;
  private readonly _outcomeTracker: NavigationOutcomeTracker;
  private _navWatchdogEvent: SceneEvent | null = null;
  private _protocolParseFailureCount = 0;

  constructor(private readonly _deps: NavigationCoordinatorDeps) {
    this._goalRenderer = new NavigationMarkerView(_deps.navigationMarkerRoot);
    this._pathRenderer = new PathRenderer(_deps.pathParent);
    this._placementController = new PlacementController(
      _deps.scriptComponent,
      WorldQueryModule,
      _deps.placementRayOrigin,
      this._goalRenderer,
    );
    this._placementController.setRobotGroundDeadzone({
      radiusCm: _deps.robotGroundDeadzoneRadiusCm,
      getRobotWorldPosition: () => _deps.robotMarker?.getWorldPosition() ?? null,
    } as RobotGroundDeadzone);

    this._navigationController = new NavigationController({
      bridgeClient: _deps.bridgeClient,
      goalRenderer: this._goalRenderer,
      pathRenderer: this._pathRenderer,
      placementController: this._placementController,
      onNavigationModeChanged: (mode) => this._setNavigationMode(mode),
      canStartPlacement: () => this._canStartNavigationPlacement(),
      canSendNavGoal: () => this._canSendNavigationGoal(),
      getRobotFloorPosition: () => this._robotFloorPosition(),
      getGoalResetPose: () => this._getNavigationPlacementStartPose(),
    });

    this._outcomeTracker = new NavigationOutcomeTracker(
      (callback) => {
        const event = _deps.scriptComponent.createEvent(
          "DelayedCallbackEvent",
        ) as DelayedCallbackEvent;
        event.bind(callback);
        return event;
      },
      () => (_deps.getAppState() as any).navigationOutcome,
      (outcome) => _deps.setAppState({ navigationOutcome: outcome } as any),
    );
  }

  // ── Bridge event handlers ──────────────────────────────────────

  public startWatchdog(): void {
    if (this._navWatchdogEvent) {
      return;
    }
    const event = this._deps.scriptComponent.createEvent("UpdateEvent");
    event.bind(() => this._tickNavLifecycleWatchdog());
    this._navWatchdogEvent = event;
  }

  public applyPath(msg: PathMessage): void {
    const robotY = this._robotFloorY();
    const goalY = this._goalRenderer?.worldPosition.y ?? null;
    if (robotY !== null && goalY !== null) {
      this._pathRenderer?.setHeightRange(robotY, goalY);
    }
    this._navigationController?.applyPath(msg);
  }

  public applyPathPreview(msg: PathPreviewMessage): void {
    this._navigationController?.applyPathPreview(msg);
  }

  public applyNavStatus(msg: NavStatusMessage): void {
    this._protocolParseFailureCount = 0;
    const navLabel = this._navigationController?.applyNavStatus(msg) ?? "Idle";

    if (msg.recovering) {
      this._outcomeTracker?.clear();
      return;
    }

    if (navLabel === "Goal reached") {
      this._outcomeTracker?.set("success");
      return;
    }

    if (navLabel === "Goal failed") {
      if (msg.error_code !== undefined) {
        this._disableNavRuntime(msg.error_code);
        return;
      }
      this._outcomeTracker?.set("failed");
    }
  }

  public handleProtocolError(error: ProtocolParseError): void {
    this._protocolParseFailureCount += 1;
    if (this._protocolParseFailureCount < 3) {
      return;
    }
    if (this._deps.getAppState().navigationMode !== "executingGoal") {
      return;
    }
    this._log(
      `protocol ${error.kind} failures while navigating (${this._protocolParseFailureCount}); awaiting resync`,
    );
  }

  // ── Lifecycle / state coordination ────────────────────────────

  /** Cancel any pending outcome flash (called on hello). */
  public cancelOutcome(): void {
    this._outcomeTracker?.cancel();
  }

  /** Clear nav state on bridge disconnect (called from _applyConnectionState). */
  public clearForDisconnect(): void {
    this._navigationController?.clearInactiveState();
    this._protocolParseFailureCount = 0;
    this._outcomeTracker?.cancel();
  }

  /** Full nav reset on user-initiated disconnect (called from disconnect()). */
  public resetForUserDisconnect(): void {
    this._outcomeTracker?.clear();
    this._setNavigationMode("idle");
    this._navigationController?.clearInactiveState();
  }

  /** Sync placement enabled/disabled against current gating conditions. */
  public syncPlacementState(): void {
    this._syncNavigationPlacementState();
  }

  /** Called when DimosManager.setNavigationPlacementEnabled changes. */
  public onPlacementEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      const appState = this._deps.getAppState();
      const stopActiveNavigation =
        appState.operatingMode === "manual" &&
        appState.navigationMode === "executingGoal";
      if (stopActiveNavigation) {
        if (this._deps.isCapabilityAvailable("emergency_stop")) {
          this._log("setNavigationPlacementEnabled: stopping active navigation via emergency stop");
          this._navigationController?.requestEmergencyStop();
        } else if (this._deps.isCapabilityAvailable("cancel_goal")) {
          this._log("setNavigationPlacementEnabled: stopping active navigation via cancel goal");
          this._navigationController?.requestCancelGoal();
        }
      }
      this._navigationController?.setPlacementEnabled(false);
      this._setNavigationMode("idle");
      return;
    }
    this._syncNavigationPlacementState();
  }

  /** Apply nav-specific parts of a runtime state update (deadzone, availability, placement sync). */
  public applyRuntimeState(state: RobotRuntimeState): void {
    if (!state.capabilities.nav?.available && this._deps.getAppState().navigationPlacementEnabled) {
      this._deps.setAppState({ navigationPlacementEnabled: false });
    }
    this._placementController?.setRobotGroundDeadzone({
      radiusCm: runtimeDeadzoneRadiusCm(state, this._deps.robotGroundDeadzoneRadiusCm),
      getRobotWorldPosition: () => this._deps.robotMarker?.getWorldPosition() ?? null,
    } as RobotGroundDeadzone);
    this._navigationController?.setCancelGoalAvailability(
      this._deps.isCapabilityAvailable("cancel_goal"),
      this._deps.capabilityUnavailableReason("cancel_goal"),
    );
    this._navigationController?.setGoalConfirmAvailability(
      this._canConfirmNavigationGoal(),
    );
    this._syncNavigationPlacementState();
  }

  public requestEmergencyStop(): void {
    if (!this._deps.isCapabilityAvailable("emergency_stop")) {
      return;
    }
    this._log("requestEmergencyStop");
    this._navigationController?.requestEmergencyStop();
  }

  /** Set navigation mode (public entry-point for DimosManager, e.g. enterSetup). */
  public setNavigationMode(mode: NavigationMode): void {
    this._setNavigationMode(mode);
  }

  /** Expose placement gating result for callers that need to pre-disable (setLidarMode, setOperatingMode). */
  public canStartPlacement(): boolean {
    return this._canStartNavigationPlacement();
  }

  public setPlacementEnabled(enabled: boolean): void {
    this._navigationController?.setPlacementEnabled(enabled);
  }

  public get placementEnabled(): boolean {
    return this._navigationController?.placementEnabled ?? false;
  }

  public clearInactiveState(): void {
    this._navigationController?.clearInactiveState();
  }

  // ── Private implementation ─────────────────────────────────────

  private _tickNavLifecycleWatchdog(): void {
    if (!this._navigationController || !this._deps.hasBridgeConnection()) {
      return;
    }
    const action = this._navigationController.checkNavLifecycleStaleness();
    if (action === "request_resync") {
      this._log("nav lifecycle stale; requesting bridge status resync");
      this._deps.bridgeClient?.requestStatus();
      return;
    }
    if (action === "recover_local") {
      this._log("nav lifecycle stale after resync; recovering locally");
      this._navigationController.recoverFromStaleExecution();
      this._outcomeTracker?.set("failed");
    }
  }

  private _disableNavRuntime(errorCode: number): void {
    const appState = this._deps.getAppState();
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
    this._outcomeTracker?.cancel();
    this._deps.setAppState({
      navRuntimeErrorCode: errorCode,
      navigationOutcome: "failed",
      robotRuntime: runtimeState,
    } as any);
    this._outcomeTracker?.scheduleFlash();
    this._deps.onRuntimeStateChanged(runtimeState);
  }

  private _canStartNavigationPlacement(): boolean {
    const state = this._deps.getAppState();
    if (state.operatingMode !== "manual") {
      return false;
    }
    if (!this._deps.getIsActive()) {
      return false;
    }
    if (!this._deps.isCapabilityAvailable("nav")) {
      return false;
    }
    return state.robotInteractionMode === "runtimeRobot";
  }

  private _canSendNavigationGoal(): boolean {
    return (
      this._deps.hasBridgeConnection() &&
      this._deps.isCapabilityAvailable("nav") &&
      (this._deps.bridgeClient?.lastBridgeStatus?.registered ?? false)
    );
  }

  private _canConfirmNavigationGoal(): boolean {
    return (
      this._deps.isCapabilityAvailable("nav") &&
      (this._deps.getAppState() as any).navRuntimeErrorCode === null
    );
  }

  private _setNavigationMode(mode: NavigationMode): void {
    const state = this._deps.getAppState();
    if (mode === "executingGoal") {
      if (
        state.navigationMode === mode &&
        (state as any).navigationOutcome === "none"
      ) {
        return;
      }
      this._outcomeTracker?.cancel();
      this._deps.setAppState({
        navigationOutcome: "none",
        navigationMode: mode,
      } as any);
      return;
    }
    if (state.navigationMode === mode) {
      return;
    }
    this._deps.setAppState({ navigationMode: mode });
  }

  private _syncNavigationPlacementState(): void {
    if (!this._navigationController) {
      return;
    }
    const state = this._deps.getAppState();
    if (!state.navigationPlacementEnabled || !this._canStartNavigationPlacement()) {
      this._navigationController.setPlacementEnabled(false);
      if (state.navigationMode !== "idle") {
        this._setNavigationMode("idle");
      }
      return;
    }
    if (this._navigationController.placementEnabled) {
      return;
    }
    const initialPose = this._getNavigationPlacementStartPose();
    if (!initialPose) {
      return;
    }
    this._navigationController.setPlacementEnabled(true, initialPose);
  }

  private _getNavigationPlacementStartPose(): { position: vec3; rotation: quat } | null {
    const markerPosition = this._deps.robotMarker?.getWorldPosition() ?? null;
    const markerRotation = this._deps.robotMarker?.getRotation() ?? null;
    if (markerPosition && markerRotation) {
      const floorPosition = this._robotFloorPosition(markerPosition);
      if (!floorPosition) {
        return null;
      }
      return {
        position: floorPosition,
        rotation: markerRotation,
      };
    }
    const lastPose = this._deps.getLastPose();
    if (!lastPose) {
      return null;
    }
    const q = lastPose.orientation;
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    const position = protocolMetersToLensCentimeters(lastPose.position);
    const floorPosition = this._robotFloorPosition(position);
    if (!floorPosition) {
      return null;
    }
    return {
      position: floorPosition,
      rotation,
    };
  }

  private _robotFloorY(
    sourceY: number | null = this._deps.robotMarker?.getWorldPosition()?.y ?? null,
  ): number | null {
    if (sourceY === null) {
      return null;
    }
    return robotFloorWorldYCm(sourceY, this._deps.getAppState().robotRuntime);
  }

  private _robotFloorPosition(
    position: vec3 | null = this._deps.robotMarker?.getWorldPosition() ?? null,
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
    print(`NavigationCoordinator: ${message}`);
  }
}
