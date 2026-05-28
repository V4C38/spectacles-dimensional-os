import { BridgeClient } from "../Network/BridgeClient";
import { AlignStatusMessage } from "../Network/Protocol";

const ALIGN_SEND_INTERVAL_S = 0.2;

@component
export class AlignmentController extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  markerTracking: MarkerTrackingComponent;

  @input
  debugGizmo: SceneObject;

  public onAlignStatus: ((msg: AlignStatusMessage) => void)[] = [];
  public onMarkerTrackingChanged: ((tracking: boolean) => void)[] = [];

  private _active = false;
  private _tracking = false;
  private _sendEvent: SceneEvent | null = null;
  private _lastSendTime = 0;
  private _savedOnMarkerFound: (() => void) | null = null;
  private _savedOnMarkerLost: (() => void) | null = null;
  private _bridgeAlignBound = false;
  private _debugMode = false;
  private _calibrationGizmoEnabled = false;
  private _awaitingCommit = false;

  onAwake() {
    this.onAlignStatus = [];
    this.onMarkerTrackingChanged = [];
    this.createEvent("OnStartEvent").bind(() => this._bindBridgeAlignStatus());
  }

  public ensureEventHandlers(): void {
    if (!this.onAlignStatus) {
      this.onAlignStatus = [];
    }
    if (!this.onMarkerTrackingChanged) {
      this.onMarkerTrackingChanged = [];
    }
  }

  private _bindBridgeAlignStatus(): void {
    if (this._bridgeAlignBound || !this.bridgeClient) {
      return;
    }
    this.bridgeClient.ensureEventHandlers();
    this.bridgeClient.onAlignStatus.push(this._relayAlignStatus);
    this._bridgeAlignBound = true;
  }

  private _relayAlignStatus = (msg: AlignStatusMessage): void => {
    this.onAlignStatus.forEach((cb) => cb(msg));
  };

  /** True while the Spectacles image tracker currently sees the calibration board. */
  public isMarkerTracked(): boolean {
    return this._tracking;
  }

  public start(): void {
    if (this._active) {
      return;
    }
    if (!this.bridgeClient || !this.bridgeClient.sendAlignStart()) {
      print("AlignmentController: cannot start alignment before robot_id is negotiated");
      return;
    }
    this._active = true;
    this._awaitingCommit = false;
    if (this.markerTracking) {
      this._savedOnMarkerFound = this.markerTracking.onMarkerFound;
      this._savedOnMarkerLost = this.markerTracking.onMarkerLost;
      this.markerTracking.onMarkerFound = this._onMarkerFound;
      this.markerTracking.onMarkerLost = this._onMarkerLost;
      if (this.markerTracking.isTracking()) {
        this._onMarkerFound();
      }
    }
  }

  public stop(): void {
    if (!this._active && !this._awaitingCommit) {
      return;
    }
    const shouldSendStop = this._active;
    this._active = false;
    this._awaitingCommit = false;
    this._stopSending();
    if (shouldSendStop && this.bridgeClient) {
      this.bridgeClient.sendAlignStop();
    }
    this._restoreMarkerCallbacks();
    this._setTracking(false);
    this._updateDebugGizmo();
  }

  public commitBestAlignment(): boolean {
    if (!this._active || !this.bridgeClient) {
      return false;
    }
    if (!this.bridgeClient.sendAlignCommit()) {
      return false;
    }
    this._active = false;
    this._awaitingCommit = true;
    this._stopSending();
    this._restoreMarkerCallbacks();
    this._updateDebugGizmo();
    return true;
  }

  private _restoreMarkerCallbacks(): void {
    if (this.markerTracking) {
      this.markerTracking.onMarkerFound = this._savedOnMarkerFound ?? (() => {});
      this.markerTracking.onMarkerLost = this._savedOnMarkerLost ?? (() => {});
      this._savedOnMarkerFound = null;
      this._savedOnMarkerLost = null;
    }
  }

  private _onMarkerFound = (): void => {
    if (!this._active) {
      return;
    }
    this._setTracking(true);
    this._ensureSendLoop();
    this._sendMarkerPose();
    this._updateDebugGizmo();
  };

  private _onMarkerLost = (): void => {
    this._setTracking(false);
    this._stopSending();
    this._updateDebugGizmo();
  };

  private _setTracking(tracking: boolean): void {
    if (this._tracking === tracking) {
      return;
    }
    this._tracking = tracking;
    this.onMarkerTrackingChanged.forEach((cb) => cb(tracking));
  }

  private _ensureSendLoop(): void {
    if (this._sendEvent) {
      return;
    }
    this._sendEvent = this.createEvent("UpdateEvent");
    this._sendEvent.bind(() => {
      if (!this._active || !this._tracking) {
        return;
      }
      const now = getTime();
      if (now - this._lastSendTime >= ALIGN_SEND_INTERVAL_S) {
        this._sendMarkerPose();
        this._lastSendTime = now;
      }
    });
  }

  private _stopSending(): void {
    if (this._sendEvent) {
      this.removeEvent(this._sendEvent);
      this._sendEvent = null;
    }
  }

  private _sendMarkerPose(): void {
    if (!this.bridgeClient || !this._active) {
      return;
    }
    const t = this.getSceneObject().getTransform();
    const pos = t.getWorldPosition();
    const rot = t.getWorldRotation();
    this.bridgeClient.sendAlignMarker(pos, rot);
  }

  public setDebugMode(enabled: boolean): void {
    this._debugMode = enabled;
    this._updateDebugGizmo();
  }

  public setCalibrationGizmoEnabled(enabled: boolean): void {
    this._calibrationGizmoEnabled = enabled;
    this._updateDebugGizmo();
  }

  private _updateDebugGizmo(): void {
    if (this.debugGizmo) {
      this.debugGizmo.enabled =
        (this._debugMode || this._calibrationGizmoEnabled) &&
        this._active &&
        this._tracking;
    }
  }
}
