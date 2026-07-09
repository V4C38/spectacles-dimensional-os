import { PointCloudRenderer } from "../Lidar/PointCloudRenderer";
import { LidarPresenter } from "../Lidar/LidarPresenter";
import { RobotMarker } from "./RobotMarker";
import { ManualRegistrationAlignment } from "../../ARBridge/Registration/ManualRegistrationAlignment";
import { AppStateStore } from "../AppState";
import {
  AppStateData,
  isRuntimePhase as isAppRuntimePhase,
  OperatingMode,
} from "../AppState";
import { protocolMetersToLensCentimeters, PoseMessage } from "../../ARBridge/Network/Protocol";
import { TelemetryClient } from "../../ARBridge/Telemetry/TelemetryClient";
import { ARBridgeSession } from "../../ARBridge/Network/ARBridgeSession";
import { runtimeRenderOffsetCm } from "./RobotRuntimeModel";
import { UILogEntry } from "../UI/UILogger";

const LIDAR_STALE_CLEAR_S = 3.0;

export interface RobotPresenterMenuCallbacks {
  onToggleRequested: () => void;
  onStopRequested: () => void;
  onContinueRequested?: () => void;
  getOperatingMode: () => OperatingMode;
}

/** Robot marker orchestration and LiDAR spatial presentation in the AR scene. */
export class RobotPresenter {
  private readonly _manualRegistrationAlignment = new ManualRegistrationAlignment();
  private _lidar: LidarPresenter | null = null;
  private _menuCallbacks: RobotPresenterMenuCallbacks | null = null;
  private _bound = false;
  private _latestUiLogEntry: UILogEntry | null = null;
  private _unsubscribeUILog: (() => void) | null = null;

  constructor(
    private readonly appState: AppStateStore,
    public readonly robotMarker: RobotMarker | null,
    private readonly pointCloudRenderer: PointCloudRenderer | null,
    private readonly session: ARBridgeSession | null,
    private readonly telemetry: TelemetryClient | null,
  ) {}

  public get manualRegistrationAlignment(): ManualRegistrationAlignment {
    return this._manualRegistrationAlignment;
  }

  public get lastPose(): PoseMessage | null {
    return this.telemetry?.lastPose ?? null;
  }

  public bind(menuCallbacks: RobotPresenterMenuCallbacks): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._menuCallbacks = menuCallbacks;

    this._lidar = new LidarPresenter(this.pointCloudRenderer ?? null);

    if (this.robotMarker) {
      this.robotMarker.initialize({
        manualRegistrationAlignment: this._manualRegistrationAlignment,
        getLastPose: () => this.lastPose,
        getIsRuntimePhase: () => this.isRuntimePhase(),
        getOperatingMode: () => menuCallbacks.getOperatingMode(),
        getInteractionMode: () => this.appState.snapshot.robotInteractionMode,
        getRobotClockNowS: () => {
          if (this.session?.isClockSyncReady) {
            return this.session.mapCaptureTime(getTime());
          }
          return null;
        },
        onWorldPositionChanged: () => this.refreshLidarPresentation(),
      });
      this.robotMarker.bindUiCallbacks({
        onToggle: () => menuCallbacks.onToggleRequested(),
        onStop: () => menuCallbacks.onStopRequested(),
        onContinue: menuCallbacks.onContinueRequested,
      });
    }

    this.telemetry?.onLidar.add((msg) => {
      if (this.isRuntimePhase() && this.appState.snapshot.lidarMode !== "off") {
        this._lidar?.onLidarReceived(msg.points);
        this.refreshLidarPresentation();
      }
    });

    this.telemetry?.onWorldFrameCorrection.add(() => {
      this.robotMarker?.beginRealignmentSnap();
      this.robotMarker?.frameCapture?.notifyWorldFrameCorrection();
    });

    this._unsubscribeUILog = this.appState.uiLogger.subscribe((entry) => {
      this._latestUiLogEntry = entry;
      this._applyAppState(this.appState.snapshot);
    });
    this.appState.subscribe((state) => this._syncFromState(state));
    this.refreshLidarPresentation();
  }

  public applyPendingPose(): boolean {
    const msg = this.telemetry?.consumePendingPose() ?? null;
    if (!msg) {
      return false;
    }
    if (this.isRuntimePhase() && this.robotMarker) {
      const resolved = this._manualRegistrationAlignment.resolveRobotMarkerPose(
        msg,
        this.appState.snapshot.robotInteractionMode,
      );
      this.robotMarker.applyRobotMarkerPose(resolved, msg);
    }
    return true;
  }

  public tickFrame(): void {
    this._lidar?.tickFrame(
      this.isRuntimePhase(),
      this.appState.snapshot.lidarMode,
      this.hasBridgeConnection(),
      LIDAR_STALE_CLEAR_S,
    );
  }

  public prepareForRuntime(registrationApproximate: boolean): void {
    this._manualRegistrationAlignment.prepareForRuntime(registrationApproximate);
  }

  public onDisconnect(): void {
    this._lidar?.clearBuffer();
    this._manualRegistrationAlignment.onDisconnected();
    this.robotMarker?.resetRuntimePoseSmoothing();
  }

  public clearInactiveState(): void {
    this.pointCloudRenderer?.clearAll();
    this._lidar?.clearBuffer();
    this.robotMarker?.ui?.hide();
  }

  public applyInteractionFromState(): void {
    this.robotMarker?.applyInteractionMode(
      this.appState.snapshot.robotInteractionMode,
    );
  }

  public refreshLidarPresentation(state?: AppStateData): void {
    const snapshot = state ?? this.appState.snapshot;
    this._lidar?.apply({
      mode: snapshot.lidarMode,
      active: this.isRuntimePhase(),
      connected: this.hasBridgeConnection(),
      points: this._lidar?.lastPoints ?? null,
      anchor: this._resolveLidarAnchor(),
      runtime: snapshot.robotRuntime,
    });
  }

  private _applyAppState(state: AppStateData): void {
    this.robotMarker?.applyAppState(state, this._latestUiLogEntry);
  }

  private _syncFromState(state: AppStateData): void {
    this.robotMarker?.setRenderOffsetCm(runtimeRenderOffsetCm(state.robotRuntime));
    this.robotMarker?.setDebugMode(state.debugMode);
    this._applyAppState(state);
    this.refreshLidarPresentation(state);
    this.telemetry?.syncLidarMode(state.lidarMode);
  }

  private _resolveLidarAnchor(): vec3 | null {
    const markerPos = this.robotMarker?.getWorldPosition();
    if (markerPos) {
      return markerPos;
    }
    const lastPose = this.lastPose;
    if (lastPose) {
      return protocolMetersToLensCentimeters(lastPose.position);
    }
    return null;
  }

  private isRuntimePhase(): boolean {
    return isAppRuntimePhase(this.appState.snapshot);
  }

  private hasBridgeConnection(): boolean {
    return this.session?.isConnected() ?? false;
  }
}
