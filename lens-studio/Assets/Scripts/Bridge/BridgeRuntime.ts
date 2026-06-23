import { BridgeClient } from "./BridgeClient";
import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { DimosState } from "../Core/DimosState";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { NavigationController } from "../Navigation/NavigationController";
import { Signal } from "../Core/Utilities";
import {
  createDefaultDriftState,
  createDefaultRobotRuntimeState,
  defaultNavigationOutcome,
  isRuntimePhase as isAppRuntimePhase,
} from "../Core/AppState";
import {
  BridgeStatusMessage,
  deriveLinkState,
  HelloMessage,
} from "./Protocol";
import { projectRuntimeStateFromHello } from "../Robot/RobotRuntimeModel";

/** Bridge→app integration: inbound fan-out, link-state presentation, lifecycle signals. */
export class BridgeRuntime {
  public readonly onBridgeReady = new Signal<void>();
  public readonly onBridgeStatusChanged = new Signal<BridgeStatusMessage>();
  public readonly onBridgeConnectionChanged = new Signal<boolean>();

  private _bound = false;

  constructor(
    private readonly bridgeClient: BridgeClient | null,
    private readonly dimosState: DimosState,
    private readonly robotRuntime: RobotRuntime,
    private readonly navigationController: NavigationController,
    private readonly frameCaptureController: FrameCaptureController | null,
  ) {}

  public bind(): void {
    if (this._bound || !this.bridgeClient) {
      return;
    }
    this._bound = true;

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
    this.bridgeClient.onPoseCorrection.add((msg) => {
      this.robotRuntime?.onPoseCorrection(msg);
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

  public getBaseUrl(): string {
    return this.bridgeClient ? this.bridgeClient.baseUrl : "";
  }

  public normalizeBridgeIp(raw: string): string {
    return BridgeClient.normalizeIp(raw);
  }

  public disconnect(): void {
    this.bridgeClient?.disconnect();
    this.navigationController?.resetForUserDisconnect();
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

  private _applyHello(msg: HelloMessage): void {
    const runtimeState = projectRuntimeStateFromHello(msg);
    this.navigationController?.onHelloReset();
    this.robotRuntime?.resetBridgeLidarModeTracking();
    this.dimosState.update({
      robotRuntime: runtimeState,
      driftState: createDefaultDriftState(),
      navigationOutcome: defaultNavigationOutcome(),
    });
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    const shouldClearAnchor = this.robotRuntime.poseCorrection.onBridgeStatus(
      msg,
      this.dimosState.snapshot.robotInteractionMode === "manualPlacement",
    );
    if (shouldClearAnchor) {
      this.robotRuntime.poseCorrection.reset();
    }
    this._syncLinkState(true, msg);
    if (isAppRuntimePhase(this.dimosState.snapshot) && this.frameCaptureController) {
      this.frameCaptureController.setMode(msg.registered ? "runtime" : "off");
    }
    this.onBridgeStatusChanged.emit(msg);
  }

  private _applyConnectionState(connected: boolean): void {
    print(`BridgeRuntime: bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._syncLinkState(
      connected,
      connected ? this.bridgeClient?.lastBridgeStatus ?? null : null,
    );
    this.onBridgeConnectionChanged.emit(connected);
    if (!connected) {
      this.robotRuntime.onDisconnect();
      this.navigationController?.onDisconnect();
      this.dimosState.update({
        navigationOutcome: defaultNavigationOutcome(),
        robotRuntime: createDefaultRobotRuntimeState(),
      });
    }
  }

  private _syncLinkState(
    connected: boolean,
    status: BridgeStatusMessage | null,
  ): void {
    const handshakeReady = this.bridgeClient?.isConnected() ?? false;
    if (!handshakeReady) {
      connected = false;
      status = null;
    }
    const next = deriveLinkState(connected, status);
    if (this.dimosState.snapshot.bridgeLinkState === next) {
      return;
    }
    this.dimosState.update({ bridgeLinkState: next });
  }
}
