import { BridgeClient } from "./Network/BridgeClient";
import { FrameCaptureController } from "./Camera/FrameCaptureController";
import { PointCloudRenderer } from "./Visuals/PointCloudRenderer";
import { RobotMarker } from "./Visuals/RobotMarker";
import { PathRenderer } from "./Visuals/PathRenderer";
import { NavigationMarkerView } from "./Navigation/NavigationMarkerView";
import {
  PlacementController,
  RobotGroundDeadzone,
} from "./Navigation/PlacementController";
import { RobotMenuView } from "./UI/RobotMenuView";
import { RobotMenuController } from "./UI/RobotMenuController";
import { NavigationController } from "./Navigation/NavigationController";
import {
  ManualAlignmentController,
  manualMarkerPoseFromMarkerWorldPose,
  manualMarkerPoseFromReference,
  ManualAlignmentPose,
} from "./Alignment/ManualAlignmentController";
import { findChildRecursive } from "./UI/Shared/UICore";
import {
  AppState,
  AppStateListener,
  BridgeLinkState,
  createDefaultRobotRuntimeState,
  DimosAppState,
  LidarDisplayMode,
  nextLidarMode,
  lidarVerticalBandCm,
  robotFloorWorldYCm,
  NavigationMode,
  OperatingMode,
  RobotRuntimeState,
  RobotInteractionMode,
} from "./AppState";
import {
  BridgeStatusMessage,
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  PoseMessage,
  ProtocolParseError,
  protocolMetersToLensCentimeters,
} from "./Network/Protocol";
import { HelloMessage } from "./Network/ProtocolTypes";

const WorldQueryModule = require("LensStudio:WorldQueryModule");
const NAVIGATION_OUTCOME_FLASH_S = 1.5;

// ================================================================
// ================================================================
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

  public onBridgeReady: (() => void)[] = [];
  public onBridgeStatusChanged: ((msg: BridgeStatusMessage) => void)[] = [];
  public onBridgeConnectionChanged: ((connected: boolean) => void)[] = [];

  private _isActive = false;
  private _lastPose: PoseMessage | null = null;
  private _lastLidarPoints: [number, number, number][] | null = null;
  private _lidarMeshDirty = false;
  private _lidarMeshEvent: SceneEvent | null = null;
  private _manualAlignmentPose: ManualAlignmentPose | null = null;
  private _preferManualPoseUntilNextRuntimePose = false;
  private _useManualPoseCorrection = false;
  private _manualPoseCorrectionRotation: quat | null = null;
  private _manualPoseCorrectionTranslation: vec3 | null = null;
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
  });

  private _goalRenderer: NavigationMarkerView | null = null;
  private _pathRenderer: PathRenderer | null = null;
  private _placementController: PlacementController | null = null;
  private _robotMenuController: RobotMenuController | null = null;
  private _navigationController: NavigationController | null = null;
  private _manualAlignmentController: ManualAlignmentController | null = null;
  private _settingsTogglePendingMode: OperatingMode | null = null;
  private _settingsToggleEvent: SceneEvent | null = null;
  private _blockSettingsToggleUntil = -1;
  private _protocolParseFailureCount = 0;
  private _navWatchdogEvent: SceneEvent | null = null;
  private _navigationOutcomeClearEvent: DelayedCallbackEvent | null = null;
  private _navigationOutcomeClearSeq = 0;
  private _navigationOutcomeClearDueSeq = 0;

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

  public isRuntimeCapabilityAvailable(capability: string): boolean {
    const state = this.appState.robotRuntime.capabilities[capability];
    return state ? state.available : true;
  }

  public runtimeCapabilityUnavailableReason(capability: string): string | null {
    const state = this.appState.robotRuntime.capabilities[capability];
    return state ? state.reason : null;
  }

  public canUseMarkerAlignment(): boolean {
    return this.isRuntimeCapabilityAvailable("align");
  }

  public canUseManualAlignment(): boolean {
    return this.isRuntimeCapabilityAvailable("align_manual");
  }

  public get lastBridgeStatus(): BridgeStatusMessage | null {
    return this.bridgeClient?.lastBridgeStatus ?? null;
  }

  public preferredCalibrationMode(): "auto" | "manualOnly" | "manualAvailable" {
    if (
      this.hasBridgeConnection() &&
      !this.canUseMarkerAlignment() &&
      this.canUseManualAlignment()
    ) {
      return "manualOnly";
    }
    if (this.canUseManualAlignment()) {
      return "manualAvailable";
    }
    return "auto";
  }

  private _createHelpers(): void {
    const parent =
      this.robotMarker?.markerRoot?.getParent() ??
      this.pointCloudRenderer?.pointParent?.getParent() ??
      this.getSceneObject();
    const navigationMarkerRoot = this._requireSceneObject(
      "NavigationTargetMarker",
    );

    this._goalRenderer = new NavigationMarkerView(navigationMarkerRoot);
    this._pathRenderer = new PathRenderer(parent);
    this._placementController = new PlacementController(
      this,
      WorldQueryModule,
      this.placementRayOrigin ?? null,
      this._goalRenderer,
    );
    this._placementController.setRobotGroundDeadzone({
      radiusCm: this.robotGroundDeadzoneRadiusCm,
      getRobotWorldPosition: () => this.robotMarker?.getWorldPosition() ?? null,
    } as RobotGroundDeadzone);

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

    this._manualAlignmentController = new ManualAlignmentController(
      this.bridgeClient ?? null,
      this.robotMarker ?? null,
    );

    this._navigationController = new NavigationController({
      bridgeClient: this.bridgeClient ?? null,
      goalRenderer: this._goalRenderer,
      pathRenderer: this._pathRenderer,
      placementController: this._placementController,
      onNavigationModeChanged: (mode) => this._setNavigationMode(mode),
      canStartPlacement: () => this._canStartNavigationPlacement(),
      canSendNavGoal: () => this._canSendNavigationGoal(),
      getRobotFloorPosition: () => this._robotFloorPosition(),
      getGoalResetPose: () => this._getNavigationPlacementStartPose(),
    });
    this.robotMarker?.bindAppState((listener) => this.subscribeAppState(listener));
    this._applyRuntimeState(this.appState.robotRuntime);
  }

  private _requireSceneObject(name: string): SceneObject {
    const sceneApi = global.scene as any;
    const rootCount =
      typeof sceneApi?.getRootObjectsCount === "function"
        ? sceneApi.getRootObjectsCount()
        : 0;
    for (let index = 0; index < rootCount; index++) {
      const root = sceneApi.getRootObject(index) as SceneObject;
      if (!root) {
        continue;
      }
      if (root.name === name) {
        return root;
      }
      const nested = findChildRecursive(root, name);
      if (nested) {
        return nested;
      }
    }
    const fallbackRoot = this.getSceneObject().getParent() ?? this.getSceneObject();
    const nested = findChildRecursive(fallbackRoot, name);
    if (nested) {
      return nested;
    }
    throw new Error(`DimosManager: Missing scene object ${name}`);
  }

  private _bindBridgeHandlers(): void {
    if (!this.bridgeClient) {
      return;
    }
    this.bridgeClient.ensureEventHandlers();
    this.bridgeClient.onHello.push((msg) => {
      this._applyHello(msg);
      this.onBridgeReady.forEach((cb) => cb());
    });
    this.bridgeClient.onLidar.push((msg) => {
      if (
        this._isActive &&
        this.lidarMode !== "off" &&
        this.pointCloudRenderer
      ) {
        this._lastLidarPoints = msg.points;
        this._lidarMeshDirty = true;
        this._refreshRobotLidarAnchor();
      }
    });
    this.bridgeClient.onPose.push((msg) => {
      this._lastPose = msg;
      const willApply = this._isActive && !!this.robotMarker;
      if (willApply) {
        this._applyRobotDisplayPose(msg);
      }
      this._refreshRobotLidarAnchor();
    });
    this.bridgeClient.onPath.push((msg) => this._applyPath(msg));
    this.bridgeClient.onPathPreview.push((msg) => this._applyPathPreview(msg));
    this.bridgeClient.onNavStatus.push((msg) => this._applyNavStatus(msg));
    this.bridgeClient.onBridgeStatus.push((msg) => this._applyBridgeStatus(msg));
    this.bridgeClient.onConnectionChanged.push((connected) =>
      this._applyConnectionState(connected),
    );
    this.bridgeClient.onProtocolError.push((error) =>
      this._handleProtocolError(error),
    );
    this._startNavLifecycleWatchdog();
    this._startDeferredLidarMeshPump();
    this._syncLiDARPreview();
  }

  private _startDeferredLidarMeshPump(): void {
    if (this._lidarMeshEvent) {
      return;
    }
    const event = this.createEvent("UpdateEvent");
    event.bind(() => this._tickDeferredLidarMesh());
    this._lidarMeshEvent = event;
  }

  private _tickDeferredLidarMesh(): void {
    if (
      !this._lidarMeshDirty ||
      !this._isActive ||
      this.lidarMode === "off" ||
      !this.pointCloudRenderer ||
      !this._lastLidarPoints
    ) {
      return;
    }
    this._lidarMeshDirty = false;
    this.pointCloudRenderer.renderPointCloud(this._lastLidarPoints);
  }

  private _startNavLifecycleWatchdog(): void {
    if (this._navWatchdogEvent) {
      return;
    }
    const event = this.createEvent("UpdateEvent");
    event.bind(() => this._tickNavLifecycleWatchdog());
    this._navWatchdogEvent = event;
  }

  private _tickNavLifecycleWatchdog(): void {
    if (!this._navigationController || !this.hasBridgeConnection()) {
      return;
    }
    const action = this._navigationController.checkNavLifecycleStaleness();
    if (action === "request_resync") {
      this._log("nav lifecycle stale; requesting bridge status resync");
      this.bridgeClient?.requestStatus();
      return;
    }
    if (action === "recover_local") {
      this._log("nav lifecycle stale after resync; recovering locally");
      this._navigationController.recoverFromStaleExecution();
      this._setNavigationOutcome("failed");
    }
  }

  private _handleProtocolError(error: ProtocolParseError): void {
    this._protocolParseFailureCount += 1;
    if (this._protocolParseFailureCount < 3) {
      return;
    }
    if (this.appState.navigationMode !== "executingGoal") {
      return;
    }
    this._log(
      `protocol ${error.kind} failures while navigating (${this._protocolParseFailureCount}); awaiting resync`,
    );
  }

  private _applyHello(msg: HelloMessage): void {
    const runtimeState = this._projectRuntimeStateFromHello(msg);
    this._cancelNavigationOutcomeClear();
    this._setAppState({
      robotRuntime: runtimeState,
      navRuntimeErrorCode: null,
      navigationOutcome: "none",
    });
    this._applyRuntimeState(runtimeState);
  }

  private _projectRuntimeStateFromHello(msg: HelloMessage): RobotRuntimeState {
    const capabilities = createDefaultRobotRuntimeState().capabilities;
    Object.keys(msg.capability_states).forEach((capability) => {
      const state = msg.capability_states[capability];
      capabilities[capability] = {
        available: state.available,
        reason: state.reason ?? null,
      };
    });
    return {
      negotiated: true,
      robotId: msg.robot.robot_id,
      robotModel: msg.robot.robot_model,
      displayName: msg.robot.display_name,
      visualOriginFrame: msg.robot.visual_origin_frame,
      bodyBoundsM: msg.robot.body_bounds_m ?? null,
      footprintM: msg.robot.footprint_m ?? null,
      baseHeightM: msg.robot.base_height_m ?? null,
      defaultRenderOffsetM: msg.robot.default_render_offset_m ?? null,
      alignmentProfile: msg.robot.alignment_profile ?? null,
      capabilities,
    };
  }

  private _applyRuntimeState(state: RobotRuntimeState): void {
    if (!state.capabilities.lidar?.available && this.lidarMode !== "off") {
      this._setAppState({ lidarMode: "off" });
    }
    if (!state.capabilities.nav?.available && this.navigationPlacementEnabled) {
      this._setAppState({ navigationPlacementEnabled: false });
    }
    this.robotMarker?.setRenderOffsetCm(this._runtimeRenderOffsetCm(state));
    this._placementController?.setRobotGroundDeadzone({
      radiusCm: this._runtimeDeadzoneRadiusCm(state),
      getRobotWorldPosition: () => this.robotMarker?.getWorldPosition() ?? null,
    } as RobotGroundDeadzone);
    this._robotMenuController?.setRobotLabel(state.displayName);
    this._robotMenuController?.setNavigationPlacementAvailability(
      this.isRuntimeCapabilityAvailable("nav"),
    );
    this._robotMenuController?.setEmergencyStopAvailability(
      this.isRuntimeCapabilityAvailable("emergency_stop"),
      this.runtimeCapabilityUnavailableReason("emergency_stop"),
    );
    this._navigationController?.setCancelGoalAvailability(
      this.isRuntimeCapabilityAvailable("cancel_goal"),
      this.runtimeCapabilityUnavailableReason("cancel_goal"),
    );
    this._navigationController?.setGoalConfirmAvailability(
      this._canConfirmNavigationGoal(),
    );
    if (state.capabilities.nav?.available) {
      this._robotMenuController?.setNavigationPlacementToggle(this.navigationPlacementEnabled);
    }
    this._syncNavigationPlacementState();
    this._refreshRobotLidarAnchor();
    this._syncLiDARPreview();
  }

  private _runtimeDeadzoneRadiusCm(state: RobotRuntimeState): number {
    const footprint = state.footprintM;
    if (!state.negotiated || !footprint) {
      return this.robotGroundDeadzoneRadiusCm;
    }
    const maxDimensionCm = Math.max(footprint[0], footprint[1]) * 100.0;
    return Math.max(20.0, maxDimensionCm * 0.5 + 20.0);
  }

  private _runtimeRenderOffsetCm(state: RobotRuntimeState): vec3 {
    const offset = state.defaultRenderOffsetM;
    if (!offset) {
      return new vec3(0, 0, 0);
    }
    return protocolMetersToLensCentimeters(offset);
  }

  private _syncRobotLidarAnchor(position: vec3): void {
    const renderer = this.pointCloudRenderer;
    if (!renderer) {
      return;
    }
    renderer.setRobotWorldPosition(position);
    renderer.setRobotFloorWorldY(
      robotFloorWorldYCm(position.y, this.appState.robotRuntime),
    );
    const band = lidarVerticalBandCm(this.appState.robotRuntime);
    renderer.setLidarVerticalBand(band.minAboveFloorCm, band.maxAboveFloorCm);
  }

  private _refreshRobotLidarAnchor(): void {
    const markerPos = this.robotMarker?.getWorldPosition() ?? null;
    if (markerPos) {
      this._syncRobotLidarAnchor(markerPos);
      return;
    }
    if (this._lastPose) {
      this._syncRobotLidarAnchor(
        protocolMetersToLensCentimeters(this._lastPose.position),
      );
    }
  }

  private _robotFloorY(
    sourceY: number | null = this.robotMarker?.getWorldPosition()?.y ?? null,
  ): number | null {
    if (sourceY === null) {
      return null;
    }
    return robotFloorWorldYCm(sourceY, this.appState.robotRuntime);
  }

  private _robotFloorPosition(
    position: vec3 | null = this.robotMarker?.getWorldPosition() ?? null,
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

  private _renderCachedLidarIfAvailable(): void {
    const renderer = this.pointCloudRenderer;
    if (!renderer || this.lidarMode === "off" || !this._lastLidarPoints) {
      return;
    }
    this._refreshRobotLidarAnchor();
    renderer.renderPointCloud(this._lastLidarPoints);
  }

  private _syncLiDARPreview(): void {
    const renderer = this.pointCloudRenderer;
    if (!renderer) {
      return;
    }

    if (!this._isActive) {
      this._lastLidarPoints = null;
      this._lidarMeshDirty = false;
      renderer.clearAll();
      return;
    }

    const mode = this.lidarMode;
    if (mode === "off") {
      this._lastLidarPoints = null;
      this._lidarMeshDirty = false;
      renderer.clearAll();
      return;
    }

    renderer.setFullLidarVisible(mode === "full");

    if (this.hasBridgeConnection()) {
      if (mode !== "full") {
        renderer.clearFullLidar();
      }
      if (this._lastLidarPoints) {
        this._renderCachedLidarIfAvailable();
      } else {
        renderer.clearAll();
        renderer.setFullLidarVisible(mode === "full");
      }
      return;
    }

    const anchor = this.robotMarker?.getWorldPosition() ?? vec3.zero();
    this._syncRobotLidarAnchor(anchor);
    renderer.renderMockLidar(anchor);
  }

  public setIsActive(active: boolean): void {
    this._isActive = active;
    if (!active && this.pointCloudRenderer) {
      this.pointCloudRenderer.clearAll();
    }
    if (!active) {
      this._navigationController?.clearInactiveState();
      this._robotMenuController?.hide();
    }
    this._applyRobotInteractionMode(this.appState.robotInteractionMode);
    if (active) {
      this._syncLiDARPreview();
      if (this.bridgeClient?.lastBridgeStatus) {
        this._applyBridgeStatus(this.bridgeClient.lastBridgeStatus);
      } else {
        this._applyConnectionState(this.hasBridgeConnection());
      }
      this._syncRobotMarkerPose();
    }
  }

  public get isActive(): boolean {
    return this._isActive;
  }

  public enterSetup(): void {
    this._log("enterSetup");
    this.cancelManualAlignmentPlacement();
    this.stopManualAlignmentSession();
    this.clearManualAlignmentPose();
    this._preferManualPoseUntilNextRuntimePose = false;
    this._useManualPoseCorrection = false;
    this.disconnect();
    this.frameCaptureController?.setMode("off");
    this.setIsActive(false);
    this._setAppState({ navigationPlacementEnabled: true });
    this._robotMenuController?.setNavigationPlacementToggle(true);
    this._setNavigationMode("idle");
    this._setRobotInteractionMode("hidden");
    this._setAppState({ phase: "setup" });
  }

  public enterRuntime(): void {
    this._log("enterRuntime");
    this.cancelManualAlignmentPlacement();
    this.stopManualAlignmentSession();
    this._preferManualPoseUntilNextRuntimePose = this._manualAlignmentPose !== null;
    this._useManualPoseCorrection =
      this._manualAlignmentPose !== null &&
      Boolean(this.bridgeClient?.lastBridgeStatus?.registration_approximate);
    this._manualPoseCorrectionRotation = null;
    this._manualPoseCorrectionTranslation = null;
    this.setIsActive(true);
    if (this.frameCaptureController) {
      const registered = Boolean(this.bridgeClient?.lastBridgeStatus?.registered);
      this.frameCaptureController.setMode(registered ? "runtime" : "off");
    }
    this._setAppState({ phase: "runtime" });
    this._setRobotInteractionMode("runtimeRobot");
    this.setOperatingMode(this.operatingMode);
    this._syncRobotMarkerPose();
    this._syncNavigationPlacementState();
  }

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
    if (this.bridgeClient) {
      this.bridgeClient.saveIp(ip);
    }
  }

  public loadIp(): string | null {
    return this.bridgeClient ? this.bridgeClient.loadIp() : null;
  }

  public async checkConnection(): Promise<boolean> {
    if (!this.bridgeClient) {
      return false;
    }
    try {
      await this.bridgeClient.connect();
      const ready = await this.bridgeClient.waitForHello(3.0);
      if (ready) {
        this.bridgeClient.requestStatus();
      }
      return ready;
    } catch (error) {
      print(`DimosManager: checkConnection failed: ${error}`);
      return false;
    }
  }

  public disconnect(): void {
    if (this.bridgeClient) {
      this.bridgeClient.disconnect();
    }
    this._clearNavigationOutcome();
    this._setNavigationMode("idle");
    this._navigationController?.clearInactiveState();
  }

  public hasBridgeConnection(): boolean {
    return this.bridgeClient?.isConnected() ?? false;
  }

  public requestBridgeStatus(): boolean {
    return this.bridgeClient?.requestStatus() ?? false;
  }

  public placeRobotMarkerInFrontOf(reference: SceneObject): void {
    if (!reference) {
      return;
    }
    const transform = reference.getTransform();
    this._manualAlignmentPose = manualMarkerPoseFromReference(
      transform.getWorldPosition(),
      transform.getWorldRotation(),
    );
    this._manualAlignmentController?.placeRobotMarkerPose(this._manualAlignmentPose);
  }

  public beginManualAlignmentPlacement(
    reference: SceneObject,
  ): void {
    if (!reference) {
      return;
    }
    const transform = reference.getTransform();
    this.beginManualAlignmentPlacementAt(
      transform.getWorldPosition(),
      transform.getWorldRotation(),
    );
  }

  public beginManualAlignmentPlacementAt(position: vec3, rotation: quat): void {
    if (this._navigationController?.placementEnabled) {
      this._navigationController.setPlacementEnabled(false);
    }
    this._manualAlignmentPose = manualMarkerPoseFromReference(position, rotation);
    this._manualPoseCorrectionRotation = null;
    this._manualPoseCorrectionTranslation = null;
    const p = this._manualAlignmentPose.position;
    const r = this._manualAlignmentPose.rotation;
    this._log(
      `beginManualAlignmentPlacementAt: initial pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) rot=(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)}, ${r.w.toFixed(3)})`,
    );
    this._manualAlignmentController?.beginPlacementPose(this._manualAlignmentPose);
    this._setRobotInteractionMode("manualPlacement");
  }

  public clearManualAlignmentPose(): void {
    this._manualAlignmentPose = null;
    this._preferManualPoseUntilNextRuntimePose = false;
    this._useManualPoseCorrection = false;
    this._manualPoseCorrectionRotation = null;
    this._manualPoseCorrectionTranslation = null;
  }

  public cancelManualAlignmentPlacement(): void {
    this._manualAlignmentController?.cancelPlacement();
    if (this.appState.robotInteractionMode === "manualPlacement") {
      this._setRobotInteractionMode(this._isActive ? "runtimeRobot" : "hidden");
    }
  }

  public freezeManualAlignmentPlacement(): void {
    if (this.appState.robotInteractionMode !== "manualPlacement") {
      return;
    }
    this.robotMarker?.setVisible(true);
    this.robotMarker?.setToggleEnabled(false);
    this.robotMarker?.setMenuEnabled(false);
    this.robotMarker?.setManualPlacementEnabled(false);
  }

  public startManualAlignmentSession(): boolean {
    return (
      this._manualAlignmentController?.startSession(
        this.hasBridgeConnection(),
      ) ?? false
    );
  }

  public submitManualAlignmentCandidate(position: vec3, rotation: quat): boolean {
    const markerPose = manualMarkerPoseFromMarkerWorldPose(position, rotation);
    return (
      this._manualAlignmentController?.submitCandidate(
        position,
        markerPose.rotation,
        this.hasBridgeConnection(),
      ) ?? false
    );
  }

  public stopManualAlignmentSession(): void {
    this._manualAlignmentController?.stopSession(this.hasBridgeConnection());
  }

  public hideRobotMarkerPreview(): void {
    this._applyRobotInteractionMode(this.appState.robotInteractionMode);
  }

  public setLidarMode(mode: LidarDisplayMode): void {
    if (this.lidarMode === mode) {
      return;
    }
    this._setAppState({ lidarMode: mode });
    this._syncLiDARPreview();
    if (mode === "off" && !this._canStartNavigationPlacement()) {
      this._navigationController?.setPlacementEnabled(false);
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
    if (this.appState.operatingMode !== mode) {
      this._cancelMainMenuSettingsToggle();
      this.setOperatingMode(mode);
      this._blockSettingsToggleBriefly();
      return;
    }
    this._scheduleMainMenuSettingsToggle(mode);
  }

  private _cancelMainMenuSettingsToggle(): void {
    this._settingsTogglePendingMode = null;
  }

  private _blockSettingsToggleBriefly(): void {
    this._blockSettingsToggleUntil = getTime() + 0.35;
  }

  /** Coalesce same-frame duplicate presses before submenu scale-in can re-trigger. */
  private _scheduleMainMenuSettingsToggle(mode: OperatingMode): void {
    if (getTime() < this._blockSettingsToggleUntil) {
      return;
    }
    if (this.appState.operatingMode !== mode) {
      return;
    }
    if (this._settingsTogglePendingMode === mode) {
      return;
    }
    this._settingsTogglePendingMode = mode;
    if (!this._settingsToggleEvent) {
      const event = this.createEvent("DelayedCallbackEvent");
      event.bind(() => {
        const pendingMode = this._settingsTogglePendingMode;
        this._settingsTogglePendingMode = null;
        if (!pendingMode || this.appState.operatingMode !== pendingMode) {
          return;
        }
        const nextExpanded =
          this.appState.mainMenuExpandedSettingsMode === pendingMode
            ? null
            : pendingMode;
        this._setAppState({ mainMenuExpandedSettingsMode: nextExpanded });
      });
      this._settingsToggleEvent = event;
    }
    (this._settingsToggleEvent as DelayedCallbackEvent).reset(0);
  }

  public setOperatingMode(mode: OperatingMode): void {
    const modeChanged = this.appState.operatingMode !== mode;
    if (!modeChanged) {
      return;
    }
    this._cancelMainMenuSettingsToggle();
    this._log(`setOperatingMode: ${mode}`);
    const lidarMode: LidarDisplayMode = mode === "manual" ? "obstacles" : "off";
    this._setAppState({
      operatingMode: mode,
      lidarMode,
      mainMenuExpandedSettingsMode: null,
    });
    this._syncLiDARPreview();
    if (lidarMode === "off" && !this._canStartNavigationPlacement()) {
      this._navigationController?.setPlacementEnabled(false);
    }
    this._robotMenuController?.setOperatingMode(mode);
    if (mode !== "manual") {
      this._navigationController?.setPlacementEnabled(false);
    }
    this._syncNavigationPlacementState();
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
    if (!enabled) {
      const stopActiveNavigation =
        this.operatingMode === "manual" && this.appState.navigationMode === "executingGoal";
      if (stopActiveNavigation) {
        if (this.isRuntimeCapabilityAvailable("emergency_stop")) {
          this._log("setNavigationPlacementEnabled: stopping active navigation via emergency stop");
          this._navigationController?.requestEmergencyStop();
        } else if (this.isRuntimeCapabilityAvailable("cancel_goal")) {
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

  public get navigationPlacementEnabled(): boolean {
    return this.appState.navigationPlacementEnabled;
  }

  public captureManualAlignmentCandidate(): boolean {
    const candidate = this._manualAlignmentController?.captureCandidate();
    if (!candidate) {
      return false;
    }
    this._manualAlignmentPose = manualMarkerPoseFromMarkerWorldPose(
      candidate.position,
      candidate.rotation,
    );
    return this.submitManualAlignmentCandidate(
      candidate.position,
      candidate.rotation,
    );
  }

  public finalizeOfflineManualAlignment(): boolean {
    const candidate = this._manualAlignmentController?.captureCandidate();
    if (!candidate) {
      this._log("finalizeOfflineManualAlignment: no candidate captured");
      return false;
    }
    this._manualAlignmentPose = manualMarkerPoseFromMarkerWorldPose(
      candidate.position,
      candidate.rotation,
    );
    const r = candidate.rotation;
    this._log(
      `finalizeOfflineManualAlignment: captured pos=(${candidate.position.x.toFixed(1)}, ${candidate.position.y.toFixed(1)}, ${candidate.position.z.toFixed(1)}) rot=(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)}, ${r.w.toFixed(3)})`,
    );
    return true;
  }

  public get placementMode(): boolean {
    return this.appState.navigationMode === "placingGoal";
  }

  public requestEmergencyStop(): void {
    if (!this.isRuntimeCapabilityAvailable("emergency_stop")) {
      return;
    }
    this._log("requestEmergencyStop");
    this._navigationController?.requestEmergencyStop();
  }

  private _applyPath(msg: PathMessage): void {
    const robotY = this._robotFloorY();
    const goalY = this._goalRenderer?.worldPosition.y ?? null;
    if (robotY !== null && goalY !== null) {
      this._pathRenderer?.setHeightRange(robotY, goalY);
    }
    this._navigationController?.applyPath(msg);
  }

  private _applyPathPreview(msg: PathPreviewMessage): void {
    this._navigationController?.applyPathPreview(msg);
  }

  private _applyNavStatus(msg: NavStatusMessage): void {
    this._protocolParseFailureCount = 0;
    const navLabel = this._navigationController?.applyNavStatus(msg) ?? "Idle";

    if (msg.recovering) {
      this._clearNavigationOutcome();
      return;
    }

    if (navLabel === "Goal reached") {
      this._setNavigationOutcome("success");
      return;
    }

    if (navLabel === "Goal failed") {
      if (msg.error_code !== undefined) {
        this._disableNavRuntime(msg.error_code);
        return;
      }
      this._setNavigationOutcome("failed");
    }
  }

  private _disableNavRuntime(errorCode: number): void {
    const capabilities = {
      ...this.appState.robotRuntime.capabilities,
      nav: {
        available: false,
        reason: `Bridge Error (${errorCode})`,
      },
    };
    const runtimeState: RobotRuntimeState = {
      ...this.appState.robotRuntime,
      capabilities,
    };
    this._cancelNavigationOutcomeClear();
    this._setAppState({
      navRuntimeErrorCode: errorCode,
      navigationOutcome: "failed",
      robotRuntime: runtimeState,
    });
    this._scheduleNavigationOutcomeClear();
    this._applyRuntimeState(runtimeState);
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    if (msg.registered && msg.registration_approximate && this._manualAlignmentPose) {
      this._useManualPoseCorrection = true;
    }
    if (
      msg.registered &&
      !msg.registration_approximate &&
      this.appState.robotInteractionMode !== "manualPlacement"
    ) {
      this._useManualPoseCorrection = false;
      this.clearManualAlignmentPose();
    }
    this._syncBridgeLinkState(true, msg);
    this._robotMenuController?.applyBridgeLinkState(this.bridgeLinkState);
    this.onBridgeStatusChanged.forEach((cb) => cb(msg));
    this._syncLiDARPreview();
  }

  private _applyConnectionState(connected: boolean): void {
    this._log(`bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._syncBridgeLinkState(connected, connected ? this.lastBridgeStatus : null);
    this._robotMenuController?.applyBridgeLinkState(this.bridgeLinkState);
    this.onBridgeConnectionChanged.forEach((cb) => cb(connected));
    if (!connected) {
      this._lastLidarPoints = null;
      this._navigationController?.clearInactiveState();
      this._protocolParseFailureCount = 0;
      this._cancelNavigationOutcomeClear();
      const defaultRuntime = createDefaultRobotRuntimeState();
      this._setAppState({
        navigationMode: "idle",
        navigationOutcome: "none",
        navRuntimeErrorCode: null,
        robotRuntime: defaultRuntime,
      });
      this._applyRuntimeState(defaultRuntime);
      this._preferManualPoseUntilNextRuntimePose = this._manualAlignmentPose !== null;
      this._manualPoseCorrectionRotation = null;
      this._manualPoseCorrectionTranslation = null;
      this.robotMarker?.resetRuntimePoseSmoothing();
    }
    this._syncLiDARPreview();
  }

  private _canStartNavigationPlacement(): boolean {
    if (this.operatingMode !== "manual") {
      return false;
    }
    if (!this._isActive) {
      return false;
    }
    if (!this.isRuntimeCapabilityAvailable("nav")) {
      return false;
    }
    return this.appState.robotInteractionMode === "runtimeRobot";
  }

  private _canSendNavigationGoal(): boolean {
    return (
      this.hasBridgeConnection() &&
      this.isRuntimeCapabilityAvailable("nav") &&
      (this.bridgeClient?.lastBridgeStatus?.registered ?? false)
    );
  }

  private _canConfirmNavigationGoal(): boolean {
    return (
      this.isRuntimeCapabilityAvailable("nav") &&
      this.appState.navRuntimeErrorCode === null
    );
  }

  private _deriveBridgeLinkState(
    connected: boolean = this.hasBridgeConnection(),
    status: BridgeStatusMessage | null = this.lastBridgeStatus,
  ): BridgeLinkState {
    if (!connected) {
      return "disconnected";
    }
    if (!status?.robot_connected) {
      return "connectedNoRobot";
    }
    return "connected";
  }

  private _syncBridgeLinkState(
    connected: boolean = this.hasBridgeConnection(),
    status: BridgeStatusMessage | null = this.lastBridgeStatus,
  ): void {
    const bridgeLinkState = this._deriveBridgeLinkState(connected, status);
    if (this.appState.bridgeLinkState === bridgeLinkState) {
      return;
    }
    this._setAppState({ bridgeLinkState });
  }

  private _setAppState(patch: Partial<DimosAppState>): void {
    this._appState.update(patch);
  }

  private _setRobotInteractionMode(mode: RobotInteractionMode): void {
    if (this.appState.robotInteractionMode === mode) {
      this._applyRobotInteractionMode(mode);
      return;
    }
    this._log(`robotInteractionMode: ${mode}`);
    this._setAppState({ robotInteractionMode: mode });
    this._applyRobotInteractionMode(mode);
  }

  private _clearNavigationOutcome(): void {
    this._cancelNavigationOutcomeClear();
    if (this.appState.navigationOutcome === "none") {
      return;
    }
    this._setAppState({ navigationOutcome: "none" });
  }

  private _setNavigationOutcome(outcome: "success" | "failed"): void {
    this._cancelNavigationOutcomeClear();
    this._setAppState({ navigationOutcome: outcome });
    this._scheduleNavigationOutcomeClear();
  }

  private _scheduleNavigationOutcomeClear(): void {
    this._navigationOutcomeClearSeq += 1;
    this._navigationOutcomeClearDueSeq = this._navigationOutcomeClearSeq;
    if (!this._navigationOutcomeClearEvent) {
      const event = this.createEvent("DelayedCallbackEvent");
      event.bind(() => {
        if (
          this._navigationOutcomeClearSeq !== this._navigationOutcomeClearDueSeq
        ) {
          return;
        }
        this._clearNavigationOutcome();
      });
      this._navigationOutcomeClearEvent = event;
    }
    (this._navigationOutcomeClearEvent as DelayedCallbackEvent).reset(
      NAVIGATION_OUTCOME_FLASH_S,
    );
  }

  private _cancelNavigationOutcomeClear(): void {
    this._navigationOutcomeClearSeq += 1;
  }

  private _setNavigationMode(mode: NavigationMode): void {
    if (mode === "executingGoal") {
      if (
        this.appState.navigationMode === mode &&
        this.appState.navigationOutcome === "none"
      ) {
        return;
      }
      this._cancelNavigationOutcomeClear();
      this._setAppState({
        navigationOutcome: "none",
        navigationMode: mode,
      });
      return;
    }
    if (this.appState.navigationMode === mode) {
      return;
    }
    this._setAppState({ navigationMode: mode });
  }

  private _robotMarkerReady(): boolean {
    const marker = this.robotMarker as RobotMarker | null;
    return marker != null && typeof marker.setVisible === "function";
  }

  private _applyRobotInteractionMode(mode: RobotInteractionMode): void {
    if (!this._robotMarkerReady()) {
      return;
    }
    const marker = this.robotMarker;
    switch (mode) {
      case "hidden":
        marker.setManualPlacementEnabled(false);
        marker.setToggleEnabled(false);
        marker.setMenuEnabled(false);
        marker.setVisible(false);
        this._robotMenuController?.hide();
        this._syncNavigationPlacementState();
        return;
      case "manualPlacement":
        marker.setVisible(true);
        marker.setToggleEnabled(false);
        marker.setMenuEnabled(false);
        marker.setManualPlacementEnabled(true);
        this._robotMenuController?.hide();
        this._syncRobotMarkerPose();
        this._syncNavigationPlacementState();
        return;
      case "runtimeRobot":
        marker.setVisible(this._isActive);
        marker.setToggleEnabled(this._isActive);
        marker.setMenuEnabled(this._isActive);
        marker.setManualPlacementEnabled(false);
        if (this._isActive) {
          this._robotMenuController?.setOperatingMode(this.operatingMode);
          this._syncRobotMarkerPose();
        } else {
          this._robotMenuController?.hide();
        }
        this._syncNavigationPlacementState();
        return;
    }
  }

  private _syncRobotMarkerPose(): void {
    if (!this.robotMarker) {
      return;
    }
    if (
      this._manualAlignmentPose &&
      (this.appState.robotInteractionMode === "manualPlacement" ||
        this._preferManualPoseUntilNextRuntimePose)
    ) {
    this.robotMarker.applyManualPose(
        this._manualAlignmentPose.position,
        this._manualAlignmentPose.rotation,
      );
      return;
    }
    if (this._lastPose && this.appState.robotInteractionMode !== "manualPlacement") {
      this._applyRobotDisplayPose(this._lastPose);
      return;
    }
    if (this._manualAlignmentPose) {
      this.robotMarker.applyManualPose(
        this._manualAlignmentPose.position,
        this._manualAlignmentPose.rotation,
      );
    }
  }

  private _applyRobotDisplayPose(msg: PoseMessage): void {
    if (!this.robotMarker) {
      return;
    }

    const shouldApplyManualCorrection =
      this._manualAlignmentPose !== null && this._useManualPoseCorrection;
    if (!shouldApplyManualCorrection) {
      this._preferManualPoseUntilNextRuntimePose = false;
      this.robotMarker.applyPose(msg);
      const worldPos = protocolMetersToLensCentimeters(msg.position);
      this.frameCaptureController?.setRobotWorldPosition(worldPos);
      return;
    }

    const q = msg.orientation;
    const bridgePosition = protocolMetersToLensCentimeters(msg.position);
    const bridgeRotation = new quat(q[3], q[0], q[1], q[2]);

    if (
      this._manualPoseCorrectionRotation === null ||
      this._manualPoseCorrectionTranslation === null
    ) {
      const anchorPosition = this._manualAlignmentPose.position;
      const anchorRotation = this._manualAlignmentPose.rotation;
      this._manualPoseCorrectionRotation = anchorRotation.multiply(
        bridgeRotation.invert(),
      );
      const rotatedBridgePos =
        this._manualPoseCorrectionRotation.multiplyVec3(bridgePosition);
      this._manualPoseCorrectionTranslation =
        anchorPosition.sub(rotatedBridgePos);
    }

    const correctedRotation =
      this._manualPoseCorrectionRotation.multiply(bridgeRotation);
    const correctedPosition = this._manualPoseCorrectionRotation
      .multiplyVec3(bridgePosition)
      .add(this._manualPoseCorrectionTranslation);
    this._preferManualPoseUntilNextRuntimePose = false;
    this.robotMarker.applyRuntimeLensPose(correctedPosition, correctedRotation);
  }

  private _syncNavigationPlacementState(): void {
    if (!this._navigationController) {
      return;
    }
    if (!this.navigationPlacementEnabled || !this._canStartNavigationPlacement()) {
      this._navigationController.setPlacementEnabled(false);
      if (this.appState.navigationMode !== "idle") {
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
    const markerPosition = this.robotMarker?.getWorldPosition() ?? null;
    const markerRotation = this.robotMarker?.getRotation() ?? null;
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
    if (!this._lastPose) {
      return null;
    }
    const q = this._lastPose.orientation;
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    const position = protocolMetersToLensCentimeters(this._lastPose.position);
    const floorPosition = this._robotFloorPosition(position);
    if (!floorPosition) {
      return null;
    }
    return {
      position: floorPosition,
      rotation,
    };
  }

  private _log(message: string): void {
    print(`DimosManager: ${message}`);
  }
}
