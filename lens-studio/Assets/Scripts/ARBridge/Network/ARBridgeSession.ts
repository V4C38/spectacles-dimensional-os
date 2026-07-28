import {
  ClockSyncState,
  WebSocketTransport,
} from "./WebSocketTransport";
import { InboundProcessor } from "./InboundProcessor";
import { Signal } from "../../App/Utilities/Utilities";

const HELLO_TIMEOUT_S = 5.0;

/**
 * @component Wire/session owner: WebSocket transport, hello handshake, clock sync.
 * Domain sends live on *Client classes; inbound signals on InboundProcessor.
 *
 * Socket connect/disconnect follows Reachy HardwareAdapter. Hello wait is the
 * DimOS post-open health check (Reachy's `{type:"status"}` analogue).
 */
@component
export class ARBridgeSession extends BaseScriptComponent {
  /** Default Mac LAN IP when no IP is saved on device. */
  @input
  defaultBridgeIp: string = "192.168.1.62";

  @input
  internetModule: InternetModule;

  public baseUrl: string = "";

  private _transport: WebSocketTransport | null = null;
  private _inbound: InboundProcessor | null = null;
  private _parseRecoveryEvent: DelayedCallbackEvent | null = null;
  private _onSessionReady: (() => void) | null = null;

  public readonly onConnectionChanged = new Signal<boolean>();

  public get transport(): WebSocketTransport {
    return this._transport!;
  }

  public get inbound(): InboundProcessor {
    return this._inbound!;
  }

  public get onClockSyncStateChanged(): Signal<ClockSyncState> {
    return this._transport!.onClockSyncStateChanged;
  }

  public get isClockSyncReady(): boolean {
    return this._transport?.isClockSyncReady ?? false;
  }

  public get clockSyncState(): ClockSyncState {
    return this._transport?.clockSyncState ?? "idle";
  }

  public mapCaptureTime(lensTs: number): number {
    return this._transport!.mapCaptureTime(lensTs);
  }

  public get activeRobotId(): string | null {
    return this._inbound?.activeRobotId ?? null;
  }

  public get lastBridgeStatus() {
    return this._inbound?.lastBridgeStatus ?? null;
  }

  public get poseRxCount(): number {
    return this._inbound?.poseRxCount ?? 0;
  }

  public get messageRxCount(): number {
    return this._inbound?.messageRxCount ?? 0;
  }

  /** Called after hello handshake succeeds (e.g. StatusClient.requestStatus). */
  public setOnSessionReady(handler: () => void): void {
    this._onSessionReady = handler;
  }

  onAwake() {
    this._transport = new WebSocketTransport(this.internetModule, this);
    const saved = this._transport.loadIp();
    if (saved) {
      this.baseUrl = ARBridgeSession.normalizeIp(saved);
      this._transport.baseUrl = this.baseUrl;
    } else if (this.defaultBridgeIp) {
      this.baseUrl = ARBridgeSession.normalizeIp(this.defaultBridgeIp);
      this._transport.baseUrl = this.baseUrl;
    }

    const parseRecovery = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    parseRecovery.bind(() => {
      if (!this.baseUrl) {
        return;
      }
      this.disconnect();
      this.checkConnection().catch((error) => {
        print(`ARBridgeSession: parse-recovery reconnect failed: ${error}`);
      });
    });
    this._parseRecoveryEvent = parseRecovery;

    this._inbound = new InboundProcessor(this, this._transport, {
      onHelloConnection: (connected) => this._notifyConnection(connected),
      onSocketClosed: () => this._notifyConnection(false),
      scheduleParseRecoveryReconnect: () => this._parseRecoveryEvent!.reset(0.5),
    });

    this._transport.wireClockSync(this._inbound);
  }

  public static normalizeIp(raw: string): string {
    return WebSocketTransport.normalizeIp(raw);
  }

  public setBaseUrl(url: string): void {
    const normalized = ARBridgeSession.normalizeIp(url);
    this.baseUrl = normalized;
    if (this._transport) {
      this._transport.baseUrl = normalized;
    }
  }

  public saveIp(ip: string): void {
    this._transport?.saveIp(ip);
  }

  public loadIp(): string | null {
    return this._transport?.loadIp() ?? null;
  }

  public clearIp(): void {
    this._transport?.clearIp();
  }

  public isSocketOpen(): boolean {
    return this._transport?.isSocketOpen() ?? false;
  }

  /**
   * Reachy-shaped connect check: ensure socket is open to baseUrl, then wait for hello.
   * Never aborts an in-flight connect attempt — a submit during one coalesces
   * onto it and the retry loop picks up a changed IP afterwards.
   */
  public async checkConnection(): Promise<boolean> {
    if (!this._transport || !this._inbound) {
      return false;
    }

    const host = ARBridgeSession.normalizeIp(this.baseUrl);
    if (!host) {
      print("ARBridgeSession: checkConnection failed — empty IP");
      return false;
    }

    this.baseUrl = host;
    this._transport.baseUrl = host;

    try {
      // Drop an established connection to another host. Do NOT disconnect
      // while a connect is in flight — aborting a CONNECTING native socket
      // freezes Spectacles and tears down the successor attempt.
      if (this._transport.isSocketOpen() && this._transport.openHost !== host) {
        this.disconnect();
      }

      if (!this._transport.isSocketOpen()) {
        // Coalesces with any in-flight attempt (Reachy isConnecting guard).
        await this._transport.connect();
      }

      if (!this._transport.isSocketOpen() || this._transport.openHost !== host) {
        // The in-flight attempt targeted a previous host; the next retry
        // reconnects to the current one.
        return false;
      }

      if (this._inbound.helloReceived) {
        this._onSessionReady?.();
        return true;
      }

      const ready = await this._inbound.waitForHello(HELLO_TIMEOUT_S);
      if (!ready) {
        print("ARBridgeSession: checkConnection failed — hello handshake timeout");
        this.disconnect();
        return false;
      }

      this._onSessionReady?.();
      return true;
    } catch (error) {
      // The transport already cleaned up its failed attempt. Do not call
      // disconnect() here — a newer attempt may be in flight and this
      // rejection handler runs on a stale one.
      print(`ARBridgeSession: checkConnection failed — ${error}`);
      return false;
    }
  }

  /** setBaseUrl + checkConnection (thin wrapper for existing callers). */
  public tryConnect(ip: string): Promise<boolean> {
    this.setBaseUrl(ip);
    return this.checkConnection();
  }

  public disconnect(): void {
    const hadSocket =
      this._transport?.isSocketOpen() || (this._inbound?.helloReceived ?? false);
    this._transport?.disconnect(false);
    this._inbound?.resetSessionState();
    if (hadSocket) {
      this._notifyConnection(false);
    }
  }

  public isConnected(): boolean {
    return (
      this._transport !== null &&
      this._transport.isSocketOpen() &&
      (this._inbound?.helloReceived ?? false)
    );
  }

  public send(text: string): boolean {
    const payload = text.endsWith("\n") ? text : `${text}\n`;
    return this._transport?.send(payload) ?? false;
  }

  public sendBinary(bytes: Uint8Array): void {
    if (!this._transport?.sendBinary(bytes)) {
      print("ARBridgeSession: sendBinary skipped — not open");
    }
  }

  public isCapabilityAvailable(capability: string): boolean {
    return this._inbound?.isCapabilityAvailable(capability) ?? true;
  }

  private _notifyConnection(connected: boolean): void {
    this._transport?.onBridgeConnectionChanged(connected);
    this.onConnectionChanged.emit(connected);
  }
}
