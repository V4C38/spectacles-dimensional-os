import type { ClientTrackingOriginStore } from "../localization/clientTrackingOrigin";
import {
  TextFramer,
  decodeLidar,
  decodeOutbound,
  encodeEstopRequest,
  encodeHelloRequest,
  encodeStateRequest,
} from "./protocol";
import { AR_MODULE_CLIENT_CONFIG, type ClientClock, type WebSocketTransport } from "./hostPorts";
import type {
  Capabilities,
  CapabilityName,
  Hello,
  Lidar,
  LocalizationObservationsRequest,
  LocalizationResult,
  NavGoal,
  NavState,
  Outbound,
  Pose,
  State,
} from "./protocolTypes";

export type ConnectionPhase =
  | "disconnected"
  | "connecting"
  | "awaiting_hello"
  | "ready"
  | "failed";

export interface ARModuleSessionConfig {
  helloTimeoutS: number;
  reconnectDelayS: number;
}

export interface ARModuleSessionState {
  connection: ConnectionPhase;
  hasTrackingOrigin: boolean;
  hello: Hello | null;
  state: State | null;
  pose: Pose | null;
  nav_goal: NavGoal | null;
  lidar: Lidar | null;
  capabilities: Capabilities | null;
  nav: NavState | null;
  lastError: string | null;
}

export interface ARModuleSessionDependencies {
  transport: WebSocketTransport;
  clock: ClientClock;
  clientTrackingOriginStore: ClientTrackingOriginStore;
  config?: ARModuleSessionConfig;
}

type ViewListener = (view: ARModuleSessionState) => void;
type OutboundListener = (message: Outbound) => void;
type CaptureRequestListener = (request: LocalizationObservationsRequest) => void;

export class ARModuleSession {
  private readonly transport: WebSocketTransport;
  private readonly clock: ClientClock;
  private readonly clientTrackingOriginStore: ClientTrackingOriginStore;
  private readonly helloTimeoutS: number;
  private readonly reconnectDelayS: number;
  private readonly viewListeners: ViewListener[] = [];
  private readonly outboundListeners: OutboundListener[] = [];
  private readonly captureRequestListeners: CaptureRequestListener[] = [];

  private phase: ConnectionPhase = "disconnected";
  private wantConnected = false;
  private framer = new TextFramer();
  private hello: Hello | null = null;
  private state: State | null = null;
  private pose: Pose | null = null;
  private nav_goal: NavGoal | null = null;
  private lidar: Lidar | null = null;
  private lastError: string | null = null;
  private helloDeadline: number | null = null;
  private reconnectAt: number | null = null;
  private pendingHelloTs: number | null = null;
  private closing = false;

  constructor(deps: ARModuleSessionDependencies) {
    this.transport = deps.transport;
    this.clock = deps.clock;
    this.clientTrackingOriginStore = deps.clientTrackingOriginStore;
    const config = deps.config ?? AR_MODULE_CLIENT_CONFIG.session;
    this.helloTimeoutS = requirePositive(config.helloTimeoutS, "helloTimeoutS");
    this.reconnectDelayS = requireNonNegative(config.reconnectDelayS, "reconnectDelayS");
  }

  start(): void {
    if (this.wantConnected) {
      throw new Error("session is already started");
    }
    this.wantConnected = true;
    this.lastError = null;
    this.enterConnecting();
  }

  stop(): void {
    this.wantConnected = false;
    this.reconnectAt = null;
    this.helloDeadline = null;
    this.pendingHelloTs = null;
    this.clearConnectionFacts();
    this.phase = "disconnected";
    this.closeTransport();
    this.emitView();
  }

  tick(): void {
    const now = this.clock.now();
    if (this.phase === "awaiting_hello" && this.helloDeadline !== null && now >= this.helloDeadline) {
      this.fail("hello timeout");
      return;
    }
    if (
      this.phase === "failed" &&
      this.wantConnected &&
      this.reconnectAt !== null &&
      now >= this.reconnectAt
    ) {
      this.reconnectAt = null;
      this.lastError = null;
      this.enterConnecting();
    }
  }

  onTransportOpen(): void {
    if (this.phase !== "connecting") {
      throw new Error("unexpected transport open");
    }
    const tsClient = this.clock.now();
    this.framer = new TextFramer();
    this.phase = "awaiting_hello";
    this.pendingHelloTs = tsClient;
    this.helloDeadline = tsClient + this.helloTimeoutS;
    this.transport.sendText(encodeHelloRequest({ ts_client: tsClient }));
    this.emitView();
  }

  onTransportClose(): void {
    if (this.closing) {
      return;
    }
    if (this.phase === "connecting" || this.phase === "awaiting_hello" || this.phase === "ready") {
      this.fail("disconnected");
      return;
    }
    throw new Error("unexpected transport close");
  }

  onTransportText(chunk: string): void {
    if (this.phase !== "awaiting_hello" && this.phase !== "ready") {
      throw new Error("text frame before session is open");
    }
    let lines: string[];
    try {
      lines = this.framer.push(chunk);
    } catch (error) {
      this.fail(errorMessage(error));
      return;
    }
    for (const line of lines) {
      if (this.phase !== "awaiting_hello" && this.phase !== "ready") {
        return;
      }
      this.dispatchText(line);
    }
  }

  onTransportBinary(data: Uint8Array): void {
    if (this.phase !== "ready") {
      throw new Error("binary frame before hello");
    }
    try {
      this.lidar = decodeLidar(data);
    } catch (error) {
      this.fail(errorMessage(error));
      return;
    }
    this.emitOutbound(this.lidar);
    this.emitView();
  }

  sendText(text: string): void {
    if (this.phase !== "ready") {
      throw new Error("send requires a ready session");
    }
    this.transport.sendText(text);
  }

  sendBinary(data: Uint8Array): void {
    if (this.phase !== "ready") {
      throw new Error("send requires a ready session");
    }
    this.transport.sendBinary(data);
  }

  requestEstop(): void {
    requireCapability(this, "estop");
    this.sendText(encodeEstopRequest());
  }

  requestState(): void {
    this.sendText(encodeStateRequest());
  }

  view(): ARModuleSessionState {
    return {
      connection: this.phase,
      hasTrackingOrigin: this.clientTrackingOriginStore.hasTrackingOrigin,
      hello: this.hello,
      state: this.state,
      pose: this.pose,
      nav_goal: this.nav_goal,
      lidar: this.lidar,
      capabilities: this.hello?.capabilities ?? null,
      nav: this.state?.nav ?? null,
      lastError: this.lastError,
    };
  }

  subscribeView(listener: ViewListener): () => void {
    return addListener(this.viewListeners, listener);
  }

  subscribeOutbound(listener: OutboundListener): () => void {
    return addListener(this.outboundListeners, listener);
  }

  subscribeLocalizationObservationsRequest(listener: CaptureRequestListener): () => void {
    return addListener(this.captureRequestListeners, listener);
  }

  private dispatchText(line: string): void {
    let message: Exclude<Outbound, Lidar>;
    try {
      message = decodeOutbound(line);
    } catch (error) {
      this.fail(errorMessage(error));
      return;
    }

    if (this.phase === "awaiting_hello") {
      if (message.type !== "hello") {
        this.fail(`expected hello, got '${message.type}'`);
        return;
      }
      if (this.pendingHelloTs === null || message.time_sync.ts_client !== this.pendingHelloTs) {
        this.fail("hello.time_sync.ts_client must echo hello_request.ts_client");
        return;
      }
      this.hello = message;
      this.pendingHelloTs = null;
      this.helloDeadline = null;
      this.phase = "ready";
      this.emitOutbound(message);
      this.emitView();
      return;
    }

    if (message.type === "hello") {
      this.fail("unexpected hello after handshake");
      return;
    }
    this.applyReadyMessage(message);
  }

  private applyReadyMessage(message: Exclude<Outbound, Lidar | Hello>): void {
    switch (message.type) {
      case "state":
        this.state = message;
        break;
      case "pose":
        this.pose = message;
        break;
      case "nav_goal":
        this.nav_goal = message;
        break;
      case "localization_result":
        try {
          this.clientTrackingOriginStore.setFromLocalizationResult(message);
        } catch (error) {
          this.fail(errorMessage(error));
          return;
        }
        break;
      case "localization_observations_request":
        this.emitCaptureRequest(message);
        this.emitOutbound(message);
        this.emitView();
        return;
      default: {
        const exhaustive: never = message;
        this.fail(`unhandled outbound type: ${(exhaustive as LocalizationResult).type}`);
        return;
      }
    }
    this.emitOutbound(message);
    this.emitView();
  }

  private enterConnecting(): void {
    this.clearConnectionFacts();
    this.phase = "connecting";
    this.emitView();
    this.transport.connect();
  }

  private fail(reason: string): void {
    if (this.phase === "disconnected" || this.phase === "failed") {
      return;
    }
    this.lastError = reason;
    this.helloDeadline = null;
    this.pendingHelloTs = null;
    this.clearConnectionFacts();
    this.phase = "failed";
    if (this.wantConnected) {
      this.reconnectAt = this.clock.now() + this.reconnectDelayS;
    }
    this.closeTransport();
    this.emitView();
  }

  private clearConnectionFacts(): void {
    this.hello = null;
    this.state = null;
    this.pose = null;
    this.nav_goal = null;
    this.lidar = null;
    this.clientTrackingOriginStore.clear();
    this.framer = new TextFramer();
  }

  private closeTransport(): void {
    this.closing = true;
    try {
      this.transport.close();
    } finally {
      this.closing = false;
    }
  }

  private emitView(): void {
    const view = this.view();
    for (const listener of this.viewListeners) {
      listener(view);
    }
  }

  private emitOutbound(message: Outbound): void {
    for (const listener of this.outboundListeners) {
      listener(message);
    }
  }

  private emitCaptureRequest(request: LocalizationObservationsRequest): void {
    for (const listener of this.captureRequestListeners) {
      listener(request);
    }
  }
}

export function requireCapability(session: ARModuleSession, name: CapabilityName): void {
  if (session.view().connection !== "ready") {
    throw new Error("send requires a ready session");
  }
  if (session.view().capabilities?.[name]?.available !== true) {
    throw new Error(`hello.capabilities.${name} is not available`);
  }
}

function addListener<T>(listeners: T[], listener: T): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

function requirePositive(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number greater than 0`);
  }
  return value;
}

function requireNonNegative(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number >= 0`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
