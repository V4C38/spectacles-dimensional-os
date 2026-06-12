import { BridgeClient } from "../bridge/BridgeClient";
import { FrameCaptureController } from "../Alignment/FrameCaptureController";
import { PointCloudRenderer } from "../lidar/PointCloudRenderer";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotMenuView } from "../Robot/RobotMenuView";
import { ManualPoseCorrection } from "../Alignment/ManualPoseCorrection";
import { AlignmentSession } from "../Alignment/AlignmentSession";
import { NavigationController } from "../Navigation/NavigationController";
import { NavigationMarkerView } from "../Navigation/NavigationMarkerView";
import { PathRenderer } from "../Navigation/PathRenderer";
import { PlacementController, RobotGroundDeadzone } from "../Navigation/PlacementController";
import { Signal } from "./SignalEmitter";
import {
  AppState,
  AppStateListener,
  BridgeLinkState,
  createDefaultRobotRuntimeState,
  DimosAppState,
  LidarDisplayMode,
  lidarVerticalBandCm,
  nextLidarMode,
  OperatingMode,
  robotFloorWorldYCm,
  RobotRuntimeState,
  RobotInteractionMode,
} from "./AppState";
import {
  BridgeStatusMessage,
  deriveLinkState,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../bridge/Protocol";
import { HelloMessage } from "../bridge/Protocol";
import {
  projectRuntimeStateFromHello,
  runtimeRenderOffsetCm,
  isCapabilityAvailable,
  capabilityUnavailableReason,
} from "./RobotRuntime";

const WorldQueryModule = require("LensStudio:WorldQueryModule");

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
  navigationMarkerRoot: SceneObject;

  @input
  robotGroundDeadzoneRadiusCm = 75;

  @input
  alignmentSession: AlignmentSession;

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

  // ── Inlined LidarFeed state ────────────────────────────────────
  private _lastLidarPoints: [number, number, number][] | null = null;
  private _lidarMeshDirty = false;

  private _robotMenuView: RobotMenuView | null = null;
  private _nav: NavigationController | null = null;

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

    // Build navigation subsystem with concrete refs.
    const goalRenderer = new NavigationMarkerView(this.navigationMarkerRoot);
    const pathRenderer = new PathRenderer(parent);
    const placement = new PlacementController(
      this,
      WorldQueryModule,
      this.placementRayOrigin ?? null,
      goalRenderer,
    );

    this._nav = new NavigationController(
      this,
      this.bridgeClient ?? null,
      this._appState,
      this.robotMarker ?? null,
      goalRenderer,
      pathRenderer,
      placement,
      this.robotGroundDeadzoneRadiusCm,
      () => this._lastPose,
      (state) => this._applyRuntimeState(state),
    );

    // Wire AlignmentSession with the deps it cannot get from @input.
    if (this.alignmentSession) {
      this.alignmentSession.initialize({
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
    }

    // Build robot menu view and inject presenter deps into RobotMarker.
    const markerRoot = this.robotMarker?.markerRoot ?? null;
    const menuRoot = this.robotMarker?.getMenuRoot() ?? null;
    if (markerRoot && menuRoot) {
      const robotMenuView = new RobotMenuView(markerRoot, menuRoot);
      this._robotMenuView = robotMenuView;
      robotMenuView.onToggleRequested = () => {
        if (this.operatingMode === "manual") {
          robotMenuView.hide();
          this.setNavigationPlacementEnabled(!this.navigationPlacementEnabled);
          return;
        }
        robotMenuView.toggleVisible();
      };
      robotMenuView.onStopRequested = () => this.requestEmergencyStop();
      robotMenuView.onNavigationPlacementRequested = (enabled) =>
        this.setNavigationPlacementEnabled(enabled);
      robotMenuView.setNavigationPlacementToggle(this.navigationPlacementEnabled);
    }

    if (this.robotMarker) {
      this.robotMarker.initialize({
        poseCorrection: this._poseCorrection,
        getLastPose: () => this._lastPose,
        robotMenuView: this._robotMenuView,
        getIsActive: () => this._isActive,
        getOperatingMode: () => this.operatingMode,
        getInteractionMode: () => this.appState.robotInteractionMode,
        syncNavigationPlacementState: () => this._nav?.syncPlacementState(),
      });
      this.robotMarker.bindAppState((listener) => this.subscribeAppState(listener));
    }

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
      if (this._isActive && this.lidarMode !== "off") {
        this._lastLidarPoints = msg.points;
        this._lidarMeshDirty = true;
        this._refreshRobotLidarAnchor();
      }
    });
    this.bridgeClient.onPose.add((msg) => {
      this._lastPose = msg;
      if (this._isActive && this.robotMarker) {
        const resolved = this._poseCorrection.resolveDisplayPose(
          msg,
          this.appState.robotInteractionMode,
        );
        this.robotMarker.applyResolvedPose(resolved, msg);
      }
      this._refreshRobotLidarAnchor();
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
    lidarTickEvent.bind(() => this._lidarTick());
    this._lidarSync();
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
    this._robotMenuView?.setRobotLabel(state.displayName);
    this._robotMenuView?.setNavigationPlacementAvailability(
      isCapabilityAvailable(state, "nav"),
    );
    this._robotMenuView?.setEmergencyStopAvailability(
      isCapabilityAvailable(state, "emergency_stop"),
      capabilityUnavailableReason(state, "emergency_stop"),
    );
    if (state.capabilities.nav?.available) {
      this._robotMenuView?.setNavigationPlacementToggle(this.navigationPlacementEnabled);
    }
    this._nav?.applyRuntimeState(state);
    this._refreshRobotLidarAnchor();
    this._lidarSync();
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    const shouldClearAnchor = this._poseCorrection.onBridgeStatus(
      msg,
      this.appState.robotInteractionMode === "manualPlacement",
    );
    if (shouldClearAnchor) {
      this._poseCorrection.reset();
    }
    this._syncLinkState(true, msg);
    this._robotMenuView?.applyBridgeLinkState(this.bridgeLinkState);
    this.onBridgeStatusChanged.emit(msg);
    this._lidarSync();
  }

  private _applyConnectionState(connected: boolean): void {
    this._log(`bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._syncLinkState(
      connected,
      connected ? this.bridgeClient?.lastBridgeStatus ?? null : null,
    );
    this._robotMenuView?.applyBridgeLinkState(this.bridgeLinkState);
    this.onBridgeConnectionChanged.emit(connected);
    if (!connected) {
      this._lastLidarPoints = null;
      this._lidarMeshDirty = false;
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
    this._lidarSync();
  }

  private setIsActive(active: boolean): void {
    this._isActive = active;
    if (!active) {
      this.pointCloudRenderer?.clearAll();
      this._nav?.clearInactiveState();
      this._robotMenuView?.hide();
    }
    this.robotMarker?.applyInteractionMode(this.appState.robotInteractionMode);
    if (active) {
      this._lidarSync();
      if (this.bridgeClient?.lastBridgeStatus) {
        this._applyBridgeStatus(this.bridgeClient.lastBridgeStatus);
      } else {
        this._applyConnectionState(this.hasBridgeConnection());
      }
      this.robotMarker?.syncPose();
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
    this._robotMenuView?.setNavigationPlacementToggle(true);
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
    this.robotMarker?.syncPose();
    this._nav?.syncPlacementState();
  }

  // ── Connection (inlined from ConnectionCoordinator) ────────────

  public setBaseUrl(url: string): void {
    if (this.bridgeClient) {
      this.bridgeClient.baseUrl = url;
    }
  }

  public getBaseUrl(): string {
    return this.bridgeClient ? this.bridgeClient.baseUrl : "";
  }

  public getDefaultBridgeIp(): string {
    return this.bridgeClient
      ? BridgeClient.normalizeIp(this.bridgeClient.defaultBridgeIp)
      : "";
  }

  public saveIp(ip: string): void {
    this.bridgeClient?.saveIp(ip);
  }

  public loadIp(): string | null {
    return this.bridgeClient?.loadIp() ?? null;
  }

  public async checkConnection(): Promise<boolean> {
    const client = this.bridgeClient;
    if (!client) {
      return false;
    }
    try {
      await client.connect();
      const ready = await client.waitForHello(3.0);
      if (ready) {
        client.requestStatus();
      }
      return ready;
    } catch (error) {
      print(`DimosManager: checkConnection failed: ${error}`);
      return false;
    }
  }

  public disconnect(): void {
    this.bridgeClient?.disconnect();
    this._nav?.resetForUserDisconnect();
  }

  public hasBridgeConnection(): boolean {
    return this.bridgeClient?.isConnected() ?? false;
  }

  public requestBridgeStatus(): boolean {
    return this.bridgeClient?.requestStatus() ?? false;
  }

  // ── Manual alignment delegators ───────────────────────────────

  public beginManualAlignmentPlacementAt(position: vec3, rotation: quat): void {
    this.alignmentSession?.beginManualPlacement(position, rotation);
  }

  public clearManualAlignmentPose(): void {
    this.alignmentSession?.clearPose();
  }

  public cancelManualAlignmentPlacement(): void {
    this.alignmentSession?.cancelPlacement();
  }

  public freezeManualAlignmentPlacement(): void {
    this.alignmentSession?.freezePlacement();
  }

  public startManualAlignmentSession(): boolean {
    if (!this.alignmentSession) {
      return false;
    }
    this.alignmentSession.start("manual");
    return true;
  }

  public stopManualAlignmentSession(): void {
    this.alignmentSession?.stop();
  }

  public captureManualAlignmentCandidate(): boolean {
    return this.alignmentSession?.captureAndSubmitManualPose() ?? false;
  }

  public finalizeOfflineManualAlignment(): boolean {
    return this.alignmentSession?.finalizeOffline() ?? false;
  }

  public preferredCalibrationMode(): "auto" | "manualOnly" | "manualAvailable" {
    return this.alignmentSession?.preferredMode() ?? "auto";
  }

  // ── Navigation delegators ─────────────────────────────────────

  public requestEmergencyStop(): void {
    this._nav?.requestEmergencyStop();
  }

  // ── Operating mode / display ──────────────────────────────────

  public hideRobotMarkerPreview(): void {
    this.robotMarker?.applyInteractionMode(this.appState.robotInteractionMode);
  }

  private setLidarMode(mode: LidarDisplayMode): void {
    if (this.lidarMode === mode) {
      return;
    }
    this._setAppState({ lidarMode: mode });
    this._lidarSync();
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
    const settingsSubmenuOpen = this.appState.mainMenuExpandedSettingsMode !== null;
    this._setAppState({
      operatingMode: mode,
      lidarMode,
      mainMenuExpandedSettingsMode: settingsSubmenuOpen ? mode : null,
    });
    this._lidarSync();
    if (lidarMode === "off" && !this._nav?.canStartPlacement()) {
      this._nav?.setPlacementEnabled(false);
    }
    this._robotMenuView?.setOperatingMode(mode);
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
    this._robotMenuView?.setNavigationPlacementToggle(enabled);
    this._nav?.onPlacementEnabledChanged(enabled);
  }

  public get navigationPlacementEnabled(): boolean {
    return this.appState.navigationPlacementEnabled;
  }

  // ── Inlined LidarFeed ─────────────────────────────────────────

  private _lidarTick(): void {
    if (
      !this._lidarMeshDirty ||
      !this._isActive ||
      this.lidarMode === "off" ||
      !this._lastLidarPoints
    ) {
      return;
    }
    this._lidarMeshDirty = false;
    this.pointCloudRenderer?.renderPointCloud(this._lastLidarPoints);
  }

  private _refreshRobotLidarAnchor(): void {
    const markerPos = this.robotMarker?.getWorldPosition();
    if (markerPos) {
      this._syncLidarAnchor(markerPos);
      return;
    }
    if (this._lastPose) {
      this._syncLidarAnchor(protocolMetersToLensCentimeters(this._lastPose.position));
    }
  }

  private _syncLidarAnchor(position: vec3): void {
    const runtime = this.appState.robotRuntime;
    this.pointCloudRenderer?.setRobotWorldPosition(position);
    this.pointCloudRenderer?.setRobotFloorWorldY(robotFloorWorldYCm(position.y, runtime));
    const band = lidarVerticalBandCm(runtime);
    this.pointCloudRenderer?.setLidarVerticalBand(band.minAboveFloorCm, band.maxAboveFloorCm);
  }

  private _lidarSync(): void {
    if (!this._isActive || this.lidarMode === "off") {
      this._lastLidarPoints = null;
      this._lidarMeshDirty = false;
      this.pointCloudRenderer?.clearAll();
      return;
    }

    const mode = this.lidarMode;
    this.pointCloudRenderer?.setFullLidarVisible(mode === "full");

    if (this.hasBridgeConnection()) {
      if (mode !== "full") {
        this.pointCloudRenderer?.clearFullLidar();
      }
      if (this._lastLidarPoints) {
        this._refreshRobotLidarAnchor();
        this.pointCloudRenderer?.renderPointCloud(this._lastLidarPoints);
      } else {
        this.pointCloudRenderer?.clearAll();
        this.pointCloudRenderer?.setFullLidarVisible(mode === "full");
      }
      return;
    }

    const anchor = this.robotMarker?.getWorldPosition() ?? vec3.zero();
    this._syncLidarAnchor(anchor);
    this.pointCloudRenderer?.renderMockLidar(anchor);
  }

  // ── Internal helpers ──────────────────────────────────────────

  private _syncLinkState(
    connected: boolean,
    status: BridgeStatusMessage | null,
  ): void {
    const next = deriveLinkState(connected, status);
    if (this.appState.bridgeLinkState === next) {
      return;
    }
    this._setAppState({ bridgeLinkState: next });
  }

  private _setAppState(patch: Partial<DimosAppState>): void {
    this._appState.update(patch);
  }

  private _setRobotInteractionMode(mode: RobotInteractionMode): void {
    if (this.appState.robotInteractionMode === mode) {
      this.robotMarker?.applyInteractionMode(mode);
      return;
    }
    this._log(`robotInteractionMode: ${mode}`);
    this._setAppState({ robotInteractionMode: mode });
    this.robotMarker?.applyInteractionMode(mode);
  }

  private _log(message: string): void {
    print(`DimosManager: ${message}`);
  }
}
