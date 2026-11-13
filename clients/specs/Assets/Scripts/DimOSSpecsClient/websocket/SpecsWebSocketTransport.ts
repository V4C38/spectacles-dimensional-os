import { type WebSocketTransportHandlers as SpecsWebSocketTransportHandlers, AR_MODULE_CLIENT_CONFIG, type WebSocketTransport } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";


const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WATCHDOG_INTERVAL_S = 0.2;

export type { WebSocketTransportHandlers as SpecsWebSocketTransportHandlers } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";

const RECEIVE_RECORD_LIMIT = 256;
const RECEIVE_BYTE_LIMIT = 4 * 1024 * 1024;
const BINARY_RECORD_LIMIT = 16384;
type BlobLike = { bytes(): Promise<Uint8Array>; size?: number };
type ReceiveQueue = { items: { data: string | BlobLike; bytes: number }[]; bytes: number; draining: boolean };

export class SpecsWebSocketTransport implements WebSocketTransport {
  private readonly internetModule: InternetModule;
  private url: string;
  private readonly connectTimeoutS: number;
  private readonly connectTimeoutEvent: DelayedCallbackEvent;
  private readonly connectWatchdogEvent: DelayedCallbackEvent;
  private handlers: SpecsWebSocketTransportHandlers | null = null;
  private socket: WebSocket | null = null;
  private connecting = false;
  private receiveQueue: ReceiveQueue | null = null;
  private hostClosing = false;
  private readonly retiredSockets = new Set<WebSocket>();
  private bulkSibling: SpecsWebSocketTransport | null = null;
  private readonly sibling: (path: string) => SpecsWebSocketTransport;

  constructor(deps: {
    internetModule: InternetModule;
    script: ScriptComponent;
    url: string;
    connectTimeoutS?: number;
  }) {
    this.internetModule = deps.internetModule;
    this.sibling = path => {
      const url = /^wss?:\/\//.test(path) ? path : this.url.replace(/^(wss?:\/\/[^/]+).*$/, "$1") + path;
      if (!this.bulkSibling) this.bulkSibling = new SpecsWebSocketTransport({ ...deps, url });
      else { this.bulkSibling.close(); this.bulkSibling.setUrl(url); }
      return this.bulkSibling;
    };
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

  getUrl(): string {
    return this.url;
  }
  createSibling(path: string): SpecsWebSocketTransport { return this.sibling(path); }
  bufferedAmount(): number { return (this.socket as unknown as { bufferedAmount?: number } | null)?.bufferedAmount ?? 0; }

  setUrl(url: string): void {
    if (this.connecting || this.isSocketOpen()) {
      throw new Error("cannot change WebSocket url while active");
    }
    this.url = url;
  }

  connect(): void {
    this.close();
    this.openSocket();
  }

  private openSocket(): void {
    this.clearTimers();
    if (this.socket) {
      this.retire(this.socket);
      this.socket = null;
    }
    this.drainRetiredOpen();
    // A timed-out native CONNECTING socket cannot safely be closed. Do not pile
    // more native connections on top of it while it is still unresolved.
    if (Array.from(this.retiredSockets).some(socket => socket.readyState === WS_CONNECTING)) {
      this.emitClose(); return;
    }
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
    this.receiveQueue = { items: [], bytes: 0, draining: false };
    this.attachHandlers(socket);
    this.connectTimeoutEvent.reset(this.connectTimeoutS);
    this.connectWatchdogEvent.reset(WATCHDOG_INTERVAL_S);
  }

  close(): void {
    this.hostClosing = true;
    try {
      this.clearTimers();
      const socket = this.socket;
      this.clearReceiveQueue();
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
    const data = event.data, queue = this.receiveQueue;
    if (!queue || (typeof data !== "string" && !isBlobLike(data))) return;
    // Missing native Blob.size reserves a full binary record before decoding.
    const declaredBytes = typeof data === "string" ? data.length * 2 : data.size ?? BINARY_RECORD_LIMIT;
    const bytes = typeof data === "string" ? declaredBytes : BINARY_RECORD_LIMIT;
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 ||
      typeof data !== "string" && declaredBytes > BINARY_RECORD_LIMIT ||
      queue.items.length >= RECEIVE_RECORD_LIMIT || queue.bytes + bytes > RECEIVE_BYTE_LIMIT) {
      this.failCurrent(socket); return;
    }
    queue.items.push({ data, bytes }); queue.bytes += bytes;
    if (!queue.draining) void this.drainReceiveQueue(socket, queue);
  }

  private async drainReceiveQueue(socket: WebSocket, queue: ReceiveQueue): Promise<void> {
    queue.draining = true;
    try {
      while (this.socket === socket && this.receiveQueue === queue && queue.items.length) {
        const item = queue.items[0];
        if (typeof item.data === "string") this.handlers?.onTransportText(item.data);
        else {
          const bytes = await item.data.bytes();
          if (this.socket !== socket || this.receiveQueue !== queue) return;
          if (bytes.byteLength > BINARY_RECORD_LIMIT) throw new Error("Binary receive budget exceeded");
          this.handlers?.onTransportBinary(bytes);
        }
        if (this.receiveQueue !== queue) return;
        queue.items.shift(); queue.bytes -= item.bytes;
      }
    } catch {
      if (this.socket === socket && this.receiveQueue === queue) this.failCurrent(socket);
    } finally { queue.draining = false; }
  }

  private clearReceiveQueue(): void {
    if (this.receiveQueue) { this.receiveQueue.items.length = 0; this.receiveQueue.bytes = 0; }
    this.receiveQueue = null;
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
    this.clearReceiveQueue();
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
    if (socket.readyState !== WS_CONNECTING && socket.readyState !== WS_OPEN) return;
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
    this.connectTimeoutEvent.cancel();
    this.connectWatchdogEvent.cancel();
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
