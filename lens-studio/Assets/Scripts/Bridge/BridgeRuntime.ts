import { BridgeClient } from "./BridgeClient";
import { FrameCaptureController } from "../Alignment/FrameCaptureController";
import { DimosState } from "../Core/DimosState";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { NavigationHost } from "../Navigation/NavigationHost";
import { Signal } from "../Core/SignalEmitter";
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

/** Bridge connection lifecycle, signals, and inbound message routing. */
@component
export class BridgeRuntime extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  dimosState: DimosState;

  @input
  robotRuntime: RobotRuntime;

  @input
  navigationHost: NavigationHost;

  @input
  frameCaptureController: FrameCaptureController;

  public readonly onBridgeReady = new Signal<void>();
  public readonly onBridgeStatusChanged = new Signal<BridgeStatusMessage>();
  public readonly onBridgeConnectionChanged = new Signal<boolean>();

  private _bound = false;

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
    this.bridgeClient.onPath.add((msg) => this.navigationHost?.controller?.applyPath(msg));
    this.bridgeClient.onPathPreview.add((msg) =>
      this.navigationHost?.controller?.applyPathPreview(msg),
    );
    this.bridgeClient.onNavStatus.add((msg) =>
      this.navigationHost?.controller?.applyNavStatus(msg),
    );
    this.bridgeClient.onBridgeStatus.add((msg) => this._applyBridgeStatus(msg));
    this.bridgeClient.onConnectionChanged.add((connected) =>
      this._applyConnectionState(connected),
    );
    this.bridgeClient.onProtocolError.add((error) =>
      this.navigationHost?.controller?.handleProtocolError(error),
    );

    const tickEvent = this.createEvent("UpdateEvent");
    tickEvent.bind(() => {
      this.dimosState.uiLogger.tick();
      this.robotRuntime?.applyPendingPose();
      this.robotRuntime?.tickFrame();
    });
  }

  public setBaseUrl(url: string): void {
    if (this.bridgeClient) {
      this.bridgeClient.baseUrl = url;
    }
  }

  public getBaseUrl(): string {
    return this.bridgeClient ? this.bridgeClient.baseUrl : "";
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

  public async checkConnection(): Promise<boolean> {
    const client = this.bridgeClient;
    if (!client) {
      return false;
    }
    try {
      await client.connect();
      const ready = await client.waitForHello(3.0);
      if (ready) {
        client.requestStatus();
      }
      return ready;
    } catch (error) {
      print(`BridgeRuntime: checkConnection failed: ${error}`);
      return false;
    }
  }

  public disconnect(): void {
    this.bridgeClient?.disconnect();
    this.navigationHost?.resetForUserDisconnect();
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
    this.navigationHost?.onHelloReset();
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
    this.robotRuntime.applyBridgeLinkState();
    this.onBridgeStatusChanged.emit(msg);
  }

  private _applyConnectionState(connected: boolean): void {
    print(`BridgeRuntime: bridge connection: ${connected ? "connected" : "disconnected"}`);
    this._syncLinkState(
      connected,
      connected ? this.bridgeClient?.lastBridgeStatus ?? null : null,
    );
    this.robotRuntime.applyBridgeLinkState();
    this.onBridgeConnectionChanged.emit(connected);
    if (!connected) {
      this.robotRuntime.onDisconnect();
      this.navigationHost?.onDisconnect();
      this.dimosState.update({
        navigationState: "off",
        navigationOutcome: defaultNavigationOutcome(),
        robotRuntime: createDefaultRobotRuntimeState(),
      });
    }
  }

  private _syncLinkState(
    connected: boolean,
    status: BridgeStatusMessage | null,
  ): void {
    const next = deriveLinkState(connected, status);
    if (this.dimosState.snapshot.bridgeLinkState === next) {
      return;
    }
    this.dimosState.update({ bridgeLinkState: next });
  }
}
