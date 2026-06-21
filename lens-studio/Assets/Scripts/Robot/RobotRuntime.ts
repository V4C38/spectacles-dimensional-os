import { PointCloudRenderer } from "../Lidar/PointCloudRenderer";
import { LidarPresentationController } from "../Lidar/LidarPresentationController";
import { RobotMarker } from "../Robot/RobotMarker";
import { ManualPoseCorrection } from "../Registration/ManualPoseCorrection";
import { DimosState } from "../Core/DimosState";
import {
  DimosAppState,
  isRuntimePhase as isAppRuntimePhase,
  LidarDisplayMode,
  OperatingMode,
} from "../Core/AppState";
import {
  DEFAULT_LIDAR_OBSTACLE_SETTINGS,
  PoseCorrectionMessage,
  PoseMessage,
  protocolMetersToLensCentimeters,
} from "../Bridge/Protocol";
import { BridgeClient } from "../Bridge/BridgeClient";
import { runtimeRenderOffsetCm } from "../Robot/RobotRuntimeModel";
import { COLOR_WHITE } from "../UI/kit/UIKit";
import { UILogEntry } from "../UI/UILogger";

const DRIFTING_TRANSLATION_THRESHOLD_M = 0.05;
const POSE_CORRECTION_LOG_INTERVAL_S = 1.0;
// Bridge LiDAR is capped at 1 Hz; must exceed one inter-frame gap so live clouds
// are not cleared between normal updates (0.5 s caused visible flicker).
const LIDAR_STALE_CLEAR_S = 3.0;
const REFINED_TRACKING_LOG_TEXT = "- Refined Tracking -";
const REFINED_TRACKING_LOG_DURATION_S = 0.5;

export interface RobotRuntimeMenuCallbacks {
  onToggleRequested: () => void;
  onStopRequested: () => void;
  onGoalModeCycleRequested: () => void;
  onContinueRequested?: () => void;
  getOperatingMode: () => OperatingMode;
}

/** Robot pose, marker UI, and LiDAR spatial presentation in the AR scene. */
export class RobotRuntime {
  private _lastPose: PoseMessage | null = null;
  private _pendingPose: PoseMessage | null = null;
  private readonly _poseCorrection = new ManualPoseCorrection();
  private _lidar: LidarPresentationController | null = null;
  private _lastPoseCorrectionLogTime = 0;
  private _lastSentBridgeLidarMode: LidarDisplayMode | null = null;
  private _menuCallbacks: RobotRuntimeMenuCallbacks | null = null;
  private _bound = false;
  private _latestUiLogEntry: UILogEntry | null = null;
  private _unsubscribeUILog: (() => void) | null = null;

  constructor(
    private readonly dimosState: DimosState,
    public readonly robotMarker: RobotMarker | null,
    private readonly pointCloudRenderer: PointCloudRenderer | null,
    private readonly bridgeClient: BridgeClient | null,
  ) {}

  public get poseCorrection(): ManualPoseCorrection {
    return this._poseCorrection;
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

    if (this.robotMarker) {
      this.robotMarker.initialize({
        poseCorrection: this._poseCorrection,
        getLastPose: () => this._lastPose,
        getIsRuntimePhase: () => this.isRuntimePhase(),
        getOperatingMode: () => menuCallbacks.getOperatingMode(),
        getInteractionMode: () => this.dimosState.snapshot.robotInteractionMode,
        onWorldPositionChanged: () => this.refreshLidarPresentation(),
      });
      this.robotMarker.bindUiCallbacks({
        onToggle: () => menuCallbacks.onToggleRequested(),
        onStop: () => menuCallbacks.onStopRequested(),
        onGoalModeCycle: () => menuCallbacks.onGoalModeCycleRequested(),
        onContinue: menuCallbacks.onContinueRequested,
      });
    }

    this._unsubscribeUILog = this.dimosState.uiLogger.subscribe((entry) => {
      this._latestUiLogEntry = entry;
      this._applyAppState(this.dimosState.snapshot);
    });
    this.dimosState.subscribe((state) => this._syncFromState(state));
    this.refreshLidarPresentation();
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
    this.robotMarker?.ui?.hide();
  }

  public applyInteractionFromState(): void {
    this.robotMarker?.applyInteractionMode(
      this.dimosState.snapshot.robotInteractionMode,
    );
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

  private _applyAppState(state: DimosAppState): void {
    this.robotMarker?.applyAppState(state, this._latestUiLogEntry);
  }

  private _syncFromState(state: DimosAppState): void {
    this.robotMarker?.setRenderOffsetCm(runtimeRenderOffsetCm(state.robotRuntime));
    this.robotMarker?.setDebugMode(state.debugMode);
    this._applyAppState(state);
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
