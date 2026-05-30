import { BridgeClient } from "./Network/BridgeClient";
import { AlignmentController } from "./Alignment/AlignmentController";
import { LidarPointCloud } from "./Rendering/LidarPointCloud";
import { RobotMarker } from "./Rendering/RobotMarker";
import { ObstacleHighlightRenderer } from "./Rendering/ObstacleHighlightRenderer";
import { PathRenderer } from "./Rendering/PathRenderer";
import { NavigationMarkerView } from "./Navigation/NavigationMarkerView";
import { PlacementController } from "./Navigation/PlacementController";
import { RobotMenuView } from "./UI/RobotMenuView";
import { RobotMenuController } from "./UI/RobotMenuController";
import { NavigationController } from "./Navigation/NavigationController";
import { ManualAlignmentController } from "./Alignment/ManualAlignmentController";
import {
  manualMarkerPoseFromMarkerWorldPose,
  manualMarkerPoseFromReference,
  ManualAlignmentPose,
} from "./Alignment/ManualAlignmentPose";
import { findChildRecursive } from "./UI/Shared/SceneLookup";
import {
  AppState,
  AppStateListener,
  DimosAppState,
  NavigationMode,
  OperatingMode,
  RobotInteractionMode,
} from "./AppState";
import {
  BridgeStatusMessage,
  NavStatusMessage,
  PathMessage,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "./Network/Protocol";

const WorldQueryModule = require("LensStudio:WorldQueryModule");
const NAVIGATION_MARKER_FORWARD_OFFSET_CM = 50.0;

/**
 * Top-level orchestrator. SetupWizard completes first, then hands control here.
 */
@component
export class DimosManager extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  alignmentController: AlignmentController;

  @input
  lidarPointCloud: LidarPointCloud;

  @input
  robotMarker: RobotMarker;

  @input
  placementRayOrigin: SceneObject;

  public onBridgeReady: (() => void)[] = [];
  public onBridgeStatusChanged: ((msg: BridgeStatusMessage) => void)[] = [];
  public onBridgeConnectionChanged: ((connected: boolean) => void)[] = [];

  private _isActive = false;
  private _registrationApproximate = false;
  private _lastPose: PoseMessage | null = null;
  private _manualAlignmentPose: ManualAlignmentPose | null = null;
  private _preferManualPoseUntilNextRuntimePose = false;
  private readonly _appState = new AppState({
    phase: "setup",
    debugMode: false,
    operatingMode: "manual",
    executeMovement: true,
    navigationPlacementEnabled: true,
    robotInteractionMode: "hidden",
    navigationMode: "idle",
  });

  private _goalRenderer: NavigationMarkerView | null = null;
  private _pathRenderer: PathRenderer | null = null;
  private _obstacleRenderer: ObstacleHighlightRenderer | null = null;
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

  public get lastBridgeStatus(): BridgeStatusMessage | null {
    return this.bridgeClient?.lastBridgeStatus ?? null;
  }

  private _createHelpers(): void {
    const parent =
      this.robotMarker?.markerRoot?.getParent() ??
      this.lidarPointCloud?.pointParent?.getParent() ??
      this.getSceneObject();
    const template = this.lidarPointCloud?.pointTemplate ?? null;
    const navigationMarkerRoot = this._requireSceneObject(
      "SurfacePlacementMarker",
    );

    this._goalRenderer = new NavigationMarkerView(navigationMarkerRoot);
    this._pathRenderer = new PathRenderer(parent, template);
    this._obstacleRenderer = new ObstacleHighlightRenderer(parent, template);
    this._placementController = new PlacementController(
      this,
      WorldQueryModule,
      this.placementRayOrigin ?? null,
      this._goalRenderer,
    );

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
      obstacleRenderer: this._obstacleRenderer,
      placementController: this._placementController,
      onNavigationModeChanged: (mode) => this._setNavigationMode(mode),
      isExecuteMovementEnabled: () => this.executeMovement,
      canStartPlacement: () => this._canStartNavigationPlacement(),
      canSendNavGoal: () => this._canSendNavigationGoal(),
    });
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
    this.bridgeClient.onHello.push(() => {
      this.onBridgeReady.forEach((cb) => cb());
    });
    this.bridgeClient.onLidar.push((msg) => {
      if (this._isActive && this.debugMode && this.lidarPointCloud) {
        this.lidarPointCloud.queueLidar(msg);
      }
      this._obstacleRenderer?.updateLidar(msg);
    });
    this.bridgeClient.onPose.push((msg) => {
      this._lastPose = msg;
      (this.lidarPointCloud as any)?.setRobotWorldPosition?.(
        protocolMetersToLensCentimeters(msg.position),
      );
      if (this._isActive && this.robotMarker) {
        this._preferManualPoseUntilNextRuntimePose = false;
        this._manualAlignmentPose = null;
        this.robotMarker.applyPose(msg);
      }
    });
    this.bridgeClient.onPath.push((msg) => this._applyPath(msg));
    this.bridgeClient.onNavStatus.push((msg) => this._applyNavStatus(msg));
    this.bridgeClient.onBridgeStatus.push((msg) => this._applyBridgeStatus(msg));
    this.bridgeClient.onConnectionChanged.push((connected) =>
      this._applyConnectionState(connected),
    );
  }

  public setIsActive(active: boolean): void {
    this._isActive = active;
    if (!active && this.lidarPointCloud) {
      this.lidarPointCloud.clear();
    }
    if (!active) {
      this._navigationController?.clearInactiveState();
      this._robotMenuController?.hide();
    }
    this._applyRobotInteractionMode(this.appState.robotInteractionMode);
    if (active) {
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
    this._manualAlignmentController?.beginPlacementPose(this._manualAlignmentPose);
    this._setRobotInteractionMode("manualPlacement");
  }

  public clearManualAlignmentPose(): void {
    this._manualAlignmentPose = null;
    this._preferManualPoseUntilNextRuntimePose = false;
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

  public setDebugMode(enabled: boolean): void {
    if (this.debugMode === enabled) {
      return;
    }
    this._setAppState({ debugMode: enabled });
    if (this.alignmentController) {
      this.alignmentController.setDebugMode(enabled);
    }
    if (!enabled && this.lidarPointCloud) {
      this.lidarPointCloud.clear();
    }
    if (!enabled && !this._canStartNavigationPlacement()) {
      this._navigationController?.setPlacementEnabled(false);
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

  public setExecuteMovement(enabled: boolean): void {
    if (this.executeMovement === enabled) {
      return;
    }
    this._setAppState({ executeMovement: enabled });
  }

  public get executeMovement(): boolean {
    return this.appState.executeMovement;
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
    if (candidate) {
      this._manualAlignmentPose = manualMarkerPoseFromMarkerWorldPose(
        candidate.position,
        candidate.rotation,
      );
      return true;
    }
    return this._manualAlignmentPose !== null;
  }

  public get placementMode(): boolean {
    return this.appState.navigationMode === "placingGoal";
  }

  public requestEmergencyStop(): void {
    this._log("requestEmergencyStop");
    this._navigationController?.requestEmergencyStop();
  }

  private _applyPath(msg: PathMessage): void {
    this._navigationController?.applyPath(msg);
  }

  private _applyNavStatus(msg: NavStatusMessage): void {
    this._navigationController?.applyNavStatus(msg);
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    this._registrationApproximate = Boolean(msg.registration_approximate);
    this._robotMenuController?.applyBridgeStatus(msg);
    this.onBridgeStatusChanged.forEach((cb) => cb(msg));
  }

  private _applyConnectionState(connected: boolean): void {
    this._log(`bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._robotMenuController?.applyConnectionState(connected);
    this.onBridgeConnectionChanged.forEach((cb) => cb(connected));
    if (!connected) {
      this._preferManualPoseUntilNextRuntimePose = this._manualAlignmentPose !== null;
      this.robotMarker?.resetRuntimePoseSmoothing();
    }
  }

  private _canStartNavigationPlacement(): boolean {
    if (this.operatingMode !== "manual") {
      return false;
    }
    if (!this._isActive) {
      return false;
    }
    return this.appState.robotInteractionMode === "runtimeRobot";
  }

  private _canSendNavigationGoal(): boolean {
    return (
      this.hasBridgeConnection() &&
      (this.bridgeClient?.hasCapability("nav") ?? false) &&
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
      this.robotMarker.applyPose(this._lastPose);
      return;
    }
    if (this._manualAlignmentPose) {
      this.robotMarker.applyManualPose(
        this._manualAlignmentPose.position,
        this._manualAlignmentPose.rotation,
      );
    }
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
      return {
        position: this._offsetNavigationStartPosition(markerPosition, markerRotation),
        rotation: markerRotation,
      };
    }
    if (!this._lastPose) {
      return null;
    }
    const q = this._lastPose.orientation;
    const rotation = new quat(q[0], q[1], q[2], q[3]);
    const position = protocolMetersToLensCentimeters(this._lastPose.position);
    return {
      position: this._offsetNavigationStartPosition(position, rotation),
      rotation,
    };
  }

  private _offsetNavigationStartPosition(
    position: vec3,
    rotation: quat,
  ): vec3 {
    const robotForward = rotation.multiplyVec3(vec3.right());
    const planarLength = Math.sqrt(
      robotForward.x * robotForward.x + robotForward.z * robotForward.z,
    );
    if (planarLength <= 0.0001) {
      return new vec3(
        position.x + NAVIGATION_MARKER_FORWARD_OFFSET_CM,
        position.y,
        position.z,
      );
    }
    return new vec3(
      position.x + (robotForward.x / planarLength) * NAVIGATION_MARKER_FORWARD_OFFSET_CM,
      position.y,
      position.z + (robotForward.z / planarLength) * NAVIGATION_MARKER_FORWARD_OFFSET_CM,
    );
  }

  private _log(message: string): void {
    print(`DimosManager: ${message}`);
  }
}
