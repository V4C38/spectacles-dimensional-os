import { AR_MODULE_CLIENT_CONFIG, type WebSocketTransport } from "../core/websocket/hostPorts";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WATCHDOG_INTERVAL_S = 0.2;

export interface SpecsWebSocketTransportHandlers {
  onTransportOpen: () => void;
  onTransportClose: () => void;
  onTransportText: (chunk: string) => void;
  onTransportBinary: (data: Uint8Array) => void;
}

type BlobLike = { bytes(): Promise<Uint8Array> };

export class SpecsWebSocketTransport implements WebSocketTransport {
  private readonly internetModule: InternetModule;
  private readonly url: string;
  private readonly connectTimeoutS: number;
  private readonly connectTimeoutEvent: DelayedCallbackEvent;
  private readonly connectWatchdogEvent: DelayedCallbackEvent;
  private handlers: SpecsWebSocketTransportHandlers | null = null;
  private socket: WebSocket | null = null;
  private connecting = false;
  private hostClosing = false;
  private readonly retiredSockets = new Set<WebSocket>();

  constructor(deps: {
    internetModule: InternetModule;
    script: ScriptComponent;
    url: string;
    connectTimeoutS?: number;
  }) {
    this.internetModule = deps.internetModule;
    this.url = deps.url;
    this.connectTimeoutS = requirePositive(
      deps.connectTimeoutS ?? AR_MODULE_CLIENT_CONFIG.connectTimeoutS,
      "connectTimeoutS",
    );

    const connectTimeout = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    connectTimeout.bind(() => this.onConnectTimeout());
    this.connectTimeoutEvent = connectTimeout;

    const connectWatchdog = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    connectWatchdog.bind(() => this.onConnectWatchdog());
    this.connectWatchdogEvent = connectWatchdog;
  }

  bind(handlers: SpecsWebSocketTransportHandlers): void {
    this.handlers = handlers;
  }

  connect(): void {
    this.clearTimers();
    if (this.socket) {
      this.retire(this.socket);
      this.socket = null;
    }
    this.drainRetiredOpen();
    this.connecting = true;

    let socket: WebSocket;
    try {
      socket = this.internetModule.createWebSocket(this.url);
      socket.binaryType = "blob";
    } catch {
      this.connecting = false;
      this.emitClose();
      return;
    }

    this.socket = socket;
    this.attachHandlers(socket);
    this.connectTimeoutEvent.reset(this.connectTimeoutS);
    this.connectWatchdogEvent.reset(WATCHDOG_INTERVAL_S);
  }

  close(): void {
    this.hostClosing = true;
    try {
      this.clearTimers();
      const socket = this.socket;
      this.socket = null;
      this.connecting = false;
      if (socket) {
        this.retire(socket);
      }
    } finally {
      this.hostClosing = false;
    }
  }

  sendText(text: string): void {
    if (!this.isSocketOpen()) {
      throw new Error("WebSocket is not open");
    }
    this.socket!.send(text);
  }

  sendBinary(data: Uint8Array): void {
    if (!this.isSocketOpen()) {
      throw new Error("WebSocket is not open");
    }
    this.socket!.send(data);
  }

  private attachHandlers(socket: WebSocket): void {
    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.completeOpen(socket);
    };
    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (this.socket !== socket) {
        return;
      }
      // Specs may deliver traffic before a reliable onopen.
      if (this.connecting) {
        this.completeOpen(socket);
      }
      this.dispatchMessage(socket, event);
    };
    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.failCurrent(socket);
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.failCurrent(socket);
    };
  }

  private dispatchMessage(socket: WebSocket, event: WebSocketMessageEvent): void {
    const data = event.data;
    if (typeof data === "string") {
      this.handlers?.onTransportText(data);
      return;
    }
    if (isBlobLike(data)) {
      void this.dispatchBlob(socket, data);
    }
  }

  private async dispatchBlob(socket: WebSocket, blob: BlobLike): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await blob.bytes();
    } catch {
      return;
    }
    if (this.socket !== socket) {
      return;
    }
    this.handlers?.onTransportBinary(bytes);
  }

  private completeOpen(socket: WebSocket): void {
    if (!this.connecting || this.socket !== socket) {
      return;
    }
    this.clearTimers();
    this.connecting = false;
    this.handlers?.onTransportOpen();
  }

  private onConnectTimeout(): void {
    const socket = this.socket;
    if (!this.connecting || socket === null) {
      return;
    }
    if (socket.readyState === WS_OPEN) {
      this.completeOpen(socket);
      return;
    }
    this.failCurrent(socket);
  }

  private onConnectWatchdog(): void {
    const socket = this.socket;
    if (!this.connecting || socket === null) {
      return;
    }
    if (socket.readyState === WS_OPEN) {
      this.completeOpen(socket);
      return;
    }
    this.connectWatchdogEvent.reset(WATCHDOG_INTERVAL_S);
  }

  private failCurrent(socket: WebSocket): void {
    this.clearTimers();
    this.connecting = false;
    if (this.socket === socket) {
      this.socket = null;
    }
    this.retire(socket);
    this.emitClose();
  }

  private emitClose(): void {
    if (this.hostClosing) {
      return;
    }
    this.handlers?.onTransportClose();
  }

  private retire(socket: WebSocket): void {
    if (this.retiredSockets.has(socket)) {
      return;
    }
    this.detachHandlers(socket);
    this.retiredSockets.add(socket);
    socket.onopen = () => {
      if (this.retiredSockets.has(socket) && socket.readyState === WS_OPEN) {
        socket.close();
      }
    };
    socket.onclose = () => {
      this.retiredSockets.delete(socket);
    };
    socket.onerror = () => {};
    socket.onmessage = () => {};
    // Never close() a CONNECTING native socket — that freezes Specs.
    if (socket.readyState === WS_OPEN) {
      socket.close();
    }
  }

  private drainRetiredOpen(): void {
    for (const socket of Array.from(this.retiredSockets)) {
      if (socket.readyState === WS_OPEN) {
        socket.close();
      }
    }
  }

  private detachHandlers(socket: WebSocket): void {
    socket.onopen = () => {};
    socket.onmessage = () => {};
    socket.onerror = () => {};
    socket.onclose = () => {};
  }

  private clearTimers(): void {
    this.connectTimeoutEvent.reset(0);
    this.connectWatchdogEvent.reset(0);
  }

  private isSocketOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WS_OPEN;
  }
}

function isBlobLike(data: unknown): data is BlobLike {
  return typeof data === "object" && data !== null && typeof (data as BlobLike).bytes === "function";
}

function requirePositive(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number greater than 0`);
  }
  return value;
}
