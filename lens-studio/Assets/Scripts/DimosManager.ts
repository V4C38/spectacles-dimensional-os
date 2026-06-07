import { BridgeClient } from "./Network/BridgeClient";
import { AlignmentController } from "./Alignment/AlignmentController";
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
  createDefaultRobotRuntimeState,
  DimosAppState,
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
  protocolMetersToLensCentimeters,
} from "./Network/Protocol";
import { HelloMessage } from "./Network/ProtocolTypes";

const WorldQueryModule = require("LensStudio:WorldQueryModule");

// ================================================================
// ================================================================
/** Scene-root orchestrator wiring bridge I/O, alignment, rendering, navigation, and robot menu after setup completes. */
@component
export class DimosManager extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  alignmentController: AlignmentController;

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
  private _manualAlignmentPose: ManualAlignmentPose | null = null;
  private _preferManualPoseUntilNextRuntimePose = false;
  private _useManualPoseCorrection = false;
  private _manualPoseCorrectionRotation: quat | null = null;
  private _manualPoseCorrectionTranslation: vec3 | null = null;
  private readonly _appState = new AppState({
    phase: "setup",
    debugMode: false,
    showLiDAR: false,
    operatingMode: "manual",
    navigationPlacementEnabled: true,
    robotInteractionMode: "hidden",
    navigationMode: "idle",
    robotRuntime: createDefaultRobotRuntimeState(),
  });

  private _goalRenderer: NavigationMarkerView | null = null;
  private _pathRenderer: PathRenderer | null = null;
  private _placementController: PlacementController | null = null;
  private _robotMenuController: RobotMenuController | null = null;
  private _navigationController: NavigationController | null = null;
  private _manualAlignmentController: ManualAlignmentController | null = null;

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
        () => this._robotMenuController?.toggleVisible(),
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
      if (this._isActive && this.pointCloudRenderer) {
        this.pointCloudRenderer.updateLidar(msg);
      }
    });
    this.bridgeClient.onPose.push((msg) => {
      this._lastPose = msg;
      const robotLensPos = protocolMetersToLensCentimeters(msg.position);
      this.pointCloudRenderer?.setRobotWorldPosition(robotLensPos);
      if (this._isActive && this.robotMarker) {
        this._applyRobotDisplayPose(msg);
      }
    });
    this.bridgeClient.onPath.push((msg) => this._applyPath(msg));
    this.bridgeClient.onPathPreview.push((msg) => this._applyPathPreview(msg));
    this.bridgeClient.onNavStatus.push((msg) => this._applyNavStatus(msg));
    this.bridgeClient.onBridgeStatus.push((msg) => this._applyBridgeStatus(msg));
    this.bridgeClient.onConnectionChanged.push((connected) =>
      this._applyConnectionState(connected),
    );
    this._syncLiDARPreview();
  }

  private _applyHello(msg: HelloMessage): void {
    const runtimeState = this._projectRuntimeStateFromHello(msg);
    this._setAppState({ robotRuntime: runtimeState });
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
      bridgeConnected: true,
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
    if (!state.capabilities.lidar?.available && this.showLiDAR) {
      this._setAppState({ showLiDAR: false });
    }
    if (!state.capabilities.nav?.available && this.navigationPlacementEnabled) {
      this._setAppState({ navigationPlacementEnabled: false });
    }
    this.robotMarker?.setMenuHeightOffsetCm(this._runtimeMenuHeightOffsetCm(state));
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
    if (state.capabilities.nav?.available) {
      this._robotMenuController?.setNavigationPlacementToggle(this.navigationPlacementEnabled);
    }
    this._syncNavigationPlacementState();
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

  private _runtimeMenuHeightOffsetCm(state: RobotRuntimeState): number {
    const heightM = state.negotiated
      ? state.baseHeightM ?? (state.bodyBoundsM ? state.bodyBoundsM[2] : null)
      : null;
    if (heightM === null) {
      return 15.0;
    }
    return Math.max(15.0, heightM * 100.0 + 10.0);
  }

  private _runtimeRenderOffsetCm(state: RobotRuntimeState): vec3 {
    const offset = state.defaultRenderOffsetM;
    if (!offset) {
      return new vec3(0, 0, 0);
    }
    return protocolMetersToLensCentimeters(offset);
  }

  private _robotFloorY(
    sourceY: number | null = this.robotMarker?.getWorldPosition()?.y ?? null,
  ): number | null {
    if (sourceY === null) {
      return null;
    }
    const baseHeightM = this.appState.robotRuntime.baseHeightM;
    if (baseHeightM === null) {
      return sourceY;
    }
    return sourceY - baseHeightM * 100.0;
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

  private _syncLiDARPreview(): void {
    const renderer = this.pointCloudRenderer;
    if (!renderer) {
      return;
    }

    const showMock =
      this._isActive && this.showLiDAR && !this.hasBridgeConnection();
    if (showMock) {
      const anchor = this.robotMarker?.getWorldPosition() ?? vec3.zero();
      renderer.setRobotWorldPosition(anchor);
      renderer.setHeightLayerVisible(true);
      renderer.showMockHeightCloud(anchor);
      return;
    }

    renderer.setHeightLayerVisible(this.showLiDAR);
    if (!this.hasBridgeConnection()) {
      renderer.clearAll();
    } else if (!this.showLiDAR) {
      renderer.clearHeightLayer();
    }
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

  public setShowLiDAR(enabled: boolean): void {
    if (this.showLiDAR === enabled) {
      return;
    }
    this._setAppState({ showLiDAR: enabled });
    this._syncLiDARPreview();
    if (!enabled && !this._canStartNavigationPlacement()) {
      this._navigationController?.setPlacementEnabled(false);
    }
  }

  public get showLiDAR(): boolean {
    return this.appState.showLiDAR;
  }

  public setDebugMode(enabled: boolean): void {
    if (this.debugMode === enabled) {
      return;
    }
    this._setAppState({ debugMode: enabled });
    if (this.alignmentController) {
      this.alignmentController.setDebugMode(enabled);
    }
  }

  public get debugMode(): boolean {
    return this.appState.debugMode;
  }

  public setOperatingMode(mode: OperatingMode): void {
    const modeChanged = this.appState.operatingMode !== mode;
    if (modeChanged) {
      this._log(`setOperatingMode: ${mode}`);
      this._setAppState({ operatingMode: mode });
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
    this._navigationController?.applyNavStatus(msg);
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
    this._robotMenuController?.applyBridgeStatus(msg);
    this.onBridgeStatusChanged.forEach((cb) => cb(msg));
  }

  private _applyConnectionState(connected: boolean): void {
    this._log(`bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._robotMenuController?.applyConnectionState(connected);
    this.onBridgeConnectionChanged.forEach((cb) => cb(connected));
    if (!connected) {
      const defaultRuntime = createDefaultRobotRuntimeState();
      this._setAppState({ robotRuntime: defaultRuntime });
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

  private _setNavigationMode(mode: NavigationMode): void {
    if (this.appState.navigationMode === mode) {
      return;
    }
    this._setAppState({ navigationMode: mode });
  }

  private _applyRobotInteractionMode(mode: RobotInteractionMode): void {
    if (!this.robotMarker) {
      return;
    }
    switch (mode) {
      case "hidden":
        this.robotMarker.setManualPlacementEnabled(false);
        this.robotMarker.setToggleEnabled(false);
        this.robotMarker.setMenuEnabled(false);
        this.robotMarker.setVisible(false);
        this._robotMenuController?.hide();
        this._syncNavigationPlacementState();
        return;
      case "manualPlacement":
        this.robotMarker.setVisible(true);
        this.robotMarker.setToggleEnabled(false);
        this.robotMarker.setMenuEnabled(false);
        this.robotMarker.setManualPlacementEnabled(true);
        this._robotMenuController?.hide();
        this._syncRobotMarkerPose();
        this._syncNavigationPlacementState();
        return;
      case "runtimeRobot":
        this.robotMarker.setVisible(this._isActive);
        this.robotMarker.setToggleEnabled(this._isActive);
        this.robotMarker.setMenuEnabled(this._isActive);
        this.robotMarker.setManualPlacementEnabled(false);
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
    const markerRotation = this.robotMarker?.getWorldRotation() ?? null;
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
