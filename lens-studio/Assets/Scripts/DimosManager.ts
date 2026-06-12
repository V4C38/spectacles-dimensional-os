import { BridgeClient } from "./Network/BridgeClient";
import { FrameCaptureController } from "./Camera/FrameCaptureController";
import { PointCloudRenderer } from "./Visuals/PointCloudRenderer";
import { RobotMarker } from "./Visuals/RobotMarker";
import { LidarFeed } from "./Visuals/LidarFeed";
import { RobotMarkerPresenter } from "./Visuals/RobotMarkerPresenter";
import { RobotMenuView } from "./UI/RobotMenuView";
import { RobotMenuController } from "./UI/RobotMenuController";
import { requireSceneObjectByName } from "./UI/Shared/UICore";
import { ManualPoseCorrection } from "./Alignment/ManualPoseCorrection";
import { ManualAlignmentCoordinator } from "./Alignment/ManualAlignmentCoordinator";
import { NavigationCoordinator } from "./Navigation/NavigationCoordinator";
import { ConnectionCoordinator } from "./Network/ConnectionCoordinator";
import { Signal } from "./Shared/SignalEmitter";
import {
  AppState,
  AppStateListener,
  BridgeLinkState,
  createDefaultRobotRuntimeState,
  DimosAppState,
  LidarDisplayMode,
  nextLidarMode,
  OperatingMode,
  RobotRuntimeState,
  RobotInteractionMode,
} from "./AppState";
import {
  BridgeStatusMessage,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "./Network/Protocol";
import { HelloMessage } from "./Network/ProtocolTypes";
import {
  projectRuntimeStateFromHello,
  runtimeRenderOffsetCm,
  isCapabilityAvailable,
  capabilityUnavailableReason,
} from "./Robot/RobotRuntime";

/** Scene-root orchestrator wiring bridge I/O, alignment, rendering, navigation, and robot menu after setup completes. */
@component
export class DimosManager extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  frameCaptureController: FrameCaptureController;

  @input
  pointCloudRenderer: PointCloudRenderer;

  @input
  robotMarker: RobotMarker;

  @input
  placementRayOrigin: SceneObject;

  @input
  robotGroundDeadzoneRadiusCm = 75;

  public readonly onBridgeReady = new Signal<void>();
  public readonly onBridgeStatusChanged = new Signal<BridgeStatusMessage>();
  public readonly onBridgeConnectionChanged = new Signal<boolean>();

  private _isActive = false;
  private _lastPose: PoseMessage | null = null;
  private readonly _poseCorrection = new ManualPoseCorrection();
  private readonly _appState = new AppState({
    phase: "setup",
    debugMode: false,
    lidarMode: "obstacles",
    operatingMode: "manual",
    mainMenuExpandedSettingsMode: null,
    navigationPlacementEnabled: true,
    robotInteractionMode: "hidden",
    navigationMode: "idle",
    navigationOutcome: "none",
    navRuntimeErrorCode: null,
    bridgeLinkState: "disconnected",
    robotRuntime: createDefaultRobotRuntimeState(),
  } as any);

  private _lidarFeed: LidarFeed | null = null;
  private _robotMenuController: RobotMenuController | null = null;
  private _markerPresenter: RobotMarkerPresenter | null = null;
  private _nav: NavigationCoordinator | null = null;
  private _manualAlignment: ManualAlignmentCoordinator | null = null;
  private _connection: ConnectionCoordinator | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._createHelpers();
      this._bindBridgeHandlers();
      this.enterSetup();
    });
  }

  public subscribeAppState(listener: AppStateListener): () => void {
    return this._appState.subscribe(listener);
  }

  public get appState(): DimosAppState {
    return this._appState.snapshot;
  }

  public get bridgeLinkState(): BridgeLinkState {
    return this.appState.bridgeLinkState;
  }

  private isRuntimeCapabilityAvailable(capability: string): boolean {
    return isCapabilityAvailable(this.appState.robotRuntime, capability);
  }

  private runtimeCapabilityUnavailableReason(capability: string): string | null {
    return capabilityUnavailableReason(this.appState.robotRuntime, capability);
  }

  private _createHelpers(): void {
    const parent =
      this.robotMarker?.markerRoot?.getParent() ??
      this.pointCloudRenderer?.pointParent?.getParent() ??
      this.getSceneObject();
    const navigationMarkerRoot = requireSceneObjectByName(
      "NavigationTargetMarker",
      this.getSceneObject(),
      "DimosManager",
    );

    this._connection = new ConnectionCoordinator({
      bridgeClient: this.bridgeClient ?? null,
      getBridgeLinkState: () => this.appState.bridgeLinkState,
      setBridgeLinkState: (state) => this._setAppState({ bridgeLinkState: state }),
    });

    this._nav = new NavigationCoordinator({
      scriptComponent: this,
      bridgeClient: this.bridgeClient ?? null,
      robotMarker: this.robotMarker ?? null,
      placementRayOrigin: this.placementRayOrigin ?? null,
      navigationMarkerRoot,
      pathParent: parent,
      robotGroundDeadzoneRadiusCm: this.robotGroundDeadzoneRadiusCm,
      getAppState: () => this.appState,
      setAppState: (patch) => this._setAppState(patch),
      isCapabilityAvailable: (cap) => this.isRuntimeCapabilityAvailable(cap),
      capabilityUnavailableReason: (cap) => this.runtimeCapabilityUnavailableReason(cap),
      getIsActive: () => this._isActive,
      getLastPose: () => this._lastPose,
      hasBridgeConnection: () => this.hasBridgeConnection(),
      onRuntimeStateChanged: (state) => this._applyRuntimeState(state),
    });

    this._manualAlignment = new ManualAlignmentCoordinator({
      bridgeClient: this.bridgeClient ?? null,
      robotMarker: this.robotMarker ?? null,
      poseCorrection: this._poseCorrection,
      hasBridgeConnection: () => this.hasBridgeConnection(),
      isCapabilityAvailable: (cap) => this.isRuntimeCapabilityAvailable(cap),
      getInteractionMode: () => this.appState.robotInteractionMode,
      setInteractionMode: (mode) => this._setRobotInteractionMode(mode),
      getIsActive: () => this._isActive,
      disableNavigationPlacementForAlignment: () => {
        if (this._nav?.placementEnabled) {
          this._nav.setPlacementEnabled(false);
        }
      },
    });

    const markerRoot = this.robotMarker?.markerRoot ?? null;
    const menuRoot = this.robotMarker?.getMenuRoot() ?? null;
    if (markerRoot && menuRoot) {
      const robotMenuView = new RobotMenuView(markerRoot, menuRoot);
      this._robotMenuController = new RobotMenuController(robotMenuView);
      this._robotMenuController.bindCallbacks(
        () => {
          if (this.operatingMode === "manual") {
            this._robotMenuController?.hide();
            this.setNavigationPlacementEnabled(!this.navigationPlacementEnabled);
            return;
          }
          this._robotMenuController?.toggleVisible();
        },
        () => this.requestEmergencyStop(),
        (enabled) => this.setNavigationPlacementEnabled(enabled),
        () => this.navigationPlacementEnabled,
      );
      this._robotMenuController.setNavigationPlacementToggle(
        this.navigationPlacementEnabled,
      );
    }

    if (this.pointCloudRenderer) {
      this._lidarFeed = new LidarFeed(this.pointCloudRenderer, {
        getIsActive: () => this._isActive,
        getLidarMode: () => this.lidarMode,
        getHasBridgeConnection: () => this.hasBridgeConnection(),
        getRobotRuntime: () => this.appState.robotRuntime,
        getRobotMarkerPosition: () =>
          this.robotMarker?.getWorldPosition() ?? null,
        getLastPosePosition: () =>
          this._lastPose
            ? protocolMetersToLensCentimeters(this._lastPose.position)
            : null,
      });
    }

    this._markerPresenter = new RobotMarkerPresenter({
      robotMarker: this.robotMarker ?? null,
      frameCaptureController: this.frameCaptureController ?? null,
      poseCorrection: this._poseCorrection,
      getRobotMenuController: () => this._robotMenuController,
      getIsActive: () => this._isActive,
      getOperatingMode: () => this.operatingMode,
      getLastPose: () => this._lastPose,
      getInteractionMode: () => this.appState.robotInteractionMode,
      syncNavigationPlacementState: () => this._nav?.syncPlacementState(),
    });

    this.robotMarker?.bindAppState((listener) => this.subscribeAppState(listener));
    this._applyRuntimeState(this.appState.robotRuntime);
  }

  private _bindBridgeHandlers(): void {
    if (!this.bridgeClient) {
      return;
    }
    this.bridgeClient.onHello.add((msg) => {
      this._applyHello(msg);
      this.onBridgeReady.emit();
    });
    this.bridgeClient.onLidar.add((msg) => {
      this._lidarFeed?.onLidarMessage(msg.points);
    });
    this.bridgeClient.onPose.add((msg) => {
      this._lastPose = msg;
      if (this._isActive && this.robotMarker) {
        const resolved = this._poseCorrection.resolveDisplayPose(
          msg,
          this.appState.robotInteractionMode,
        );
        this._markerPresenter?.applyResolvedPose(resolved, msg);
      }
      this._lidarFeed?.refreshRobotLidarAnchor();
    });
    this.bridgeClient.onPath.add((msg) => this._nav?.applyPath(msg));
    this.bridgeClient.onPathPreview.add((msg) => this._nav?.applyPathPreview(msg));
    this.bridgeClient.onNavStatus.add((msg) => this._nav?.applyNavStatus(msg));
    this.bridgeClient.onBridgeStatus.add((msg) => this._applyBridgeStatus(msg));
    this.bridgeClient.onConnectionChanged.add((connected) =>
      this._applyConnectionState(connected),
    );
    this.bridgeClient.onProtocolError.add((error) =>
      this._nav?.handleProtocolError(error),
    );
    this._nav?.startWatchdog();
    // Deferred lidar mesh pump — tick every frame, render only when dirty.
    const lidarTickEvent = this.createEvent("UpdateEvent");
    lidarTickEvent.bind(() => this._lidarFeed?.tick());
    this._lidarFeed?.sync();
  }

  private _applyHello(msg: HelloMessage): void {
    const runtimeState = projectRuntimeStateFromHello(msg);
    this._nav?.cancelOutcome();
    this._setAppState({
      robotRuntime: runtimeState,
      navRuntimeErrorCode: null,
      navigationOutcome: "none",
    } as any);
    this._applyRuntimeState(runtimeState);
  }

  private _applyRuntimeState(state: RobotRuntimeState): void {
    if (!state.capabilities.lidar?.available && this.lidarMode !== "off") {
      this._setAppState({ lidarMode: "off" });
    }
    this.robotMarker?.setRenderOffsetCm(runtimeRenderOffsetCm(state));
    this._robotMenuController?.setRobotLabel(state.displayName);
    this._robotMenuController?.setNavigationPlacementAvailability(
      this.isRuntimeCapabilityAvailable("nav"),
    );
    this._robotMenuController?.setEmergencyStopAvailability(
      this.isRuntimeCapabilityAvailable("emergency_stop"),
      this.runtimeCapabilityUnavailableReason("emergency_stop"),
    );
    if (state.capabilities.nav?.available) {
      this._robotMenuController?.setNavigationPlacementToggle(this.navigationPlacementEnabled);
    }
    this._nav?.applyRuntimeState(state);
    this._lidarFeed?.refreshRobotLidarAnchor();
    this._lidarFeed?.sync();
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    const shouldClearAnchor = this._poseCorrection.onBridgeStatus(
      msg,
      this.appState.robotInteractionMode === "manualPlacement",
    );
    if (shouldClearAnchor) {
      this._poseCorrection.reset();
    }
    this._connection?.syncLinkState(true, msg);
    this._robotMenuController?.applyBridgeLinkState(this.bridgeLinkState);
    this.onBridgeStatusChanged.emit(msg);
    this._lidarFeed?.sync();
  }

  private _applyConnectionState(connected: boolean): void {
    this._log(`bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._connection?.syncLinkState(
      connected,
      connected ? this.bridgeClient?.lastBridgeStatus ?? null : null,
    );
    this._robotMenuController?.applyBridgeLinkState(this.bridgeLinkState);
    this.onBridgeConnectionChanged.emit(connected);
    if (!connected) {
      this._lidarFeed?.clearCachedPoints();
      this._nav?.clearForDisconnect();
      const defaultRuntime = createDefaultRobotRuntimeState();
      this._setAppState({
        navigationMode: "idle",
        navigationOutcome: "none",
        navRuntimeErrorCode: null,
        robotRuntime: defaultRuntime,
      } as any);
      this._applyRuntimeState(defaultRuntime);
      this._poseCorrection.onDisconnected();
      this.robotMarker?.resetRuntimePoseSmoothing();
    }
    this._lidarFeed?.sync();
  }

  private setIsActive(active: boolean): void {
    this._isActive = active;
    if (!active) {
      this._lidarFeed?.clearRenderer();
      this._nav?.clearInactiveState();
      this._robotMenuController?.hide();
    }
    this._markerPresenter?.applyInteractionMode(this.appState.robotInteractionMode);
    if (active) {
      this._lidarFeed?.sync();
      if (this.bridgeClient?.lastBridgeStatus) {
        this._applyBridgeStatus(this.bridgeClient.lastBridgeStatus);
      } else {
        this._applyConnectionState(this.hasBridgeConnection());
      }
      this._markerPresenter?.syncPose();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  public enterSetup(): void {
    this._log("enterSetup");
    this.cancelManualAlignmentPlacement();
    this.stopManualAlignmentSession();
    this.clearManualAlignmentPose();
    this.disconnect();
    this.frameCaptureController?.setMode("off");
    this.setIsActive(false);
    this._setAppState({ navigationPlacementEnabled: true });
    this._robotMenuController?.setNavigationPlacementToggle(true);
    this._nav?.setNavigationMode("idle");
    this._setRobotInteractionMode("hidden");
    this._setAppState({ phase: "setup" });
  }

  public enterRuntime(): void {
    this._log("enterRuntime");
    this.cancelManualAlignmentPlacement();
    this.stopManualAlignmentSession();
    this._poseCorrection.prepareForRuntime(
      Boolean(this.bridgeClient?.lastBridgeStatus?.registration_approximate),
    );
    this.setIsActive(true);
    if (this.frameCaptureController) {
      const registered = Boolean(this.bridgeClient?.lastBridgeStatus?.registered);
      this.frameCaptureController.setMode(registered ? "runtime" : "off");
    }
    this._setAppState({ phase: "runtime" });
    this._setRobotInteractionMode("runtimeRobot");
    this._markerPresenter?.syncPose();
    this._nav?.syncPlacementState();
  }

  // ── Connection delegators ─────────────────────────────────────

  public setBaseUrl(url: string): void {
    this._connection?.setBaseUrl(url);
  }

  public getBaseUrl(): string {
    return this._connection?.getBaseUrl() ?? "";
  }

  public getDefaultBridgeIp(): string {
    return this._connection?.getDefaultBridgeIp() ?? "";
  }

  public saveIp(ip: string): void {
    this._connection?.saveIp(ip);
  }

  public loadIp(): string | null {
    return this._connection?.loadIp() ?? null;
  }

  public async checkConnection(): Promise<boolean> {
    return this._connection?.checkConnection() ?? false;
  }

  public disconnect(): void {
    this.bridgeClient?.disconnect();
    this._nav?.resetForUserDisconnect();
  }

  public hasBridgeConnection(): boolean {
    return this._connection?.hasBridgeConnection() ?? this.bridgeClient?.isConnected() ?? false;
  }

  public requestBridgeStatus(): boolean {
    return this._connection?.requestBridgeStatus() ?? false;
  }

  // ── Manual alignment delegators ───────────────────────────────

  public beginManualAlignmentPlacementAt(position: vec3, rotation: quat): void {
    this._manualAlignment?.beginPlacementAt(position, rotation);
  }

  public clearManualAlignmentPose(): void {
    this._manualAlignment?.clearPose();
  }

  public cancelManualAlignmentPlacement(): void {
    this._manualAlignment?.cancelPlacement();
  }

  public freezeManualAlignmentPlacement(): void {
    this._manualAlignment?.freezePlacement();
  }

  public startManualAlignmentSession(): boolean {
    return this._manualAlignment?.startSession() ?? false;
  }

  public stopManualAlignmentSession(): void {
    this._manualAlignment?.stopSession();
  }

  public captureManualAlignmentCandidate(): boolean {
    return this._manualAlignment?.captureCandidate() ?? false;
  }

  public finalizeOfflineManualAlignment(): boolean {
    return this._manualAlignment?.finalizeOfflineAlignment() ?? false;
  }

  public preferredCalibrationMode(): "auto" | "manualOnly" | "manualAvailable" {
    return this._manualAlignment?.preferredCalibrationMode() ?? "auto";
  }

  // ── Navigation delegators ─────────────────────────────────────

  public requestEmergencyStop(): void {
    this._nav?.requestEmergencyStop();
  }

  // ── Operating mode / display ──────────────────────────────────

  public hideRobotMarkerPreview(): void {
    this._markerPresenter?.applyInteractionMode(this.appState.robotInteractionMode);
  }

  private setLidarMode(mode: LidarDisplayMode): void {
    if (this.lidarMode === mode) {
      return;
    }
    this._setAppState({ lidarMode: mode });
    this._lidarFeed?.sync();
    if (mode === "off" && !this._nav?.canStartPlacement()) {
      this._nav?.setPlacementEnabled(false);
    }
  }

  public cycleLidarMode(): void {
    this.setLidarMode(nextLidarMode(this.lidarMode));
  }

  public get lidarMode(): LidarDisplayMode {
    return this.appState.lidarMode;
  }

  public setDebugMode(enabled: boolean): void {
    if (this.debugMode === enabled) {
      return;
    }
    this._setAppState({ debugMode: enabled });
  }

  public get debugMode(): boolean {
    return this.appState.debugMode;
  }

  public onMainMenuModeButtonPressed(mode: OperatingMode): void {
    if (this.appState.operatingMode === mode) {
      return;
    }
    this.setOperatingMode(mode);
  }

  public setMainMenuSettingsExpanded(enabled: boolean): void {
    const nextExpanded = enabled ? this.operatingMode : null;
    if (this.appState.mainMenuExpandedSettingsMode === nextExpanded) {
      return;
    }
    this._setAppState({ mainMenuExpandedSettingsMode: nextExpanded });
  }

  private setOperatingMode(mode: OperatingMode): void {
    const modeChanged = this.appState.operatingMode !== mode;
    if (!modeChanged) {
      return;
    }
    this._log(`setOperatingMode: ${mode}`);
    const lidarMode: LidarDisplayMode = mode === "manual" ? "obstacles" : "off";
    const settingsSubmenuOpen =
      this.appState.mainMenuExpandedSettingsMode !== null;
    this._setAppState({
      operatingMode: mode,
      lidarMode,
      mainMenuExpandedSettingsMode: settingsSubmenuOpen ? mode : null,
    });
    this._lidarFeed?.sync();
    if (lidarMode === "off" && !this._nav?.canStartPlacement()) {
      this._nav?.setPlacementEnabled(false);
    }
    this._robotMenuController?.setOperatingMode(mode);
    if (mode === "manual") {
      this.setNavigationPlacementEnabled(true);
    } else {
      this._nav?.setPlacementEnabled(false);
    }
    this._nav?.syncPlacementState();
  }

  public get operatingMode(): OperatingMode {
    return this.appState.operatingMode;
  }

  public setNavigationPlacementEnabled(enabled: boolean): void {
    if (this.navigationPlacementEnabled === enabled) {
      return;
    }
    this._log(`setNavigationPlacementEnabled: ${enabled}`);
    this._setAppState({ navigationPlacementEnabled: enabled });
    this._robotMenuController?.setNavigationPlacementToggle(enabled);
    this._nav?.onPlacementEnabledChanged(enabled);
  }

  public get navigationPlacementEnabled(): boolean {
    return this.appState.navigationPlacementEnabled;
  }

  // ── Internal helpers ──────────────────────────────────────────

  private _setAppState(patch: Partial<DimosAppState>): void {
    this._appState.update(patch);
  }

  private _setRobotInteractionMode(mode: RobotInteractionMode): void {
    if (this.appState.robotInteractionMode === mode) {
      this._markerPresenter?.applyInteractionMode(mode);
      return;
    }
    this._log(`robotInteractionMode: ${mode}`);
    this._setAppState({ robotInteractionMode: mode });
    this._markerPresenter?.applyInteractionMode(mode);
  }

  private _log(message: string): void {
    print(`DimosManager: ${message}`);
  }
}
