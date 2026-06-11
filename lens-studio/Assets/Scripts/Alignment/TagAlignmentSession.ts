import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { BridgeClient } from "../Network/BridgeClient";
import { AlignStatusMessage } from "../Network/Protocol";

const RECENT_DETECTION_WINDOW_S = 1.5;

@component
export class TagAlignmentSession extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  frameCapture: FrameCaptureController;

  public onAlignStatus: ((msg: AlignStatusMessage) => void)[] = [];

  private _active = false;
  private _awaitingCommit = false;
  private _bridgeSessionActive = false;
  private _bridgeAlignBound = false;
  private _lastTagDetectedTime = 0;

  onAwake() {
    this.onAlignStatus = [];
    this.createEvent("OnStartEvent").bind(() => this._bindBridgeAlignStatus());
  }

  public ensureEventHandlers(): void {
    if (!this.onAlignStatus) {
      this.onAlignStatus = [];
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
    if (msg.tag_detected) {
      this._lastTagDetectedTime = getTime();
    }
    if (msg.state === "failed" && (this._active || this._awaitingCommit)) {
      this._active = false;
      this._awaitingCommit = false;
      this._bridgeSessionActive = false;
      if (this.frameCapture) {
        this.frameCapture.setMode("off");
      }
    }
    this.onAlignStatus.forEach((cb) => cb(msg));
  };

  public hasRecentDetection(): boolean {
    return getTime() - this._lastTagDetectedTime <= RECENT_DETECTION_WINDOW_S;
  }

  public start(): void {
    if (this._active) {
      return;
    }
    this._active = true;
    this._awaitingCommit = false;
    this._bridgeSessionActive = this._startBridgeSession();
    if (this.frameCapture) {
      this.frameCapture.setMode("setup");
    }
  }

  public stop(): void {
    if (!this._active && !this._awaitingCommit) {
      return;
    }
    const shouldSendStop = this._bridgeSessionActive;
    this._active = false;
    this._awaitingCommit = false;
    this._bridgeSessionActive = false;
    if (shouldSendStop && this.bridgeClient) {
      this.bridgeClient.sendAlignStop();
    }
    if (this.frameCapture) {
      const registered = Boolean(this.bridgeClient?.lastBridgeStatus?.registered);
      this.frameCapture.setMode(registered ? "runtime" : "off");
    }
  }

  public commitBestAlignment(): boolean {
    if (!this.bridgeClient) {
      return false;
    }
    const sent = this.bridgeClient.sendAlignCommit();
    if (!sent) {
      return false;
    }
    this._awaitingCommit = true;
    this._active = false;
    return true;
  }

  public ensureBridgeSession(): boolean {
    if (this._bridgeSessionActive) {
      return true;
    }
    return this._startBridgeSession();
  }

  private _startBridgeSession(): boolean {
    const connected = Boolean(this.bridgeClient?.isConnected());
    const hasRobotId = Boolean(this.bridgeClient?.activeRobotId);
    if (!this.bridgeClient || !connected || !hasRobotId) {
      return false;
    }
    if (!this.bridgeClient.sendAlignStart()) {
      return false;
    }
    this._bridgeSessionActive = true;
    return true;
  }

  public setDebugMode(_enabled: boolean): void {}

  public setCalibrationGizmoEnabled(_enabled: boolean): void {}
}
