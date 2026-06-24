import { IP_STORAGE_KEY, WS_PORT } from "../UI/kit/UIKit";
import { Signal } from "../Core/Utilities";
import { buildPing, HelloMessage, PongMessage } from "./Protocol";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const FRAGMENT_REASSEMBLY_MAX_BYTES = 1_048_576;
const PING_BURST_COUNT = 4;
const PING_INTERVAL_S = 0.2;
const PONG_TIMEOUT_S = 2.0;
const CONNECTING_LOG_INTERVAL_S = 10.0;
const WS_CONNECT_TIMEOUT_S = 8.0;
const WS_CONNECT_WATCHDOG_INTERVAL_S = 0.2;

export type ClockSyncState = "idle" | "pending" | "ready" | "failed";

export interface PendingBinaryFrame {
  blob: Blob;
  socket: WebSocket | null;
}

interface PingSample {
  offsetS: number;
  rttS: number;
}

export interface BridgeClockSyncInbound {
  helloReceived: boolean;
  activeRobotId: string | null;
  onHello: Signal<HelloMessage>;
  onPong: Signal<PongMessage>;
}

/** WebSocket transport, IP persistence, and connect-time clock sync. */
export class BridgeConnectionManager {
  public readonly onOpen = new Signal<void>();
  public readonly onClose = new Signal<void>();
  public readonly onTextMessage = new Signal<string>();
  public readonly onBinaryBlob = new Signal<PendingBinaryFrame>();
  public readonly onClockSyncStateChanged = new Signal<ClockSyncState>();

  public baseUrl: string = "";
  public ws: WebSocket | null = null;
  public isConnecting = false;
  private _lastConnectingLogTime = -1;

  private readonly internetModule: InternetModule;
  private _fragmentBuffer: string | null = null;
  private _connectTimeoutEvent: DelayedCallbackEvent | null = null;
  private _connectWatchdogEvent: DelayedCallbackEvent | null = null;
  private _connectingSocket: WebSocket | null = null;
  private _pendingConnectReject: ((error: Error) => void) | null = null;
  private _pendingConnectResolve: (() => void) | null = null;
  private _connectPromise: Promise<void> | null = null;
  private _retiredSockets = new Set<WebSocket>();

  private _inbound: BridgeClockSyncInbound | null = null;
  private _pingTimer: DelayedCallbackEvent | null = null;
  private _pongTimeoutTimer: DelayedCallbackEvent | null = null;
  private _clockSyncState: ClockSyncState = "idle";
  private _clockOffsetS = 0;
  private _burstIndex = 0;
  private _pendingClientTs: number[] = [];
  private _pingSamples: PingSample[] = [];
  private _clockSyncRetryUsed = false;
  private _burstTimedOut = false;

  constructor(internetModule: InternetModule, script: ScriptComponent) {
    this.internetModule = internetModule;

    const connectTimeout = script.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    connectTimeout.bind(() => {
      const socket = this._connectingSocket;
      if (!this.isConnecting || this.ws !== socket || socket === null) {
        return;
      }
      if (socket.readyState === WS_OPEN) {
        this._completeConnectOpen(socket);
        return;
      }
      this._retireSocket(socket);
      this.ws = null;
      this._finishConnectAttempt(new Error("WebSocket connection timeout"));
    });
    this._connectTimeoutEvent = connectTimeout;

    const connectWatchdog = script.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    connectWatchdog.bind(() => {
      const socket = this._connectingSocket;
      if (!this.isConnecting || this.ws !== socket || socket === null) {
        return;
      }
      if (socket.readyState === WS_OPEN) {
        this._completeConnectOpen(socket);
        return;
      }
      this._connectWatchdogEvent!.reset(WS_CONNECT_WATCHDOG_INTERVAL_S);
    });
    this._connectWatchdogEvent = connectWatchdog;

    const pingTimer = script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    pingTimer.bind(() => this._sendNextPing());
    this._pingTimer = pingTimer;

    const pongTimeoutTimer = script.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    pongTimeoutTimer.bind(() => {
      this._burstTimedOut = true;
      this._finishClockSyncBurst();
    });
    this._pongTimeoutTimer = pongTimeoutTimer;
  }

  public wireClockSync(inbound: BridgeClockSyncInbound): void {
    this._inbound = inbound;
    inbound.onHello.add(this._onHelloForClockSync);
    inbound.onPong.add(this._onPongForClockSync);
  }

  public get isClockSyncReady(): boolean {
    return this._clockSyncState === "ready";
  }

  public get clockSyncState(): ClockSyncState {
    return this._clockSyncState;
  }

  public mapCaptureTime(lensTs: number): number {
    return lensTs + this._clockOffsetS;
  }

  public onBridgeConnectionChanged(connected: boolean): void {
    if (!connected) {
      this._resetClockSyncAll();
    }
  }

  private get store(): GeneralDataStore {
    return global.persistentStorageSystem.store;
  }

  public static normalizeIp(raw: string): string {
    let host = raw.trim();
    if (host.startsWith("http://")) host = host.substring(7);
    if (host.startsWith("https://")) host = host.substring(8);
    if (host.startsWith("ws://")) host = host.substring(5);
    if (host.startsWith("wss://")) host = host.substring(6);
    while (host.endsWith("/")) host = host.substring(0, host.length - 1);
    const colonIdx = host.lastIndexOf(":");
    if (colonIdx > 0) {
      host = host.substring(0, colonIdx);
    }
    return host;
  }

  public saveIp(ip: string): void {
    this.store.putString(IP_STORAGE_KEY, BridgeConnectionManager.normalizeIp(ip));
  }

  public loadIp(): string | null {
    if (this.store.has(IP_STORAGE_KEY)) {
      return BridgeConnectionManager.normalizeIp(this.store.getString(IP_STORAGE_KEY));
    }
    return null;
  }

  public clearIp(): void {
    if (this.store.has(IP_STORAGE_KEY)) {
      this.store.remove(IP_STORAGE_KEY);
    }
  }

  private deriveWsUrl(input: string): string {
    const host = BridgeConnectionManager.normalizeIp(input);
    return `ws://${host}:${WS_PORT}`;
  }

  public connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      return Promise.resolve();
    }
    if (this.isConnecting && this._connectPromise) {
      return this._connectPromise;
    }
    this.disconnect(false);
    this._drainRetiredSockets();
    this.isConnecting = true;

    const wsUrl = this.deriveWsUrl(this.baseUrl);
    const now = getTime();
    if (
      this._lastConnectingLogTime < 0 ||
      now - this._lastConnectingLogTime >= CONNECTING_LOG_INTERVAL_S
    ) {
      this._lastConnectingLogTime = now;
      print(`BridgeClient: connecting to ${wsUrl}`);
    }

    this._connectPromise = new Promise((resolve, reject) => {
      this._pendingConnectReject = reject;
      this._pendingConnectResolve = resolve;
      try {
        this.ws = this.internetModule.createWebSocket(wsUrl);
        this.ws.binaryType = "blob";
      } catch (error) {
        this._finishConnectAttempt(new Error(`Failed to create WebSocket: ${error}`));
        return;
      }

      const socket = this.ws;
      this._connectingSocket = socket;

      socket.onopen = () => {
        if (this.ws !== socket) {
          return;
        }
        this._completeConnectOpen(socket);
      };

      socket.onmessage = (event: WebSocketMessageEvent) => {
        if (this.ws !== socket) {
          return;
        }
        if (this.isConnecting && this._connectingSocket === socket) {
          this._completeConnectOpen(socket);
        }
        this._onMessage(event);
      };

      socket.onerror = () => {
        if (this.ws !== socket) {
          return;
        }
        this._retireSocket(socket);
        this.ws = null;
        this._finishConnectAttempt(new Error("WebSocket connection error"));
      };

      socket.onclose = (event: WebSocketCloseEvent) => {
        if (this.ws !== socket) {
          return;
        }
        print(
          `BridgeClient: socket closed code=${(event as unknown as { code?: number }).code ?? "?"} reason="${(event as unknown as { reason?: string }).reason ?? ""}"`,
        );
        const wasConnecting = this.isConnecting && this._connectingSocket === socket;
        this.ws = null;
        this._fragmentBuffer = null;
        if (wasConnecting) {
          this._finishConnectAttempt(new Error("WebSocket connection closed"));
        } else {
          this.onClose.emit();
        }
      };

      this._connectTimeoutEvent!.reset(WS_CONNECT_TIMEOUT_S);
      this._connectWatchdogEvent!.reset(WS_CONNECT_WATCHDOG_INTERVAL_S);
    });

    return this._connectPromise;
  }

  /** Abort an in-flight connect without emitting onClose or resetting inbound state. */
  public cancelConnect(): void {
    if (!this.isConnecting) {
      return;
    }
    const socket = this._connectingSocket ?? this.ws;
    if (socket) {
      this._retireSocket(socket);
    }
    this.ws = null;
    this._fragmentBuffer = null;
    this._finishConnectAttempt(new Error("WebSocket connection cancelled"));
  }

  public disconnect(notify: boolean = true): void {
    if (this.isConnecting) {
      const socket = this._connectingSocket ?? this.ws;
      if (socket) {
        this._retireSocket(socket);
      }
      this.ws = null;
      this._fragmentBuffer = null;
      this._finishConnectAttempt(new Error("WebSocket connection closed"));
    } else if (this.ws) {
      const socket = this.ws;
      this._detachSocketHandlers(socket);
      socket.close();
      this.ws = null;
    }
    this._fragmentBuffer = null;
    this.isConnecting = false;
    if (notify) {
      this.onClose.emit();
    }
  }

  public isSocketOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  public send(text: string): boolean {
    if (this.isSocketOpen()) {
      this.ws!.send(text);
      return true;
    }
    return false;
  }

  public sendBinary(bytes: Uint8Array): boolean {
    if (this.isSocketOpen()) {
      this.ws!.send(bytes);
      return true;
    }
    return false;
  }

  private _isProtocolConnected(): boolean {
    return this.isSocketOpen() && (this._inbound?.helloReceived ?? false);
  }

  private _setClockSyncState(state: ClockSyncState): void {
    if (this._clockSyncState === state) {
      return;
    }
    this._clockSyncState = state;
    this.onClockSyncStateChanged.emit(state);
  }

  private _resetClockSyncBurst(): void {
    this._clockOffsetS = 0;
    this._burstIndex = 0;
    this._pendingClientTs = [];
    this._pingSamples = [];
    this._burstTimedOut = false;
  }

  private _resetClockSyncAll(): void {
    this._resetClockSyncBurst();
    this._clockSyncRetryUsed = false;
    this._setClockSyncState("idle");
  }

  private _onHelloForClockSync = (_msg: HelloMessage): void => {
    if (this._clockSyncState === "failed" && !this._clockSyncRetryUsed) {
      this._clockSyncRetryUsed = true;
      this._resetClockSyncBurst();
      this._setClockSyncState("pending");
      this._sendNextPing();
      return;
    }
    this._resetClockSyncBurst();
    this._clockSyncRetryUsed = false;
    this._setClockSyncState("pending");
    this._sendNextPing();
  };

  private _sendNextPing(): void {
    if (!this._isProtocolConnected()) {
      return;
    }
    const robotId = this._inbound?.activeRobotId;
    if (!robotId) {
      return;
    }
    const clientTs = getTime();
    this._pendingClientTs.push(clientTs);
    this.send(buildPing(clientTs, robotId));
    this._burstIndex++;
    if (this._burstIndex < PING_BURST_COUNT) {
      this._pingTimer!.reset(PING_INTERVAL_S);
    } else {
      this._pongTimeoutTimer!.reset(PONG_TIMEOUT_S);
    }
  }

  private _onPongForClockSync = (msg: PongMessage): void => {
    const sentTs = this._pendingClientTs.shift();
    if (sentTs === undefined) {
      return;
    }
    const receivedTs = getTime();
    const rttS = receivedTs - sentTs;
    const offsetS = msg.bridge_ts - sentTs - rttS * 0.5;
    this._pingSamples.push({ offsetS, rttS });

    if (this._pingSamples.length >= PING_BURST_COUNT) {
      this._finishClockSyncBurst();
    }
  };

  private _finishClockSyncBurst(): void {
    if (this._clockSyncState === "ready") {
      return;
    }
    if (this._pingSamples.length === 0) {
      if (this._burstTimedOut || this._burstIndex >= PING_BURST_COUNT) {
        this._setClockSyncState("failed");
        print("BridgeClockSync: failed (no pongs)");
      }
      return;
    }
    const sorted = this._pingSamples
      .map((s) => s.offsetS)
      .sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    this._clockOffsetS =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) * 0.5
        : sorted[mid];
    const rtts = this._pingSamples.map((s) => s.rttS).sort((a, b) => a - b);
    const rttMid = Math.floor(rtts.length / 2);
    const medianRtt =
      rtts.length % 2 === 0
        ? (rtts[rttMid - 1] + rtts[rttMid]) * 0.5
        : rtts[rttMid];
    this._setClockSyncState("ready");
    print(
      `BridgeClockSync: ready offset=${this._clockOffsetS.toFixed(4)}s rtt=${medianRtt.toFixed(4)}s samples=${this._pingSamples.length}`,
    );
  }

  private _onMessage(event: WebSocketMessageEvent): void {
    if (event.data instanceof Blob) {
      this.onBinaryBlob.emit({ blob: event.data, socket: this.ws });
      return;
    }
    if (typeof event.data !== "string") {
      return;
    }
    const lines = this._accumulateTextFrames(event.data);
    for (const line of lines) {
      this.onTextMessage.emit(line);
    }
  }

  private _accumulateTextFrames(raw: string): string[] {
    const combined = (this._fragmentBuffer ?? "") + raw;
    if (combined.length > FRAGMENT_REASSEMBLY_MAX_BYTES) {
      print(
        `BridgeClient: discarding oversized text buffer (${combined.length} bytes)`,
      );
      this._fragmentBuffer = null;
      return [];
    }
    const parts = combined.split("\n");
    const tail = parts.pop() ?? "";
    this._fragmentBuffer = tail.length > 0 ? tail : null;
    return parts.filter((line) => line.length > 0);
  }

  private _detachSocketHandlers(socket: WebSocket): void {
    socket.onopen = () => {};
    socket.onmessage = () => {};
    socket.onerror = () => {};
    socket.onclose = () => {};
  }

  private _clearConnectTimeout(): void {
    this._connectTimeoutEvent?.reset(0);
  }

  private _clearConnectWatchdog(): void {
    this._connectWatchdogEvent?.reset(0);
  }

  private _completeConnectOpen(socket: WebSocket): void {
    if (
      !this.isConnecting ||
      this.ws !== socket ||
      this._connectingSocket !== socket
    ) {
      return;
    }
    this._clearConnectTimeout();
    this._clearConnectWatchdog();
    this.isConnecting = false;
    this._connectingSocket = null;
    const resolveFn = this._pendingConnectResolve;
    this._pendingConnectReject = null;
    this._pendingConnectResolve = null;
    this._connectPromise = null;
    print("BridgeClient: connected");
    this.onOpen.emit();
    if (resolveFn) {
      resolveFn();
    }
  }

  private _retireSocket(socket: WebSocket): void {
    if (this._retiredSockets.has(socket)) {
      return;
    }
    this._detachSocketHandlers(socket);
    this._retiredSockets.add(socket);
    socket.onopen = () => {
      if (this._retiredSockets.has(socket)) {
        socket.close();
      }
    };
    socket.onclose = () => {
      this._retiredSockets.delete(socket);
    };
    socket.onerror = () => {};
    socket.onmessage = () => {};
    if (socket.readyState === WS_OPEN) {
      socket.close();
    }
  }

  private _drainRetiredSockets(): void {
    for (const socket of Array.from(this._retiredSockets)) {
      if (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING) {
        socket.close();
      }
    }
  }

  private _finishConnectAttempt(error?: Error): void {
    this._clearConnectTimeout();
    this._clearConnectWatchdog();
    this.isConnecting = false;
    this._connectingSocket = null;
    this._connectPromise = null;
    const rejectFn = this._pendingConnectReject;
    const resolveFn = this._pendingConnectResolve;
    this._pendingConnectReject = null;
    this._pendingConnectResolve = null;
    if (error && rejectFn) {
      rejectFn(error);
    } else if (!error && resolveFn) {
      resolveFn();
    }
  }
}
