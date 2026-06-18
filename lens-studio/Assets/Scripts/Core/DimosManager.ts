import { BridgeClient } from "../Bridge/BridgeClient";
import { FrameCaptureController } from "../Alignment/FrameCaptureController";
import { PointCloudRenderer } from "../Lidar/PointCloudRenderer";
import { LidarPresentationController } from "../Lidar/LidarPresentationController";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotMenuView } from "../Robot/RobotMenuView";
import { ManualPoseCorrection } from "../Alignment/ManualPoseCorrection";
import { AlignmentSession } from "../Alignment/AlignmentSession";
import { NavigationController } from "../Navigation/NavigationController";
import { NavigationMarkerView } from "../Navigation/NavigationMarkerView";
import { PathRenderer } from "../Navigation/PathRenderer";
import { PlacementController } from "../Navigation/PlacementController";
import { Signal } from "./SignalEmitter";
import {
  AppState,
  AppStateListener,
  BridgeLinkState,
  createDefaultDriftState,
  createDefaultRobotRuntimeState,
  DimosAppState,
  LidarDisplayMode,
  nextLidarMode,
  OperatingMode,
  RobotRuntimeState,
  RobotInteractionMode,
} from "./AppState";
import {
  AlignStatusMessage,
  BridgeStatusMessage,
  DEFAULT_LIDAR_OBSTACLE_SETTINGS,
  deriveLinkState,
  HelloMessage,
  PoseCorrectionMessage,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../Bridge/Protocol";
import {
  projectRuntimeStateFromHello,
  runtimeRenderOffsetCm,
  isCapabilityAvailable,
  capabilityUnavailableReason,
} from "./RobotRuntime";
import { UILogListener, UILogger } from "./UILogger";
import { SetupAlignmentPreview } from "../Setup/SetupAlignmentPreview";

const WorldQueryModule = require("LensStudio:WorldQueryModule");
const DRIFTING_TRANSLATION_THRESHOLD_M = 0.05;
const POSE_CORRECTION_LOG_INTERVAL_S = 1.0;
const LIDAR_STALE_CLEAR_S = 0.5;

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

  /** Scene object for setup calibration ground disc preview. */
  @input
  groundDisc: SceneObject;

  private _setupPreview: SetupAlignmentPreview | null = null;

  public readonly onBridgeReady = new Signal<void>();
  public readonly onBridgeStatusChanged = new Signal<BridgeStatusMessage>();
  public readonly onBridgeConnectionChanged = new Signal<boolean>();

  private _isActive = false;
  private _lastPose: PoseMessage | null = null;
  private _pendingPose: PoseMessage | null = null;
  private readonly _poseCorrection = new ManualPoseCorrection();
  private readonly _uiLogger = new UILogger();
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
    driftState: createDefaultDriftState(),
  } as any);

  private _lidar: LidarPresentationController | null = null;
  private _robotMenuView: RobotMenuView | null = null;
  private _nav: NavigationController | null = null;
  private _placementDeferralEvent: DelayedCallbackEvent | null = null;
  private _lastPoseCorrectionLogTime = 0;
  private _priorRuntimeMode: OperatingMode = "manual";
  private _lastSyncedOperatingMode: OperatingMode | null = null;
  private _lastSentBridgeLidarMode: LidarDisplayMode | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._createHelpers();
      this._bindBridgeHandlers();
      this.enterSetup();
    });

    const placementDeferral = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    placementDeferral.bind(() => this._nav?.syncPlacementState());
    this._placementDeferralEvent = placementDeferral;
  }

  public subscribeAppState(listener: AppStateListener): () => void {
    return this._appState.subscribe(listener);
  }

  public get appState(): DimosAppState {
    return this._appState.snapshot;
  }

  public get uiLogger(): UILogger {
    return this._uiLogger;
  }

  public subscribeUILog(listener: UILogListener): () => void {
    return this._uiLogger.subscribe(listener);
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
    this._lidar = new LidarPresentationController(this.pointCloudRenderer ?? null);

    const parent =
      this.robotMarker?.markerRoot?.getParent() ??
      this.pointCloudRenderer?.pointParent?.getParent() ??
      this.getSceneObject();

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
      () => {},
    );

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
        uiLogger: this._uiLogger,
        getLastPose: () => this._lastPose,
        robotMenuView: this._robotMenuView,
        getIsActive: () => this._isActive,
        getOperatingMode: () => this.operatingMode,
        getInteractionMode: () => this.appState.robotInteractionMode,
        syncNavigationPlacementState: () => this._nav?.syncPlacementState(),
        onWorldPositionChanged: () => this._refreshLidarPresentation(),
      });
      this.robotMarker.bindAppState((listener) => this.subscribeAppState(listener));
    }

    this._setupPreview = new SetupAlignmentPreview();
    this._setupPreview.initialize({
      groundDisc: this.groundDisc ?? null,
      robotMarker: this.robotMarker ?? null,
      robotMenuView: this._robotMenuView,
      getRobotRuntime: () => this.appState.robotRuntime,
      onConfirmAssist: () => this.alignmentSession?.confirmAssist(),
    });

    this._appState.subscribe((state) => this._syncPresentationFromState(state));
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
        this._lidar?.onLidarReceived(msg.points);
        this._refreshLidarPresentation();
      }
    });
    this.bridgeClient.onPose.add((msg) => {
      this._lastPose = msg;
      this._pendingPose = msg;
    });
    this.bridgeClient.onPoseCorrection.add((msg) =>
      this._applyPoseCorrection(msg),
    );
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

    const lidarTickEvent = this.createEvent("UpdateEvent");
    lidarTickEvent.bind(() => {
      this._uiLogger.tick();
      this._applyPendingPose();
      this._lidar?.tickFrame(
        this._isActive,
        this.lidarMode,
        this.hasBridgeConnection(),
        LIDAR_STALE_CLEAR_S,
      );
    });
    this._refreshLidarPresentation();
  }

  private _applyHello(msg: HelloMessage): void {
    const runtimeState = projectRuntimeStateFromHello(msg);
    this._nav?.cancelOutcome();
    this._lastSentBridgeLidarMode = null;
    this._setAppState({
      robotRuntime: runtimeState,
      driftState: createDefaultDriftState(),
      navRuntimeErrorCode: null,
      navigationOutcome: "none",
    } as any);
  }

  private _applyPoseCorrection(msg: PoseCorrectionMessage): void {
    this._setAppState({
      driftState: {
        isDrifting: msg.trans_delta_m > DRIFTING_TRANSLATION_THRESHOLD_M,
        transDeltaM: msg.trans_delta_m,
        yawDeltaDeg:
          typeof msg.yaw_delta_deg === "number" ? msg.yaw_delta_deg : null,
        yawCorrected: msg.yaw_corrected,
        solveQuality: msg.solve_quality,
        solveMethod: msg.solve_method,
        lastUpdateTs: msg.ts,
      },
    });
    const now = getTime();
    if (
      this._lastPoseCorrectionLogTime === 0 ||
      now - this._lastPoseCorrectionLogTime >= POSE_CORRECTION_LOG_INTERVAL_S
    ) {
      this._lastPoseCorrectionLogTime = now;
      const yawDeltaText = typeof msg.yaw_delta_deg === "number"
        ? msg.yaw_delta_deg.toFixed(2)
        : "n/a";
      print(
        `DimosManager: pose_correction transDeltaM=${msg.trans_delta_m.toFixed(3)} yawDeltaDeg=${yawDeltaText} yawCorrected=${msg.yaw_corrected} solveQuality=${msg.solve_quality.toFixed(3)} solveMethod=${msg.solve_method}`,
      );
    }
    this.robotMarker?.notifyAlignmentUpdated();
    this.robotMarker?.beginRealignmentSnap();
  }

  private _syncPresentationFromState(state: DimosAppState): void {
    if (!state.robotRuntime.capabilities.lidar?.available && state.lidarMode !== "off") {
      this._setAppState({ lidarMode: "off" });
      return;
    }

    const runtime = state.robotRuntime;
    this.robotMarker?.setRenderOffsetCm(runtimeRenderOffsetCm(runtime));
    this._robotMenuView?.setRobotLabel(runtime.displayName);
    this._robotMenuView?.setNavigationPlacementAvailability(
      isCapabilityAvailable(runtime, "nav"),
    );
    this._robotMenuView?.setEmergencyStopAvailability(
      isCapabilityAvailable(runtime, "emergency_stop"),
      capabilityUnavailableReason(runtime, "emergency_stop"),
    );
    if (runtime.capabilities.nav?.available) {
      this._robotMenuView?.setNavigationPlacementToggle(state.navigationPlacementEnabled);
    }

    this._nav?.applyRuntimeState(runtime);
    this._syncOperatingModeSideEffects(state);
    this._refreshLidarPresentation(state);
    this._maybeSyncBridgeLidarMode(state.lidarMode);
    if (state.lidarMode === "off" && !this._nav?.canStartPlacement()) {
      this._nav?.setPlacementEnabled(false);
    }
  }

  private _syncOperatingModeSideEffects(state: DimosAppState): void {
    const mode = state.operatingMode;
    if (this._lastSyncedOperatingMode === mode) {
      return;
    }
    this._lastSyncedOperatingMode = mode;
    this._robotMenuView?.setOperatingMode(mode);

    if (mode === "setup") {
      this._nav?.setPlacementEnabled(false);
      this._nav?.syncPlacementState();
      return;
    }

    if (mode === "manual") {
      if (!state.navigationPlacementEnabled) {
        this._setAppState({ navigationPlacementEnabled: true });
      } else {
        this._robotMenuView?.setNavigationPlacementToggle(true);
        this._nav?.onPlacementEnabledChanged(true);
      }
    } else {
      this._nav?.setPlacementEnabled(false);
    }
    this._nav?.syncPlacementState();
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
    if (this.appState.phase === "runtime" && this.frameCaptureController) {
      this.frameCaptureController.setMode(msg.registered ? "runtime" : "off");
    }
    this._robotMenuView?.applyBridgeLinkState(this.bridgeLinkState);
    this.onBridgeStatusChanged.emit(msg);
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
      this._lastSentBridgeLidarMode = null;
      this._lidar?.clearBuffer();
      this._nav?.clearForDisconnect();
      this._setAppState({
        navigationMode: "idle",
        navigationOutcome: "none",
        navRuntimeErrorCode: null,
        robotRuntime: createDefaultRobotRuntimeState(),
      } as any);
      this._lastPose = null;
      this._pendingPose = null;
      this._poseCorrection.onDisconnected();
      this.robotMarker?.resetRuntimePoseSmoothing();
    }
  }

  private setIsActive(active: boolean): void {
    this._isActive = active;
    if (!active) {
      this.pointCloudRenderer?.clearAll();
      this._lidar?.clearBuffer();
      this._nav?.clearInactiveState();
      this._robotMenuView?.hide();
    }
    this.robotMarker?.applyInteractionMode(this.appState.robotInteractionMode);
    if (active) {
      if (this.bridgeClient?.lastBridgeStatus) {
        this._applyBridgeStatus(this.bridgeClient.lastBridgeStatus);
      } else {
        this._applyConnectionState(this.hasBridgeConnection());
      }
      this.robotMarker?.syncPose();
    }
    this._syncPresentationFromState(this.appState);
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
    if (this._setupPreview?.isActive) {
      this.endSetupAlignmentPreview();
    }
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
    this._placementDeferralEvent?.reset(0.0);
  }

  // ── Connection ────────────────────────────────────────────────

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

  // ── Setup alignment preview API ───────────────────────────────

  public beginSetupAlignmentPreview(_onAbort: () => void): void {
    this._priorRuntimeMode = this.appState.operatingMode !== "setup"
      ? this.appState.operatingMode
      : "manual";
    this.setOperatingMode("setup");
    this._setupPreview?.begin();
  }

  public updateSetupAlignmentFromAlignStatus(msg: AlignStatusMessage): void {
    this._setupPreview?.updateFromAlignStatus(msg);
  }

  public setSetupAlignmentComplete(): void {
    this._setupPreview?.setComplete();
  }

  public endSetupAlignmentPreview(): void {
    if (!this._setupPreview?.isActive) {
      return;
    }
    this._setupPreview.end();
    this.setOperatingMode(this._priorRuntimeMode);
  }

  public hideRobotMarkerPreview(): void {
    this.robotMarker?.applyInteractionMode(this.appState.robotInteractionMode);
  }

  // ── Operating mode / display ──────────────────────────────────

  private setLidarMode(mode: LidarDisplayMode): void {
    if (this.lidarMode === mode) {
      return;
    }
    this._setAppState({ lidarMode: mode });
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
    if (mode === "setup") {
      return;
    }
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

  public setOperatingMode(mode: OperatingMode): void {
    if (this.appState.operatingMode === mode) {
      return;
    }
    this._log(`setOperatingMode: ${mode}`);
    if (mode === "setup") {
      this._setAppState({ operatingMode: mode, lidarMode: "off" });
      return;
    }
    const lidarMode: LidarDisplayMode = mode === "manual" ? "obstacles" : "off";
    const settingsSubmenuOpen = this.appState.mainMenuExpandedSettingsMode !== null;
    this._setAppState({
      operatingMode: mode,
      lidarMode,
      mainMenuExpandedSettingsMode: settingsSubmenuOpen ? mode : null,
    });
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

  // ── LiDAR presentation ──────────────────────────────────────

  private _resolveLidarAnchor(): vec3 | null {
    const markerPos = this.robotMarker?.getWorldPosition();
    if (markerPos) {
      return markerPos;
    }
    if (this._lastPose) {
      return protocolMetersToLensCentimeters(this._lastPose.position);
    }
    return null;
  }

  private _refreshLidarPresentation(state?: DimosAppState): void {
    const snapshot = state ?? this.appState;
    this._lidar?.apply({
      mode: snapshot.lidarMode,
      active: this._isActive,
      connected: this.hasBridgeConnection(),
      points: this._lidar?.lastPoints ?? null,
      anchor: this._resolveLidarAnchor(),
      runtime: snapshot.robotRuntime,
    });
  }

  private _maybeSyncBridgeLidarMode(mode: LidarDisplayMode): void {
    if (this._lastSentBridgeLidarMode === mode) {
      return;
    }
    if (!this.bridgeClient || !this.hasBridgeConnection() || !this.bridgeClient.activeRobotId) {
      return;
    }
    this._lastSentBridgeLidarMode = mode;
    this.bridgeClient.sendLidarMode(mode, DEFAULT_LIDAR_OBSTACLE_SETTINGS);
  }

  private _applyPendingPose(): void {
    const msg = this._pendingPose;
    if (!msg) {
      return;
    }
    this._pendingPose = null;
    if (this._isActive && this.robotMarker) {
      const resolved = this._poseCorrection.resolveDisplayPose(
        msg,
        this.appState.robotInteractionMode,
      );
      this.robotMarker.applyResolvedPose(resolved, msg);
    }
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
