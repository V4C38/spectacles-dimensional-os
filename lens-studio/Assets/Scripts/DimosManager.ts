import { BridgeClient } from "./Network/BridgeClient";
import { AlignmentController } from "./Alignment/AlignmentController";
import { LidarPointCloud } from "./Rendering/LidarPointCloud";
import { RobotMarker } from "./Rendering/RobotMarker";
import { GoalMarkerRenderer } from "./Rendering/GoalMarkerRenderer";
import { ObstacleHighlightRenderer } from "./Rendering/ObstacleHighlightRenderer";
import { PathRenderer } from "./Rendering/PathRenderer";
import { PlacementController } from "./Navigation/PlacementController";
import { RobotMenuView } from "./UI/RobotMenuView";
import { BridgeStatusMessage, NavStatusMessage, PathMessage, PoseMessage, protocolMetersToLensCentimeters } from "./Network/Protocol";

const WorldQueryModule = require("LensStudio:WorldQueryModule");
const GestureModule = require("LensStudio:GestureModule");

/**
 * Top-level orchestrator. SetupWizard completes first, then hands control here.
 */
@component
export class DimosManager extends BaseScriptComponent {
  private static readonly MANUAL_MARKER_DOWN_CM = 35.0;

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

  public onDebugModeChanged: ((enabled: boolean) => void)[] = [];
  public onShowLidarChanged: ((enabled: boolean) => void)[] = [];
  public onPlacementModeChanged: ((enabled: boolean) => void)[] = [];
  public onExecuteMovementChanged: ((enabled: boolean) => void)[] = [];

  private _isActive = false;
  private _debugMode = false;
  private _showLidar = true;
  private _executeMovement = true;
  private _placementMode = false;
  private _registrationApproximate = false;
  private _lastPose: PoseMessage | null = null;
  private _pendingApproxGoal: { position: vec3; rotation: quat } | null = null;
  private _robotMenuVisible = false;
  private _manualPlacementMode = false;

  private _goalRenderer: GoalMarkerRenderer | null = null;
  private _pathRenderer: PathRenderer | null = null;
  private _obstacleRenderer: ObstacleHighlightRenderer | null = null;
  private _placementController: PlacementController | null = null;
  private _robotMenu: RobotMenuView | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.setIsActive(false);
      this._createHelpers();
      this._bindBridgeHandlers();
    });
  }

  private _createHelpers(): void {
    const parent =
      this.robotMarker?.markerRoot?.getParent() ??
      this.lidarPointCloud?.pointParent?.getParent() ??
      this.getSceneObject();
    const template = this.lidarPointCloud?.pointTemplate ?? null;

    this._goalRenderer = new GoalMarkerRenderer(parent, template);
    this._pathRenderer = new PathRenderer(parent, template);
    this._obstacleRenderer = new ObstacleHighlightRenderer(parent, template);
    this._placementController = new PlacementController(
      this,
      WorldQueryModule,
      GestureModule,
      this.placementRayOrigin ?? null,
    );
    this._placementController.onPreview = (position, rotation, mode) => {
      if (mode === "manualAlignment") {
        this.robotMarker?.applyManualPose(position, rotation);
      } else {
        this._goalRenderer?.setPreview(position, rotation);
      }
    };
    this._placementController.onConfirmed = (position, rotation, mode) => {
      if (mode !== "manualAlignment") {
        this._handleGoalConfirmed(position, rotation);
      }
    };

    if (this.robotMarker?.markerRoot) {
      this._robotMenu = new RobotMenuView(this.robotMarker.markerRoot);
      this._robotMenu.onToggleRequested = () => {
        this._robotMenuVisible = !this._robotMenuVisible;
        this._robotMenu?.setMenuVisible(this._robotMenuVisible);
      };
      this._robotMenu.onStopRequested = () => this.requestEmergencyStop();
      this._robotMenu.onConfirmRequested = () => this.confirmApproximateGoal();
      this._robotMenu.setStopEmphasis(true);
    }
  }

  private _bindBridgeHandlers(): void {
    if (!this.bridgeClient) {
      return;
    }
    this.bridgeClient.ensureEventHandlers();
    this.bridgeClient.onLidar.push((msg) => {
      if (this._isActive && this._showLidar && this.lidarPointCloud) {
        this.lidarPointCloud.queueLidar(msg);
      }
      this._obstacleRenderer?.updateLidar(msg);
    });
    this.bridgeClient.onPose.push((msg) => {
      this._lastPose = msg;
      if (this._isActive && this.robotMarker) {
        this.robotMarker.applyPose(msg);
      }
    });
    this.bridgeClient.onPath.push((msg) => this._applyPath(msg));
    this.bridgeClient.onNavStatus.push((msg) => this._applyNavStatus(msg));
    this.bridgeClient.onBridgeStatus.push((msg) => this._applyBridgeStatus(msg));
  }

  public setIsActive(active: boolean): void {
    this._isActive = active;
    if (!active && this.lidarPointCloud) {
      this.lidarPointCloud.clear();
    }
    if (!active) {
      this.setPlacementMode(false);
    }
    if (!active) {
      this._goalRenderer?.clearPreview();
      this._goalRenderer?.clearConfirmed();
      this._pathRenderer?.clear();
      this._obstacleRenderer?.clear();
      this._robotMenu?.setMenuVisible(false);
      this._robotMenuVisible = false;
    }
    if (this.robotMarker) {
      this._updateRobotMarkerVisibility();
    }
  }

  public get isActive(): boolean {
    return this._isActive;
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
    this._pendingApproxGoal = null;
  }

  public hasBridgeConnection(): boolean {
    return this.bridgeClient?.isConnected() ?? false;
  }

  public placeRobotMarkerInFrontOf(reference: SceneObject): void {
    if (!this.robotMarker || !reference) {
      return;
    }
    const transform = reference.getTransform();
    const worldPosition = transform.getWorldPosition();
    const worldRotation = transform.getWorldRotation();
    this.robotMarker.applyManualPose(
      new vec3(
        worldPosition.x,
        worldPosition.y - DimosManager.MANUAL_MARKER_DOWN_CM,
        worldPosition.z,
      ),
      worldRotation,
    );
  }

  public beginManualAlignmentPlacement(
    reference: SceneObject,
  ): void {
    this._manualPlacementMode = true;
    this._robotMenuVisible = false;
    this._robotMenu?.setMenuVisible(false);
    this.placeRobotMarkerInFrontOf(reference);
    this.robotMarker?.setManualPlacementEnabled(true);
    this._updateRobotMarkerVisibility();
  }

  public cancelManualAlignmentPlacement(): void {
    this._manualPlacementMode = false;
    this.robotMarker?.setManualPlacementEnabled(false);
    this._updateRobotMarkerVisibility();
  }

  public startManualAlignmentSession(): boolean {
    if (!this.hasBridgeConnection()) {
      return true;
    }
    return this.bridgeClient?.sendAlignStart() ?? false;
  }

  public submitManualAlignmentCandidate(position: vec3, rotation: quat): boolean {
    if (!this.hasBridgeConnection()) {
      return true;
    }
    return this.bridgeClient?.sendAlignManualPose(position, rotation) ?? false;
  }

  public stopManualAlignmentSession(): void {
    if (this.hasBridgeConnection()) {
      this.bridgeClient?.sendAlignStop();
    }
  }

  public hideRobotMarkerPreview(): void {
    this._updateRobotMarkerVisibility();
  }

  public setDebugMode(enabled: boolean): void {
    if (this._debugMode === enabled) {
      return;
    }
    this._debugMode = enabled;
    if (this.alignmentController) {
      this.alignmentController.setDebugMode(enabled);
    }
    this.onDebugModeChanged.forEach((cb) => cb(enabled));
  }

  public get debugMode(): boolean {
    return this._debugMode;
  }

  public setShowLidar(enabled: boolean): void {
    if (this._showLidar === enabled) {
      return;
    }
    this._showLidar = enabled;
    if (!enabled && this.lidarPointCloud) {
      this.lidarPointCloud.clear();
    }
    print(`DimosManager: Show LiDAR ${enabled ? "on" : "off"}`);
    this.onShowLidarChanged.forEach((cb) => cb(enabled));
  }

  public get showLidar(): boolean {
    return this._showLidar;
  }

  public setExecuteMovement(enabled: boolean): void {
    if (this._executeMovement === enabled) {
      return;
    }
    this._executeMovement = enabled;
    this.onExecuteMovementChanged.forEach((cb) => cb(enabled));
  }

  public get executeMovement(): boolean {
    return this._executeMovement;
  }

  public setPlacementMode(enabled: boolean): void {
    if (this._placementMode === enabled) {
      return;
    }
    this._placementMode = enabled;
    if (enabled) {
      this._placementController?.start("navGoal");
    } else {
      this._placementController?.stop();
      this._goalRenderer?.clearPreview();
    }
    this.onPlacementModeChanged.forEach((cb) => cb(enabled));
  }

  public captureManualAlignmentCandidate(): boolean {
    const position = this.robotMarker?.getWorldPosition() ?? null;
    const rotation = this.robotMarker?.getWorldRotation() ?? null;
    if (!position || !rotation) {
      return false;
    }
    return this.submitManualAlignmentCandidate(position, rotation);
  }

  public get placementMode(): boolean {
    return this._placementMode;
  }

  public requestEmergencyStop(): void {
    this.bridgeClient?.sendEmergencyStop();
    this._pendingApproxGoal = null;
    this._robotMenu?.setPendingConfirmation(false);
  }

  public confirmApproximateGoal(): void {
    if (!this._pendingApproxGoal) {
      return;
    }
    this.bridgeClient?.sendNavGoal(this._pendingApproxGoal.position);
    this._pendingApproxGoal = null;
    this._robotMenu?.setPendingConfirmation(false);
  }

  private _handleGoalConfirmed(position: vec3, rotation: quat): void {
    this._goalRenderer?.clearPreview();
    this._goalRenderer?.setConfirmed(position, rotation);
    this.setPlacementMode(false);

    const previewPath = this._buildPreviewPath(position);
    this._pathRenderer?.setLensPath(previewPath);
    this._obstacleRenderer?.setPath(previewPath);

    if (!this._executeMovement) {
      return;
    }
    if (this._registrationApproximate) {
      this._pendingApproxGoal = { position, rotation };
      this._robotMenuVisible = true;
      this._robotMenu?.setMenuVisible(true);
      this._robotMenu?.setPendingConfirmation(true);
      return;
    }
    this.bridgeClient?.sendNavGoal(position);
  }

  private _buildPreviewPath(goal: vec3): vec3[] {
    if (!this._lastPose) {
      return [goal];
    }
    return [protocolMetersToLensCentimeters(this._lastPose.position), goal];
  }

  private _applyPath(msg: PathMessage): void {
    this._pathRenderer?.setProtocolPath(msg.waypoints);
    this._obstacleRenderer?.setPath(
      msg.waypoints.map((point) => protocolMetersToLensCentimeters(point)),
    );
  }

  private _applyNavStatus(msg: NavStatusMessage): void {
    if (msg.goal_reached) {
      this._pathRenderer?.clear();
      this._obstacleRenderer?.clear();
      this._pendingApproxGoal = null;
      this._robotMenu?.setPendingConfirmation(false);
    }
    this._robotMenu?.setStatus(
      msg.goal_reached
        ? "Goal reached"
        : msg.state === "following_path"
          ? "Navigating"
          : msg.state === "recovery"
            ? "Recovery"
            : "Idle",
      this._registrationApproximate,
    );
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    this._registrationApproximate = Boolean(msg.registration_approximate);
    const label = msg.robot_serial ?? msg.robot_id;
    this._robotMenu?.setRobotLabel(label);
    if (msg.reconnecting) {
      this._robotMenu?.setStatus("Reconnecting", this._registrationApproximate);
    } else if (!msg.robot_connected) {
      this._robotMenu?.setStatus("Disconnected", this._registrationApproximate);
    } else if (!msg.streams_active) {
      this._robotMenu?.setStatus("Waiting for data", this._registrationApproximate);
    } else {
      this._robotMenu?.setStatus("Ready", this._registrationApproximate);
    }
  }

  private _updateRobotMarkerVisibility(): void {
    this.robotMarker?.setVisible(this._isActive || this._manualPlacementMode);
  }
}
