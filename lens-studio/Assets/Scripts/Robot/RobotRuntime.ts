import { PointCloudRenderer } from "../Lidar/PointCloudRenderer";
import { LidarPresentationController } from "../Lidar/LidarPresentationController";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotMarkerView } from "../Robot/RobotMarkerView";
import { ManualPoseCorrection } from "../Alignment/ManualPoseCorrection";
import { DimosState } from "../Core/DimosState";
import {
  DimosAppState,
  isRuntimePhase as isAppRuntimePhase,
  LidarDisplayMode,
  navigationPlacementToggleEnabled,
  OperatingMode,
  RobotInteractionMode,
} from "../Core/AppState";
import {
  DEFAULT_LIDAR_OBSTACLE_SETTINGS,
  PoseCorrectionMessage,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../Bridge/Protocol";
import { BridgeClient } from "../Bridge/BridgeClient";
import {
  capabilityUnavailableReason,
  isCapabilityAvailable,
  runtimeRenderOffsetCm,
} from "../Robot/RobotRuntimeModel";
import { COLOR_WHITE } from "../UI/kit/UIKit";

const DRIFTING_TRANSLATION_THRESHOLD_M = 0.05;
const POSE_CORRECTION_LOG_INTERVAL_S = 1.0;
const LIDAR_STALE_CLEAR_S = 0.5;
const REFINED_TRACKING_LOG_TEXT = "- Refined Tracking -";
const REFINED_TRACKING_LOG_DURATION_S = 0.5;

export interface RobotRuntimeMenuCallbacks {
  onToggleRequested: () => void;
  onStopRequested: () => void;
  onNavigationPlacementRequested: (enabled: boolean) => void;
  getOperatingMode: () => OperatingMode;
  getNavigationPlacementEnabled: () => boolean;
}

/** Robot pose, marker UI, and LiDAR spatial presentation in the AR scene. */
@component
export class RobotRuntime extends BaseScriptComponent {
  @input
  dimosState: DimosState;

  @input
  robotMarker: RobotMarker;

  @input
  pointCloudRenderer: PointCloudRenderer;

  @input
  bridgeClient: BridgeClient;

  private _lastPose: PoseMessage | null = null;
  private _pendingPose: PoseMessage | null = null;
  private readonly _poseCorrection = new ManualPoseCorrection();
  private _lidar: LidarPresentationController | null = null;
  private _robotMarkerView: RobotMarkerView | null = null;
  private _lastPoseCorrectionLogTime = 0;
  private _lastSentBridgeLidarMode: LidarDisplayMode | null = null;
  private _menuCallbacks: RobotRuntimeMenuCallbacks | null = null;
  private _bound = false;

  public get poseCorrection(): ManualPoseCorrection {
    return this._poseCorrection;
  }

  public get robotMarkerView(): RobotMarkerView | null {
    return this._robotMarkerView;
  }

  public get lastPose(): PoseMessage | null {
    return this._lastPose;
  }

  public bind(menuCallbacks: RobotRuntimeMenuCallbacks): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._menuCallbacks = menuCallbacks;

    this._lidar = new LidarPresentationController(this.pointCloudRenderer ?? null);

    const markerRoot = this.robotMarker?.markerRoot ?? null;
    const menuRoot = this.robotMarker?.getMenuRoot() ?? null;
    if (markerRoot && menuRoot) {
      const robotMarkerView = new RobotMarkerView(markerRoot, menuRoot);
      robotMarkerView.initialize({
        subscribeAppState: (listener) => this.dimosState.subscribe(listener),
        uiLogger: this.dimosState.uiLogger,
      });
      this._robotMarkerView = robotMarkerView;
      robotMarkerView.onToggleRequested = () => menuCallbacks.onToggleRequested();
      robotMarkerView.onStopRequested = () => menuCallbacks.onStopRequested();
      robotMarkerView.onNavigationPlacementRequested = (enabled) =>
        menuCallbacks.onNavigationPlacementRequested(enabled);
      robotMarkerView.setNavigationPlacementToggle(menuCallbacks.getNavigationPlacementEnabled());
    }

    if (this.robotMarker) {
      this.robotMarker.initialize({
        poseCorrection: this._poseCorrection,
        getLastPose: () => this._lastPose,
        robotMarkerView: this._robotMarkerView,
        getIsRuntimePhase: () => this.isRuntimePhase(),
        getOperatingMode: () => menuCallbacks.getOperatingMode(),
        getInteractionMode: () => this.dimosState.snapshot.robotInteractionMode,
        syncNavigationPlacementState: () => this._onSyncNavigationPlacement?.(),
        onWorldPositionChanged: () => this.refreshLidarPresentation(),
      });
    }

    this.dimosState.subscribe((state) => this._syncFromState(state));
    this.refreshLidarPresentation();
  }

  private _onSyncNavigationPlacement: (() => void) | null = null;

  public setSyncNavigationPlacement(handler: () => void): void {
    this._onSyncNavigationPlacement = handler;
  }

  public onPose(msg: PoseMessage): void {
    this._lastPose = msg;
    this._pendingPose = msg;
  }

  public onPoseCorrection(msg: PoseCorrectionMessage): void {
    this.dimosState.update({
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
        `RobotRuntime: pose_correction transDeltaM=${msg.trans_delta_m.toFixed(3)} yawDeltaDeg=${yawDeltaText} yawCorrected=${msg.yaw_corrected} solveQuality=${msg.solve_quality.toFixed(3)} solveMethod=${msg.solve_method}`,
      );
    }
    this.dimosState.uiLogger.show(
      REFINED_TRACKING_LOG_TEXT,
      COLOR_WHITE,
      REFINED_TRACKING_LOG_DURATION_S,
    );
    this.robotMarker?.beginRealignmentSnap();
  }

  public onLidar(points: [number, number, number][]): void {
    if (this.isRuntimePhase() && this.dimosState.snapshot.lidarMode !== "off") {
      this._lidar?.onLidarReceived(points);
      this.refreshLidarPresentation();
    }
  }

  public applyPendingPose(): void {
    const msg = this._pendingPose;
    if (!msg) {
      return;
    }
    this._pendingPose = null;
    if (this.isRuntimePhase() && this.robotMarker) {
      const resolved = this._poseCorrection.resolveDisplayPose(
        msg,
        this.dimosState.snapshot.robotInteractionMode,
      );
      this.robotMarker.applyResolvedPose(resolved, msg);
    }
  }

  public tickFrame(): void {
    this._lidar?.tickFrame(
      this.isRuntimePhase(),
      this.dimosState.snapshot.lidarMode,
      this.hasBridgeConnection(),
      LIDAR_STALE_CLEAR_S,
    );
  }

  public prepareForRuntime(registrationApproximate: boolean): void {
    this._poseCorrection.prepareForRuntime(registrationApproximate);
  }

  public onDisconnect(): void {
    this._lastSentBridgeLidarMode = null;
    this._lidar?.clearBuffer();
    this._lastPose = null;
    this._pendingPose = null;
    this._poseCorrection.onDisconnected();
    this.robotMarker?.resetRuntimePoseSmoothing();
  }

  public clearInactiveState(): void {
    this.pointCloudRenderer?.clearAll();
    this._lidar?.clearBuffer();
    this._robotMarkerView?.hide();
  }

  public applyInteractionFromState(): void {
    this.robotMarker?.applyInteractionMode(
      this.dimosState.snapshot.robotInteractionMode,
    );
  }

  public applyBridgeLinkState(): void {
    this._robotMarkerView?.applyBridgeLinkState(this.dimosState.snapshot.bridgeLinkState);
  }

  public resetBridgeLidarModeTracking(): void {
    this._lastSentBridgeLidarMode = null;
  }

  public refreshLidarPresentation(state?: DimosAppState): void {
    const snapshot = state ?? this.dimosState.snapshot;
    this._lidar?.apply({
      mode: snapshot.lidarMode,
      active: this.isRuntimePhase(),
      connected: this.hasBridgeConnection(),
      points: this._lidar?.lastPoints ?? null,
      anchor: this._resolveLidarAnchor(),
      runtime: snapshot.robotRuntime,
    });
  }

  private _syncFromState(state: DimosAppState): void {
    const runtime = state.robotRuntime;
    this.robotMarker?.setRenderOffsetCm(runtimeRenderOffsetCm(runtime));
    this.robotMarker?.setDebugMode(state.debugMode);
    this._robotMarkerView?.setRobotLabel(runtime.displayName);
    this._robotMarkerView?.setNavigationPlacementAvailability(
      isCapabilityAvailable(runtime, "nav"),
    );
    this._robotMarkerView?.setEmergencyStopAvailability(
      isCapabilityAvailable(runtime, "emergency_stop"),
      capabilityUnavailableReason(runtime, "emergency_stop"),
    );
    if (runtime.capabilities.nav?.available) {
      this._robotMarkerView?.setNavigationPlacementToggle(
        navigationPlacementToggleEnabled(state),
      );
    }
    this.refreshLidarPresentation(state);
    this._maybeSyncBridgeLidarMode(state.lidarMode);
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

  private isRuntimePhase(): boolean {
    return isAppRuntimePhase(this.dimosState.snapshot);
  }

  private hasBridgeConnection(): boolean {
    return this.bridgeClient?.isConnected() ?? false;
  }
}
