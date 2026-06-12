// ================================================================
/**
 * Facade for bridge connection utilities and link-state derivation.
 * Owns URL/IP persistence, connection initiation, and the logic that
 * maps raw connection + status flags onto BridgeLinkState.
 */
// ================================================================

import { BridgeClient } from "./BridgeClient";
import { BridgeLinkState } from "../AppState";
import { BridgeStatusMessage } from "./Protocol";

export interface ConnectionCoordinatorDeps {
  bridgeClient: BridgeClient | null;
  getBridgeLinkState: () => BridgeLinkState;
  setBridgeLinkState: (state: BridgeLinkState) => void;
}

export class ConnectionCoordinator {
  constructor(private readonly _deps: ConnectionCoordinatorDeps) {}

  public setBaseUrl(url: string): void {
    if (this._deps.bridgeClient) {
      this._deps.bridgeClient.baseUrl = url;
    }
  }

  public getBaseUrl(): string {
    return this._deps.bridgeClient ? this._deps.bridgeClient.baseUrl : "";
  }

  public getDefaultBridgeIp(): string {
    return this._deps.bridgeClient
      ? BridgeClient.normalizeIp(this._deps.bridgeClient.defaultBridgeIp)
      : "";
  }

  public saveIp(ip: string): void {
    if (this._deps.bridgeClient) {
      this._deps.bridgeClient.saveIp(ip);
    }
  }

  public loadIp(): string | null {
    return this._deps.bridgeClient ? this._deps.bridgeClient.loadIp() : null;
  }

  public async checkConnection(): Promise<boolean> {
    const client = this._deps.bridgeClient;
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
      print(`ConnectionCoordinator: checkConnection failed: ${error}`);
      return false;
    }
  }

  public hasBridgeConnection(): boolean {
    return this._deps.bridgeClient?.isConnected() ?? false;
  }

  public requestBridgeStatus(): boolean {
    return this._deps.bridgeClient?.requestStatus() ?? false;
  }

  public get lastBridgeStatus(): BridgeStatusMessage | null {
    return this._deps.bridgeClient?.lastBridgeStatus ?? null;
  }

  public deriveLinkState(
    connected: boolean,
    status: BridgeStatusMessage | null,
  ): BridgeLinkState {
    if (!connected) {
      return "disconnected";
    }
    if (!status?.robot_connected) {
      return "connectedNoRobot";
    }
    return "connected";
  }

  public syncLinkState(
    connected: boolean,
    status: BridgeStatusMessage | null,
  ): void {
    const next = this.deriveLinkState(connected, status);
    if (this._deps.getBridgeLinkState() === next) {
      return;
    }
    this._deps.setBridgeLinkState(next);
  }
}
