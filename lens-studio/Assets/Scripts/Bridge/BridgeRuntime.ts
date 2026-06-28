import { BridgeClient } from "./BridgeClient";
import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { computeFrameCapturePolicy } from "../Camera/FrameCapturePolicy";
import { DimosState } from "../Core/DimosState";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { NavigationController } from "../Navigation/NavigationController";
import { RegistrationClient } from "../Registration/RegistrationClient";
import { Signal } from "../Core/Utilities";
import {
  BridgeSnapshot,
  createDefaultDriftState,
  createDefaultRobotRuntimeState,
  defaultNavigationOutcome,
  isRuntimePhase as isAppRuntimePhase,
} from "../Core/AppState";
import {
  BridgeStatusMessage,
  deriveLinkState,
  HelloMessage,
  projectBridgeSnapshot,
} from "./Protocol";
import { projectRuntimeStateFromHello } from "../Robot/RobotRuntimeModel";

const RECONNECT_BASE_S = 1.0;
const RECONNECT_BACKOFF_FACTOR = 1.5;
const RECONNECT_MAX_S = 8.0;
const RECONNECT_LOG_INTERVAL_S = 10.0;

function bridgeSnapshotsEqual(a: BridgeSnapshot, b: BridgeSnapshot): boolean {
  return (
    a.handshakeReady === b.handshakeReady &&
    a.robotConnected === b.robotConnected &&
    a.worldFrameCommitted === b.worldFrameCommitted &&
    a.worldFrameApproximate === b.worldFrameApproximate &&
    a.reconnecting === b.reconnecting &&
    a.worldFrameMethod === b.worldFrameMethod &&
    a.statusTs === b.statusTs
  );
}

/** Bridge→app integration: inbound fan-out, link-state presentation, lifecycle signals. */
export class BridgeRuntime {
  public readonly onBridgeReady = new Signal<void>();
  public readonly onBridgeStatusChanged = new Signal<BridgeStatusMessage>();
  public readonly onBridgeConnectionChanged = new Signal<boolean>();

  private _bound = false;
  private _reconnectEvent: DelayedCallbackEvent | null = null;
  private _reconnectActive = false;
  private _reconnectBackoffS = RECONNECT_BASE_S;
  private _lastReconnectLogTime = -1;

  constructor(
    private readonly bridgeClient: BridgeClient | null,
    private readonly dimosState: DimosState,
    private readonly robotRuntime: RobotRuntime,
    private readonly navigationController: NavigationController,
    private readonly frameCaptureController: FrameCaptureController | null,
    private readonly registrationClient: RegistrationClient | null,
  ) {}

  public bind(): void {
    if (this._bound || !this.bridgeClient) {
      return;
    }
    this._bound = true;

    this.registrationClient?.onCapturePolicyInputsChanged.add(() => {
      this.applyFrameCapturePolicy();
    });

    this.bridgeClient.onHello.add((msg) => {
      this._applyHello(msg);
      this.onBridgeReady.emit();
    });
    this.bridgeClient.onLidar.add((msg) => {
      this.robotRuntime?.onLidar(msg.points);
    });
    this.bridgeClient.onPose.add((msg) => {
      this.robotRuntime?.onPose(msg);
    });
    this.bridgeClient.onWorldFrameCorrection.add((msg) => {
      this.robotRuntime?.onWorldFrameCorrection(msg);
    });
    this.bridgeClient.onPath.add((msg) => this.navigationController?.applyPath(msg));
    this.bridgeClient.onNavStatus.add((msg) =>
      this.navigationController?.applyNavStatus(msg),
    );
    this.bridgeClient.onRuntimeSnapshot.add(() =>
      this.navigationController?.resyncPreviewGoal(),
    );
    this.bridgeClient.onBridgeStatus.add((msg) => this._applyBridgeStatus(msg));
    this.bridgeClient.onConnectionChanged.add((connected) =>
      this._applyConnectionState(connected),
    );
    this.bridgeClient.onProtocolError.add((error) =>
      this.navigationController?.handleProtocolError(error),
    );

    const reconnectEv = this.bridgeClient.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    reconnectEv.bind(() => this._onRuntimeReconnectFired());
    this._reconnectEvent = reconnectEv;
  }

  public tick(): void {
    this.dimosState.uiLogger.tick();
    this.robotRuntime?.applyPendingPose();
    this.robotRuntime?.tickFrame();
  }

  public tryConnect(ip: string): Promise<boolean> {
    return this.bridgeClient?.tryConnect(ip) ?? Promise.resolve(false);
  }

  public getDefaultBridgeIp(): string {
    return this.bridgeClient
      ? BridgeClient.normalizeIp(this.bridgeClient.defaultBridgeIp)
      : "";
  }

  public saveIp(ip: string): void {
    this.bridgeClient?.saveIp(ip);
  }

  public loadIp(): string | null {
    return this.bridgeClient?.loadIp() ?? null;
  }

  public clearIp(): void {
    this.bridgeClient?.clearIp();
  }

  public isSocketOpen(): boolean {
    return this.bridgeClient?.isSocketOpen() ?? false;
  }

  public getBaseUrl(): string {
    return this.bridgeClient ? this.bridgeClient.baseUrl : "";
  }

  public normalizeBridgeIp(raw: string): string {
    return BridgeClient.normalizeIp(raw);
  }

  public disconnect(): void {
    this.cancelRuntimeReconnect();
    this.bridgeClient?.disconnect();
    this.navigationController?.resetForUserDisconnect();
  }

  public cancelRuntimeReconnect(): void {
    this._reconnectActive = false;
    this._reconnectBackoffS = RECONNECT_BASE_S;
  }

  public hasConnection(): boolean {
    return this.bridgeClient?.isConnected() ?? false;
  }

  public requestBridgeStatus(): boolean {
    return this.bridgeClient?.requestStatus() ?? false;
  }

  public get bridgeLinkState() {
    return this.dimosState.snapshot.bridgeLinkState;
  }

  public reapplyBridgeStatusIfConnected(): void {
    if (this.bridgeClient?.lastBridgeStatus) {
      this._applyBridgeStatus(this.bridgeClient.lastBridgeStatus);
    } else {
      this._applyConnectionState(this.hasConnection());
    }
  }

  public applyFrameCapturePolicy(forceOff = false): void {
    if (!this.frameCaptureController) {
      return;
    }
    const snapshot = this.dimosState.snapshot;
    const client = this.registrationClient;
    const result = computeFrameCapturePolicy({
      appPhase: snapshot.phase,
      worldFrameCommitted: snapshot.bridgeSnapshot.worldFrameCommitted,
      baselineCaptureSessionActive: client?.baselineCaptureSessionActive ?? false,
      registrationCaptureHint: client?.registrationCaptureHint ?? "off",
      forceOff,
    });
    this.frameCaptureController.setMode(result.mode);
    if (result.mode === "registration") {
      this.frameCaptureController.setCapturePolicy(result.policy);
    }
  }

  private _applyHello(msg: HelloMessage): void {
    const runtimeState = projectRuntimeStateFromHello(msg);
    this.navigationController?.onHelloReset();
    this.robotRuntime?.resetBridgeLidarModeTracking();
    this._applyBridgeProjection(this.hasConnection(), null);
    this.dimosState.update({
      robotRuntime: runtimeState,
      driftState: createDefaultDriftState(),
      navigationOutcome: defaultNavigationOutcome(),
    });
    this.applyFrameCapturePolicy();
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    const shouldClearAnchor = this.robotRuntime.manualRegistrationAlignment.onBridgeStatus(
      msg,
      this.dimosState.snapshot.robotInteractionMode === "manualPlacement",
    );
    if (shouldClearAnchor) {
      this.robotRuntime.manualRegistrationAlignment.reset();
    }
    this._applyBridgeProjection(true, msg);
    this.applyFrameCapturePolicy();
    this.onBridgeStatusChanged.emit(msg);
  }

  private _applyConnectionState(connected: boolean): void {
    print(`BridgeRuntime: bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._applyBridgeProjection(
      connected,
      connected ? this.bridgeClient?.lastBridgeStatus ?? null : null,
    );
    this.onBridgeConnectionChanged.emit(connected);
    if (connected) {
      this.cancelRuntimeReconnect();
    } else {
      this.robotRuntime.onDisconnect();
      this.navigationController?.onDisconnect();
      this.dimosState.update({
        navigationOutcome: defaultNavigationOutcome(),
        robotRuntime: createDefaultRobotRuntimeState(),
      });
      this._maybeScheduleRuntimeReconnect();
    }
    this.applyFrameCapturePolicy();
  }

  private _maybeScheduleRuntimeReconnect(): void {
    if (this.dimosState.snapshot.phase !== "runtime") {
      return;
    }
    if (this._reconnectActive) {
      return;
    }
    this._reconnectActive = true;
    this._reconnectBackoffS = RECONNECT_BASE_S;
    this._reconnectEvent?.reset(this._reconnectBackoffS);
  }

  private _scheduleNextRuntimeReconnect(): void {
    if (this.dimosState.snapshot.phase !== "runtime") {
      this.cancelRuntimeReconnect();
      return;
    }
    this._reconnectBackoffS = Math.min(
      this._reconnectBackoffS * RECONNECT_BACKOFF_FACTOR,
      RECONNECT_MAX_S,
    );
    this._reconnectEvent?.reset(this._reconnectBackoffS);
  }

  private _onRuntimeReconnectFired(): void {
    if (!this._reconnectActive) {
      return;
    }
    if (this.dimosState.snapshot.phase !== "runtime") {
      this.cancelRuntimeReconnect();
      return;
    }
    if (this.hasConnection()) {
      this.cancelRuntimeReconnect();
      return;
    }
    const ip = this.bridgeClient?.baseUrl ?? "";
    if (!ip) {
      this._scheduleNextRuntimeReconnect();
      return;
    }
    const now = getTime();
    if (
      this._lastReconnectLogTime < 0 ||
      now - this._lastReconnectLogTime >= RECONNECT_LOG_INTERVAL_S
    ) {
      this._lastReconnectLogTime = now;
      print(`BridgeRuntime: reconnect attempt ${ip}`);
    }
    this.tryConnect(ip).then((ok) => {
      if (!this._reconnectActive) {
        return;
      }
      if (ok) {
        this.cancelRuntimeReconnect();
        return;
      }
      this._scheduleNextRuntimeReconnect();
    });
  }

  private _applyBridgeProjection(
    connected: boolean,
    status: BridgeStatusMessage | null,
  ): void {
    const handshakeReady = this.bridgeClient?.isConnected() ?? false;
    let effectiveConnected = connected;
    let effectiveStatus = status;
    if (!handshakeReady) {
      effectiveConnected = false;
      effectiveStatus = null;
    }
    const snapshot = projectBridgeSnapshot(handshakeReady, effectiveConnected ? effectiveStatus : null);
    const linkState = deriveLinkState(effectiveConnected, effectiveConnected ? effectiveStatus : null);
    const prev = this.dimosState.snapshot;
    const patch: Partial<typeof prev> = {};
    if (!bridgeSnapshotsEqual(prev.bridgeSnapshot, snapshot)) {
      patch.bridgeSnapshot = snapshot;
    }
    if (prev.bridgeLinkState !== linkState) {
      patch.bridgeLinkState = linkState;
    }
    if (Object.keys(patch).length > 0) {
      this.dimosState.update(patch);
    }
  }
}
