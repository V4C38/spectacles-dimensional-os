import { AR_MODULE_CLIENT_CONFIG, type WebSocketTransport } from "@dimos-ar-client/websocket/hostPorts";

const WS_CONNECTING = 0;
const WS_OPEN = 1;

export interface BrowserWebSocketTransportHandlers {
  onTransportOpen: () => void;
  onTransportClose: () => void;
  onTransportText: (chunk: string) => void;
  onTransportBinary: (data: Uint8Array) => void;
}

export class BrowserWebSocketTransport implements WebSocketTransport {
  private url: string;
  private readonly connectTimeoutS: number;
  private readonly socketFactory: (url: string) => WebSocket;
  private handlers: BrowserWebSocketTransportHandlers | null = null;
  private socket: WebSocket | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private hostClosing = false;

  constructor(deps: {
    url: string;
    connectTimeoutS?: number;
    socketFactory?: (url: string) => WebSocket;
  }) {
    this.url = deps.url;
    this.connectTimeoutS = requirePositive(
      deps.connectTimeoutS ?? AR_MODULE_CLIENT_CONFIG.connectTimeoutS,
      "connectTimeoutS",
    );
    this.socketFactory = deps.socketFactory ?? ((url) => new WebSocket(url));
  }

  bind(handlers: BrowserWebSocketTransportHandlers): void {
    this.handlers = handlers;
  }

  getUrl(): string {
    return this.url;
  }

  setUrl(url: string): void {
    if (this.socket) {
      throw new Error("cannot change WebSocket url while active");
    }
    this.url = url;
  }

  connect(): void {
    this.clearTimeout();
    if (this.socket) {
      this.retire(this.socket);
      this.socket = null;
    }
    let socket: WebSocket;
    try {
      socket = this.socketFactory(this.url);
      socket.binaryType = "arraybuffer";
    } catch {
      this.handlers?.onTransportClose();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.clearTimeout();
      this.handlers?.onTransportOpen();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      if (typeof event.data === "string") {
        this.handlers?.onTransportText(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.handlers?.onTransportBinary(new Uint8Array(event.data));
        return;
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buffer) => {
          if (this.socket !== socket) {
            return;
          }
          this.handlers?.onTransportBinary(new Uint8Array(buffer));
        });
      }
    };
    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.fail(socket);
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.fail(socket);
    };
    this.timeoutId = setTimeout(() => {
      if (this.socket !== socket) {
        return;
      }
      if (socket.readyState === WS_OPEN) {
        return;
      }
      this.fail(socket);
    }, this.connectTimeoutS * 1000);
  }

  close(): void {
    this.hostClosing = true;
    try {
      this.clearTimeout();
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        this.retire(socket);
      }
    } finally {
      this.hostClosing = false;
    }
  }

  sendText(text: string): void {
    if (!this.socket || this.socket.readyState !== WS_OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.socket.send(text);
  }

  sendBinary(data: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WS_OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.socket.send(data);
  }

  private fail(socket: WebSocket): void {
    this.clearTimeout();
    if (this.socket === socket) {
      this.socket = null;
    }
    this.retire(socket);
    if (!this.hostClosing) {
      this.handlers?.onTransportClose();
    }
  }

  private retire(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING) {
      socket.close();
    }
  }

  private clearTimeout(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

function requirePositive(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number greater than 0`);
  }
  return value;
}
