import { PointCloudRenderer } from "../Lidar/PointCloudRenderer";
import { LidarPresenter, LidarRenderContext } from "../Lidar/LidarPresenter";
import { RobotMarker } from "./RobotMarker";
import { ManualRegistrationPlacement } from "../../ARBridge/Registration/ManualRegistrationPlacement";
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
  private readonly _manualRegistrationPlacement = new ManualRegistrationPlacement();
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

  public get manualRegistrationPlacement(): ManualRegistrationPlacement {
    return this._manualRegistrationPlacement;
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
        manualRegistrationPlacement: this._manualRegistrationPlacement,
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
      });
      this.robotMarker.bindUiCallbacks({
        onToggle: () => menuCallbacks.onToggleRequested(),
        onStop: () => menuCallbacks.onStopRequested(),
        onContinue: menuCallbacks.onContinueRequested,
      });
    }

    this.telemetry?.onLidar.add((msg) => {
      if (this.isRuntimePhase() && this.appState.snapshot.lidarMode !== "off") {
        this._lidar?.onLidarReceived(msg.points, this._lidarContext());
      }
    });

    this._unsubscribeUILog = this.appState.uiLogger.subscribe((entry) => {
      this._latestUiLogEntry = entry;
      this._applyAppState(this.appState.snapshot);
    });
    this.appState.subscribe((state) => this._syncFromState(state));
    this.syncLidarPresentation();
  }

  public applyPendingPose(): boolean {
    const msg = this.telemetry?.consumePendingPose() ?? null;
    if (!msg) {
      return false;
    }
    if (this.isRuntimePhase() && this.robotMarker) {
      const resolved = this._manualRegistrationPlacement.resolveRobotMarkerPose(
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
      this.isBridgeSessionReady(),
      LIDAR_STALE_CLEAR_S,
    );
  }

  public prepareForRuntime(registrationApproximate: boolean): void {
    this._manualRegistrationPlacement.prepareForRuntime(registrationApproximate);
  }

  public onDisconnect(): void {
    this._lidar?.clearBuffer();
    this._manualRegistrationPlacement.onDisconnected();
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

  public setDebugBoundsFromRuntime(runtime: AppStateData["robotRuntime"]): void {
    this.robotMarker?.setDebugBoundsFromRuntime(runtime);
  }

  public syncLidarPresentation(state?: AppStateData): void {
    this._lidar?.onPresentationStateChanged(this._lidarContext(state));
  }

  /** @deprecated Use syncLidarPresentation */
  public refreshLidarPresentation(state?: AppStateData): void {
    this.syncLidarPresentation(state);
  }

  private _applyAppState(state: AppStateData): void {
    this.robotMarker?.applyAppState(state, this._latestUiLogEntry);
  }

  private _syncFromState(state: AppStateData): void {
    this.robotMarker?.setRenderOffsetCm(runtimeRenderOffsetCm(state.robotRuntime));
    this.robotMarker?.setDebugMode(state.debugMode);
    this._applyAppState(state);
    this.syncLidarPresentation(state);
    this.telemetry?.syncLidarMode(state.lidarMode);
  }

  private _lidarContext(state?: AppStateData): LidarRenderContext {
    const snapshot = state ?? this.appState.snapshot;
    return {
      mode: snapshot.lidarMode,
      active: this.isRuntimePhase(),
      connected: this.isBridgeSessionReady(),
      anchor: this._resolveLidarAnchor(),
      runtime: snapshot.robotRuntime,
    };
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

  private isBridgeSessionReady(): boolean {
    return this.session?.isConnected() ?? false;
  }
}
