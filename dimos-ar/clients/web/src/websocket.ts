import { buildDevRegister, parseOutboundMessage, type OutboundMessage } from "./protocol";

export type MessageHandler = (msg: OutboundMessage) => void;

export interface BridgeClientCallbacks {
  onMessage: MessageHandler;
  onOpen: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: BridgeClientCallbacks;

  constructor(url: string, callbacks: BridgeClientCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.connected) {
      return;
    }
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.callbacks.onOpen();
    };
    this.ws.onclose = () => {
      this.ws = null;
      this.callbacks.onClose();
    };
    this.ws.onerror = () => {
      this.callbacks.onError("WebSocket connection error");
    };
    this.ws.onmessage = (event) => {
      if (typeof event.data !== "string") {
        this.callbacks.onError("Only JSON text frames are supported");
        return;
      }
      try {
        const msg = parseOutboundMessage(event.data);
        if (msg !== null) {
          this.callbacks.onMessage(msg);
        }
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        this.callbacks.onError(`Invalid message: ${text}`);
      }
    };
  }

  disconnect(): void {
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendDevRegister(): void {
    if (!this.connected || this.ws === null) {
      throw new Error("Not connected");
    }
    this.ws.send(buildDevRegister());
  }
}
