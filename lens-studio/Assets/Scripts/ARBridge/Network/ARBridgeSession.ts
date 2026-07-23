import { ProtocolParseError } from "./Protocol";
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
  private _connectInFlight: Promise<boolean> | null = null;
  private _connectInFlightIp: string | null = null;
  private _connectAttemptId = 0;
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
      this.baseUrl = saved;
    } else if (this.defaultBridgeIp) {
      this.baseUrl = ARBridgeSession.normalizeIp(this.defaultBridgeIp);
    }

    const parseRecovery = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    parseRecovery.bind(() => {
      if (!this.baseUrl) {
        return;
      }
      this.disconnect();
      this.tryConnect(this.baseUrl).catch((error) => {
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

  public tryConnect(ip: string): Promise<boolean> {
    const normalized = ARBridgeSession.normalizeIp(ip);
    if (!normalized) {
      print("ARBridgeSession: tryConnect failed — empty IP");
      return Promise.resolve(false);
    }

    if (this._connectInFlight && this._connectInFlightIp === normalized) {
      return this._connectInFlight;
    }

    this._connectAttemptId += 1;
    if (this._connectInFlight) {
      if (this._transport?.isConnecting) {
        this._transport.cancelConnect();
      } else {
        this.disconnect();
      }
      this._connectInFlight = null;
      this._connectInFlightIp = null;
    }

    const attemptId = this._connectAttemptId;
    this.baseUrl = normalized;
    this._connectInFlightIp = normalized;

    let resolveConnect!: (ok: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolveConnect = resolve;
    });
    this._connectInFlight = promise;

    this._runTryConnect(normalized, attemptId)
      .then((ok) => {
        resolveConnect(ok);
      })
      .catch(() => {
        resolveConnect(false);
      })
      .finally(() => {
        if (this._connectInFlight === promise) {
          this._connectInFlight = null;
          this._connectInFlightIp = null;
        }
      });

    return promise;
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

  private async _runTryConnect(ip: string, attemptId: number): Promise<boolean> {
    if (!this._transport || !this._inbound) {
      return false;
    }

    if (this.isConnected() && ARBridgeSession.normalizeIp(this.baseUrl) === ip) {
      this._onSessionReady?.();
      return true;
    }

    if (attemptId !== this._connectAttemptId) {
      return false;
    }

    if (
      this._transport.isSocketOpen() &&
      ARBridgeSession.normalizeIp(this.baseUrl) === ip &&
      !this._inbound.helloReceived
    ) {
      return this._awaitHelloHandshake(ip, attemptId);
    }

    this.disconnect();
    if (attemptId !== this._connectAttemptId) {
      return false;
    }

    let handshakeError: string | null = null;
    const offProtocolError = this._inbound.onProtocolError.add((error: ProtocolParseError) => {
      if (!this._inbound!.helloReceived) {
        handshakeError = error.message;
      }
    });

    try {
      this._transport.baseUrl = ip;
      await this._transport.connect();
      if (attemptId !== this._connectAttemptId) {
        return false;
      }

      return this._finishHelloHandshake(ip, attemptId, handshakeError);
    } catch (error) {
      if (attemptId === this._connectAttemptId) {
        print(`ARBridgeSession: tryConnect failed — ${error}`);
        this.disconnect();
      }
      return false;
    } finally {
      offProtocolError();
    }
  }

  private async _awaitHelloHandshake(
    ip: string,
    attemptId: number,
  ): Promise<boolean> {
    if (!this._inbound) {
      return false;
    }

    let handshakeError: string | null = null;
    const offProtocolError = this._inbound.onProtocolError.add((error: ProtocolParseError) => {
      if (!this._inbound!.helloReceived) {
        handshakeError = error.message;
      }
    });

    try {
      return await this._finishHelloHandshake(ip, attemptId, handshakeError);
    } finally {
      offProtocolError();
    }
  }

  private async _finishHelloHandshake(
    _ip: string,
    attemptId: number,
    handshakeError: string | null,
  ): Promise<boolean> {
    if (!this._inbound) {
      return false;
    }

    const ready = await this._inbound.waitForHello(HELLO_TIMEOUT_S);
    if (attemptId !== this._connectAttemptId) {
      return false;
    }

    if (!ready) {
      const detail = handshakeError
        ? `hello parse error: ${handshakeError}`
        : "hello handshake timeout";
      print(`ARBridgeSession: tryConnect failed — ${detail}`);
      this.disconnect();
      return false;
    }

    this._onSessionReady?.();
    return true;
  }

  private _notifyConnection(connected: boolean): void {
    this._transport?.onBridgeConnectionChanged(connected);
    this.onConnectionChanged.emit(connected);
  }
}
