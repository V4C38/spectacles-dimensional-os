import { ARBridgeSession } from "../Network/ARBridgeSession";
import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { CaptureMode, CapturePolicy } from "../Camera/CameraClient";
import { AppStateStore, AppPhase } from "../../App/AppState";
import { RobotPresenter } from "../../App/Robot/RobotPresenter";
import { NavigationPlacement } from "../../App/Navigation/NavigationPlacement";
import { RegistrationClient } from "../Registration/RegistrationClient";
import { StatusClient } from "../Status/StatusClient";
import { TelemetryClient } from "../Telemetry/TelemetryClient";
import { NavigationClient } from "../Navigation/NavigationClient";
import { Signal } from "../../App/Utilities/Utilities";
import {
  AppState,
  BridgeSnapshot,
  createDefaultDriftState,
  createDefaultRobotRuntimeState,
  defaultNavigationOutcome,
  NO_ROBOT_CONNECTED_LABEL,
} from "../../App/AppState";
import {
  BridgeStatusMessage,
  CaptureHint,
  deriveLinkState,
  HelloMessage,
  projectBridgeSnapshot,
} from "../Network/Protocol";
import { projectRuntimeStateFromHello } from "../../App/Robot/RobotRuntimeModel";
import {
  BRIDGE_RETRY_BACKOFF_FACTOR,
  BRIDGE_RETRY_BASE_S,
  BRIDGE_RETRY_MAX_S,
} from "../Network/WebSocketTransport";

const RECONNECT_LOG_INTERVAL_S = 10.0;

export interface FrameCapturePolicyInput {
  appPhase: AppPhase;
  worldFrameCommitted: boolean;
  baselineCaptureSessionActive: boolean;
  registrationCaptureHint: CaptureHint;
  forceOff: boolean;
}

export interface FrameCapturePolicyResult {
  mode: CaptureMode;
  policy: CapturePolicy;
}

export function computeFrameCapturePolicy(
  input: FrameCapturePolicyInput,
): FrameCapturePolicyResult {
  if (input.forceOff) {
    return { mode: "off", policy: "off" };
  }

  if (input.appPhase === "registration" && input.baselineCaptureSessionActive) {
    return { mode: "registration", policy: input.registrationCaptureHint };
  }

  if (input.appPhase === "runtime" && input.worldFrameCommitted) {
    return { mode: "runtime", policy: "off" };
  }

  return { mode: "off", policy: "off" };
}

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

/** Inbound fan-out, link-state projection, reconnect — mirrors ARBridge module wiring. */
export class InboundRouter {
  public readonly onBridgeReady = new Signal<void>();
  public readonly onBridgeStatusChanged = new Signal<BridgeStatusMessage>();
  public readonly onBridgeConnectionChanged = new Signal<boolean>();

  private _bound = false;
  private _reconnectEvent: DelayedCallbackEvent | null = null;
  private _reconnectActive = false;
  private _reconnectBackoffS = BRIDGE_RETRY_BASE_S;
  private _lastReconnectLogTime = -1;

  constructor(
    private readonly session: ARBridgeSession | null,
    private readonly appState: AppStateStore,
    private readonly statusClient: StatusClient,
    private readonly telemetryClient: TelemetryClient,
    private readonly navigationClient: NavigationClient,
    private readonly navigationPlacement: NavigationPlacement,
    private readonly robotPresenter: RobotPresenter,
    private readonly frameCaptureController: FrameCaptureController | null,
    private readonly registrationClient: RegistrationClient | null,
  ) {}

  public bind(): void {
    if (this._bound || !this.session) {
      return;
    }
    this._bound = true;

    this.statusClient.bind();
    this.telemetryClient.bind();
    this.navigationClient.bind();
    this.registrationClient?.bind();

    this.registrationClient?.onCapturePolicyInputsChanged.add(() => {
      this.applyFrameCapturePolicy();
    });

    this.statusClient.onHello.add((msg) => {
      this._applyHello(msg);
      this.onBridgeReady.emit();
    });

    this.telemetryClient.onLidar.add((msg) => {
      if (this.appState.snapshot.lidarMode !== "off") {
        this.robotPresenter.refreshLidarPresentation();
      }
    });

    this.navigationClient.onPath.add((msg) => this.navigationPlacement.applyPath(msg));
    this.navigationClient.onNavStatus.add((msg) =>
      this.navigationPlacement.applyNavStatus(msg),
    );
    this.navigationClient.onNavGoalUpdate.add((msg) =>
      this.navigationPlacement.applyNavGoalUpdate(msg),
    );
    this.statusClient.onRuntimeSnapshot.add(() =>
      this.navigationPlacement.resyncPreviewGoal(),
    );
    this.statusClient.onBridgeStatus.add((msg) => this._applyBridgeStatus(msg));
    this.session.onConnectionChanged.add((connected) =>
      this._applyConnectionState(connected),
    );
    this.navigationClient.onProtocolError.add((error) =>
      this.navigationPlacement.handleProtocolError(error),
    );

    const reconnectEv = this.session.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    reconnectEv.bind(() => this._onRuntimeReconnectFired());
    this._reconnectEvent = reconnectEv;
  }

  public tick(): void {
    this.appState.uiLogger.tick();
    this.robotPresenter.applyPendingPose();
    this.robotPresenter.tickFrame();
    this.navigationPlacement.syncIdlePlacementFollow();
  }

  public tryConnect(ip: string): Promise<boolean> {
    return this.session?.tryConnect(ip) ?? Promise.resolve(false);
  }

  public getDefaultBridgeIp(): string {
    return this.session
      ? ARBridgeSession.normalizeIp(this.session.defaultBridgeIp)
      : "";
  }

  public saveIp(ip: string): void {
    this.session?.saveIp(ip);
  }

  public loadIp(): string | null {
    return this.session?.loadIp() ?? null;
  }

  public clearIp(): void {
    this.session?.clearIp();
  }

  public isSocketOpen(): boolean {
    return this.session?.isSocketOpen() ?? false;
  }

  public getBaseUrl(): string {
    return this.session ? this.session.baseUrl : "";
  }

  public normalizeBridgeIp(raw: string): string {
    return ARBridgeSession.normalizeIp(raw);
  }

  public disconnect(): void {
    this.cancelRuntimeReconnect();
    this.session?.disconnect();
    this.navigationPlacement.resetForUserDisconnect();
  }

  public cancelRuntimeReconnect(): void {
    this._reconnectActive = false;
    this._reconnectBackoffS = BRIDGE_RETRY_BASE_S;
  }

  public hasConnection(): boolean {
    return this.session?.isConnected() ?? false;
  }

  public requestBridgeStatus(): boolean {
    return this.statusClient.requestStatus();
  }

  public get bridgeLinkState() {
    return this.appState.snapshot.bridgeLinkState;
  }

  public reapplyBridgeStatusIfConnected(): void {
    if (this.session?.lastBridgeStatus) {
      this._applyBridgeStatus(this.session.lastBridgeStatus);
    } else {
      this._applyConnectionState(this.hasConnection());
    }
  }

  public applyFrameCapturePolicy(forceOff = false): void {
    if (!this.frameCaptureController) {
      return;
    }
    const snapshot = this.appState.snapshot;
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
    AppState.connectedRobotDisplayName = runtimeState.displayName;
    this.navigationPlacement.onHelloReset();
    this.telemetryClient.resetBridgeLidarModeTracking();
    this._applyBridgeProjection(this.hasConnection(), null);
    this.appState.update({
      robotRuntime: runtimeState,
      driftState: createDefaultDriftState(),
      navigationOutcome: defaultNavigationOutcome(),
    });
    this.applyFrameCapturePolicy();
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    const shouldClearAnchor = this.robotPresenter.manualRegistrationAlignment.onBridgeStatus(
      msg,
      this.appState.snapshot.robotInteractionMode === "manualPlacement",
    );
    if (shouldClearAnchor) {
      this.robotPresenter.manualRegistrationAlignment.reset();
    }
    this._applyBridgeProjection(true, msg);
    this.applyFrameCapturePolicy();
    this.onBridgeStatusChanged.emit(msg);
  }

  private _applyConnectionState(connected: boolean): void {
    print(`InboundRouter: bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._applyBridgeProjection(
      connected,
      connected ? this.session?.lastBridgeStatus ?? null : null,
    );
    this.onBridgeConnectionChanged.emit(connected);
    if (connected) {
      this.cancelRuntimeReconnect();
    } else {
      this.telemetryClient.onDisconnect();
      this.robotPresenter.onDisconnect();
      this.navigationPlacement.onDisconnect();
      AppState.connectedRobotDisplayName = NO_ROBOT_CONNECTED_LABEL;
      this.appState.update({
        navigationOutcome: defaultNavigationOutcome(),
        robotRuntime: createDefaultRobotRuntimeState(),
      });
      this._maybeScheduleRuntimeReconnect();
    }
    this.applyFrameCapturePolicy();
  }

  private _maybeScheduleRuntimeReconnect(): void {
    if (this.appState.snapshot.phase !== "runtime") {
      return;
    }
    if (this._reconnectActive) {
      return;
    }
    this._reconnectActive = true;
    this._reconnectBackoffS = BRIDGE_RETRY_BASE_S;
    this._reconnectEvent?.reset(this._reconnectBackoffS);
  }

  private _scheduleNextRuntimeReconnect(): void {
    if (this.appState.snapshot.phase !== "runtime") {
      this.cancelRuntimeReconnect();
      return;
    }
    this._reconnectBackoffS = Math.min(
      this._reconnectBackoffS * BRIDGE_RETRY_BACKOFF_FACTOR,
      BRIDGE_RETRY_MAX_S,
    );
    this._reconnectEvent?.reset(this._reconnectBackoffS);
  }

  private _onRuntimeReconnectFired(): void {
    if (!this._reconnectActive) {
      return;
    }
    if (this.appState.snapshot.phase !== "runtime") {
      this.cancelRuntimeReconnect();
      return;
    }
    if (this.hasConnection()) {
      this.cancelRuntimeReconnect();
      return;
    }
    const ip = this.session?.baseUrl ?? "";
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
      print(`InboundRouter: reconnect attempt ${ip}`);
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
    const handshakeReady = this.session?.isConnected() ?? false;
    let effectiveConnected = connected;
    let effectiveStatus = status;
    if (!handshakeReady) {
      effectiveConnected = false;
      effectiveStatus = null;
    }
    const snapshot = projectBridgeSnapshot(handshakeReady, effectiveConnected ? effectiveStatus : null);
    const linkState = deriveLinkState(effectiveConnected, effectiveConnected ? effectiveStatus : null);
    const prev = this.appState.snapshot;
    const patch: Partial<typeof prev> = {};
    if (!bridgeSnapshotsEqual(prev.bridgeSnapshot, snapshot)) {
      patch.bridgeSnapshot = snapshot;
    }
    if (prev.bridgeLinkState !== linkState) {
      patch.bridgeLinkState = linkState;
    }
    if (Object.keys(patch).length > 0) {
      this.appState.update(patch);
    }
  }
}
