import { BulkTransfer, utf8Bytes } from "./BulkTransfer";
import type { ManipulationState } from "../manipulation/ManipulationTypes";
import { CollaborationController } from "../replication/CollaborationController";
import type { InteractionState } from "../replication/CollaborationTypes";
import type { ClientTrackingOrigin, ClientTrackingOriginStore } from "../localization/clientTrackingOrigin";
import { LocalizationSubmission } from "../localization/localizationSubmission";
import {
  TextFramer,
  ProtocolDecodeError,
  encodeClientError,
  decodeLidar,
  decodeOutboundObject,
  encodeEstopRequest,
  encodeHelloRequest,
  encodeLocalizationObservations,
  encodeStateRequest,
} from "./protocol";
import { AR_MODULE_CLIENT_CONFIG, type ClientClock, type WebSocketTransport } from "./hostPorts";
import type {
  Capabilities,
  CapabilityName,
  Hello,
  Lidar,
  LocalizationObservationsRequest,
  LocalizationObservation,
  LocalizationResult,
  NavGoal,
  NavState,
  NavigationInputName,
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
  interaction?: InteractionState | null;
  connection: ConnectionPhase;
  hasTrackingOrigin: boolean;
  hasRetainedTrackingOrigin?: boolean;
  alignmentRequired?: boolean;
  hello: Hello | null;
  state: State | null;
  pose: Pose | null;
  nav_goal: NavGoal | null;
  nav_preview?: NavGoal | null;
  manipulation?: ManipulationState | null;
  manipulationError?: string | null;
  lidar: Lidar | null;
  capabilities: Capabilities | null;
  nav: NavState | null;
  agentMessage: string | null;
  agentMessageRevision: number;
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
type DeferredAsset = { value: Record<string, unknown>; deadline: number; stream: string | null; generation: number; connection: number };

export class ARModuleSession {
  readonly collaboration: CollaborationController;
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
  private resumeToken: string | undefined;
  private recoveryUntil = 0;
  private readonly pendingStreams = new Map<string, string>();
  private readonly pendingControl = new Map<string, string>();
  private decodeMaxMs = 0;
  private coalescedControl = 0;
  private state: State | null = null;
  private pose: Pose | null = null;
  private nav_goal: NavGoal | null = null;
  private nav_preview: NavGoal | null = null;
  private lidar: Lidar | null = null;
  private manipulation: ManipulationState | null = null;
  private agentMessage: string | null = null;
  private agentMessageRevision = 0;
  private lastError: string | null = null;
  private readonly decodeReports = new Map<string, { at: number; suppressed: number }>();
  private manipulationError: string | null = null;
  private helloDeadline: number | null = null;
  private reconnectAt: number | null = null;
  private pendingHelloTs: number | null = null;
  private closing = false;
  private alignmentRequired = false;
  private retainedOrigin: { reference: string; origin: ClientTrackingOrigin } | null = null;
  private readonly localizationSubmission = new LocalizationSubmission();
  private captureEpisodeId: string | null = null;
  private captureId: string | null = null;
  private readonly bulk: BulkTransfer;
  private readonly deferredAssets = new Map<string, DeferredAsset>();
  private readonly assetGenerations = new Map<string, number>();
  private assetConnection = 0;
  private traffic = { at: 0, up: 0, down: 0, maxUp: 0, maxDown: 0, dropped: 0 };
  private reportWindow = { at: 0, count: 0 };
  private uploadResultTimeout: number | null = null;
  private resultDeadline: number | null = null;
  private assetsDirty = false;

  constructor(deps: ARModuleSessionDependencies) {
    this.collaboration = new CollaborationController({ ready: () => this.phase === "ready",
      clientId: () => this.hello?.client_id ?? null, now: () => deps.clock.now(), send: text => this.sendText(text) });
    this.bulk = new BulkTransfer(deps.clock, () => this.bulkChanged(), data => this.applyLidar(data), reason => this.fail(reason));
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
    this.resumeToken = undefined;
    this.recoveryUntil = 0;
    this.retainedOrigin = null;
    this.alignmentRequired = false;
    this.wantConnected = false;
    this.reconnectAt = null;
    this.helloDeadline = null;
    this.pendingHelloTs = null;
    this.clearConnectionFacts();
    this.phase = "disconnected";
    this.closeTransport();
    this.emitView();
  }

  /** Retire in-flight results from an unknown reference-space reset while retaining the last estimate. */
  restartPreservingTrackingOrigin(): void {
    const retained = this.clientTrackingOriginStore.T_odom_client;
    this.stop(); this.start();
    if (retained) this.clientTrackingOriginStore.restore(retained);
    this.emitView();
  }

  diagnostics() { return { control: { ...this.traffic, decodeMaxMs: this.decodeMaxMs, coalesced: this.coalescedControl, pending: this.pendingControl.size }, bulk: this.bulk.diagnostics() }; }

  tick(): void {
    this.rollTraffic();
    const frameStart = this.clock.now();
    this.pumpControl(frameStart, .002);
    this.bulk.tick();
    if (this.phase === "ready") {
      for (const [key, text] of this.pendingStreams) {
        if (this.traffic.up + utf8Bytes(text) > 24576 || (this.transport.bufferedAmount?.() ?? 0) > 24576) break;
        this.pendingStreams.delete(key);
        this.traffic.up += utf8Bytes(text);
        this.transport.sendText(text);
      }
    }
    if (this.assetsDirty) this.retryAssets(frameStart);
    for (const [key, pending] of this.deferredAssets) {
      if (this.clock.now() >= pending.deadline) this.retireAssetReply(key, pending.value);
    }
    this.collaboration.tick();
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
    this.transport.sendText(encodeHelloRequest({ ts_client: tsClient, resume_token: this.resumeToken }));
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
    this.rollTraffic(); this.traffic.down += utf8Bytes(chunk);
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
      const type = /"type"\s*:\s*"([^"]+)"/.exec(line)?.[1];
      if (this.hello?.server_follow_stream && this.phase === "ready" &&
          ["state", "pose", "manipulation_state", "interaction_state"].includes(type ?? "")) {
        if (this.pendingControl.has(type!)) this.coalescedControl++;
        this.pendingControl.set(type!, line);
      } else {
        this.pumpControl(this.clock.now(), Infinity);
        this.dispatchText(line);
      }
    }
  }

  private pumpControl(start: number, budget: number): void {
    for (const [type, line] of this.pendingControl) {
      if (this.phase !== "ready" || this.clock.now() - start >= budget) break;
      this.pendingControl.delete(type);
      const before = this.clock.now();
      this.dispatchText(line);
      this.decodeMaxMs = Math.max(this.decodeMaxMs, (this.clock.now() - before) * 1000);
    }
  }

  onTransportBinary(_data: Uint8Array): void {
    if (this.phase !== "ready") {
      throw new Error("binary frame before hello");
    }
    this.fail("Binary payload on v3 control channel");
  }

  private applyLidar(data: Uint8Array): void {
    try {
      this.lidar = decodeLidar(data);
    } catch (error) {
      this.reportDecodeError(error, Array.from(data.slice(0, 64)).map(v => v.toString(16).padStart(2, "0")).join(""), "lidar");
      return;
    }
    this.emitOutbound(this.lidar);
    this.emitView();
  }

  sendText(text: string): void {
    if (this.phase !== "ready") {
      throw new Error("send requires a ready session");
    }
    const bytes = utf8Bytes(text);
    if (bytes > 16384) throw new Error("Control frame exceeds 16KiB");
    this.rollTraffic();
    const stream = /"(?:action)":"(?:update)"|"type":"client_pose"/.test(text);
    const value = stream ? JSON.parse(text) as { type: string; action?: string; group_id?: string } : null;
    const streamKey = value ? `${value.type}:${value.action ?? ""}:${value.group_id ?? ""}` : "";
    this.pendingStreams.delete(streamKey);
    if (stream && (this.traffic.up + bytes > 24576 || (this.transport.bufferedAmount?.() ?? 0) > 24576)) {
      this.traffic.dropped++;
      this.pendingStreams.set(streamKey, text);
      return;
    }
    this.traffic.up += bytes; this.transport.sendText(text);
  }
  private rollTraffic(): void {
    const now = this.clock.now();
    if (now - this.traffic.at >= 1) {
      this.traffic.maxUp = Math.max(this.traffic.maxUp, this.traffic.up);
      this.traffic.maxDown = Math.max(this.traffic.maxDown, this.traffic.down);
      this.traffic.at = now; this.traffic.up = this.traffic.down = 0;
    }
  }

  sendBinary(data: Uint8Array): void {
    if (this.phase !== "ready") {
      throw new Error("send requires a ready session");
    }
    if (!this.captureId) throw new Error("Localization upload requires a current capture request");
    this.bulk.uploadLocalization(data, this.captureId); this.bulk.tick();
  }

  submitLocalizationObservations(
    observations: LocalizationObservation[],
    timeoutS = AR_MODULE_CLIENT_CONFIG.capture.episode.resultTimeoutS,
  ): void {
    if (this.phase !== "ready" || this.hello === null) {
      throw new Error("localization submission requires a ready session");
    }
    const encoded = encodeLocalizationObservations(observations);
    const timestamp = Math.max(...observations.map((observation) => observation.ts_capture));
    const sync = this.hello.time_sync;
    this.localizationSubmission.begin(timestamp, sync.ts_server - sync.ts_client, this.clock.now(), timeoutS + 30);
    this.resultDeadline = this.clock.now() + timeoutS + 30; this.uploadResultTimeout = timeoutS;
    try {
      this.sendBinary(encoded);
    } catch (error) {
      this.localizationSubmission.cancel();
      throw error;
    }
  }

  localizationResultDeadline(): number | null { return this.resultDeadline; }

  assetTransferDeadline(requestId: string): number | null {
    return this.deferredAssets.get(requestId)?.deadline ?? null;
  }

  cancelLocalizationSubmission(): void {
    this.bulk.cancelUpload();
    this.uploadResultTimeout = this.resultDeadline = null;
    this.localizationSubmission.cancel();
  }

  requestEstop(): void {
    requireCapability(this, "estop");
    this.invalidateAssetStream("nav_goal:active");
    this.invalidateAssetStream("nav_goal:preview");
    this.invalidateAssetStream("manipulation_state");
    this.invalidateAssetStream("interaction_state");
    this.collaboration.cancel();
    this.sendText(encodeEstopRequest());
  }

  requestState(): void {
    this.sendText(encodeStateRequest());
  }

  view(): ARModuleSessionState {
    return {
      interaction: this.collaboration.raw(),
      connection: this.phase,
      hasTrackingOrigin: this.clientTrackingOriginStore.hasTrackingOrigin,
      ...(this.retainedOrigin ? { hasRetainedTrackingOrigin: true } : {}),
      ...(this.alignmentRequired ? { alignmentRequired: true } : {}),
      hello: this.hello,
      state: this.state,
      pose: this.pose,
      nav_goal: this.nav_goal,
      nav_preview: this.nav_preview,
      manipulation: this.manipulation,
      manipulationError: this.manipulationError,
      lidar: this.lidar,
      capabilities: this.hello?.capabilities ?? null,
      nav: this.state?.nav ?? null,
      agentMessage: this.agentMessage,
      agentMessageRevision: this.agentMessageRevision,
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
      const value = JSON.parse(line) as Record<string, unknown>;
      this.observeAssetFacts(value);
      const hydrated = this.bulk.hydrate(value);
      if (hydrated.unavailable && (value.type === "manipulation_result" || value.type === "nav_goal")) {
        this.retireAssetReply(String(value.request_id ?? value.preview_id ?? value.type), value); return;
      }
      if (hydrated.pending && (value.type === "manipulation_result" || value.type === "nav_goal" && value.preview)) {
        this.deferAssetReply(value, hydrated.deadline); return;
      }
      message = decodeOutboundObject(hydrated.value);
      if (message.type === "interaction_state") {
        const previous = this.collaboration.raw();
        if (previous && message.epoch === previous.epoch && message.revision <= previous.revision) return;
      }
      if (hydrated.pending) this.deferAssetReply(value, hydrated.deadline);
    } catch (error) {
      if (this.phase !== "ready") {
        this.fail(errorMessage(error));
        return;
      }
      this.reportDecodeError(error, line);
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
      if (this.retainedOrigin && message.odom_reference_id === this.retainedOrigin.reference) {
        this.clientTrackingOriginStore.restore(this.retainedOrigin.origin);
        this.alignmentRequired = false;
      }
      this.retainedOrigin = null;
      this.resumeToken = message.resume_token;
      this.recoveryUntil = 0;
      this.hello = message;
      this.pendingHelloTs = null;
      this.helloDeadline = null;
      this.phase = "ready";
      const sibling = this.transport.createSibling?.(message.bulk_url);
      if (sibling) { this.bulk.connect(sibling, message); this.bulk.tick(); }
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

  private bulkChanged(): void {
    if (this.uploadResultTimeout !== null && !this.bulk.uploading) {
      if (this.bulk.uploadResult()?.status === "accepted") {
        this.resultDeadline = this.clock.now() + this.uploadResultTimeout;
        this.localizationSubmission.extendDeadline(this.resultDeadline);
      } else {
        this.resultDeadline = null;
        this.localizationSubmission.cancel();
      }
      this.uploadResultTimeout = null;
    }
    this.assetsDirty = true;
  }

  private retryAssets(start: number): void {
    let count = 0;
    for (const [key, pending] of this.deferredAssets) {
      if (count++ >= 4 || this.clock.now() - start >= 0.002) break;
      this.deferredAssets.delete(key);
      if (!this.currentAssetReply(pending)) continue;
      try {
        const hydrated = this.bulk.hydrate(pending.value);
        if (hydrated.unavailable) { this.retireAssetReply(key, pending.value); continue; }
        if (hydrated.pending) {
          pending.deadline = hydrated.deadline ?? pending.deadline;
          this.deferredAssets.set(key, pending); continue;
        }
        this.deferredAssets.delete(key);
        const message = decodeOutboundObject(hydrated.value);
        if (message.type !== "hello" && this.currentAssetReply(pending)) this.applyReadyMessage(message, true);
      } catch (error) { this.deferredAssets.delete(key); this.reportDecodeError(error, "Bulk asset completion"); }
    }
    this.assetsDirty = this.deferredAssets.size > 0;
  }

  private assetStream(value: Record<string, unknown>): string | null {
    if (value.type === "nav_goal") return value.preview ? "nav_goal:preview" : "nav_goal:active";
    return value.type === "manipulation_state" || value.type === "interaction_state" ? value.type : null;
  }

  private deferAssetReply(value: Record<string, unknown>, deadline: number | null): void {
    const key = String(value.request_id ?? value.preview_id ?? value.type), stream = this.assetStream(value);
    if (!this.deferredAssets.has(key) && this.deferredAssets.size >= 64) throw new Error("Asset correlation budget exceeded");
    this.deferredAssets.set(key, { value, deadline: deadline ?? this.clock.now() + 120,
      stream, generation: stream ? this.assetGenerations.get(stream) ?? 0 : 0, connection: this.assetConnection });
    this.assetsDirty = true;
  }

  private invalidateAssetStream(stream: string): void {
    this.assetGenerations.set(stream, (this.assetGenerations.get(stream) ?? 0) + 1);
    for (const [key, pending] of this.deferredAssets) if (pending.stream === stream) this.deferredAssets.delete(key);
  }

  private currentAssetReply(pending: DeferredAsset): boolean {
    return pending.connection === this.assetConnection &&
      (pending.stream === null || pending.generation === this.assetGenerations.get(pending.stream));
  }

  private observeAssetFacts(value: Record<string, unknown>): void {
    const stream = this.assetStream(value);
    if (stream === "interaction_state") {
      const previous = this.collaboration.raw();
      if (previous && value.epoch === previous.epoch && Number(value.revision) <= previous.revision) return;
      if (previous && value.epoch !== previous.epoch) {
        this.invalidateAssetStream("nav_goal:active");
        this.invalidateAssetStream("nav_goal:preview");
        this.invalidateAssetStream("manipulation_state");
      } else {
        if (value.active_goal === null || !this.sameGoal(value.active_goal, this.nav_goal)) this.invalidateAssetStream("nav_goal:active");
        if (value.preview === null || !this.sameGoal(value.preview, this.nav_preview)) this.invalidateAssetStream("nav_goal:preview");
      }
    }
    if (stream) this.invalidateAssetStream(stream);
    // Native action results remain request-correlated across newer state snapshots.
    // A later result for the same request still supersedes its pending asset reply.
    if (value.request_id !== undefined) this.deferredAssets.delete(String(value.request_id));
  }

  private sameGoal(value: unknown, current: NavGoal | null): boolean {
    if (!value || typeof value !== "object" || !current) return value === null && current === null;
    const goal = value as Record<string, unknown>;
    return goal.ts === current.ts && goal.preview_id === current.preview_id && JSON.stringify(goal.pose) === JSON.stringify(current.pose);
  }

  private retireAssetReply(key: string, value: Record<string, unknown>): void {
    this.deferredAssets.delete(key);
    const detail = "Robot asset transfer unavailable";
    if (value.type === "manipulation_state" || value.type === "manipulation_result") this.manipulationError = detail;
    if (value.type === "manipulation_result") {
      const rejected = { ...value, status: "rejected", code: "asset_unavailable", message: detail };
      for (const field of ["plan_id", "plan_ref", "trajectory", "joint_names", "duration"]) delete (rejected as Record<string, unknown>)[field];
      this.applyReadyMessage(decodeOutboundObject(rejected) as Exclude<Outbound, Lidar | Hello>);
    } else if (value.type === "nav_goal") {
      const empty: Record<string, unknown> = { ...value, path_poses: [] };
      if (value.preview) delete empty.pose;
      this.applyReadyMessage(decodeOutboundObject(empty) as Exclude<Outbound, Lidar | Hello>);
    }
    this.emitView();
  }

  private applyReadyMessage(message: Exclude<Outbound, Lidar | Hello>, completedAssets = false): void {
    switch (message.type) {
      case "manipulation_state":
        this.manipulationError = null;
        this.manipulation = !message.available && this.manipulation ? { ...this.manipulation, available: false, message: message.message } : message;
        break;
      case "manipulation_result": this.emitOutbound(message); return;
      case "interaction_state":
        if (!(completedAssets ? this.collaboration.completeAssets(message) : this.collaboration.apply(message))) return;
        this.nav_goal = message.active_goal;
        this.nav_preview = message.preview;
        break;
      case "interaction_result":
        this.collaboration.accept(message);
        break;
      case "state":
        this.state = message;
        break;
      case "pose":
        this.pose = message;
        break;
      case "nav_goal":
        if (message.preview) this.nav_preview = message;
        else this.nav_goal = message;
        break;
      case "localization_context":
        if (message.odom_reference_id !== this.hello?.odom_reference_id) return;
        this.clientTrackingOriginStore.setMapContext(message, message.reset);
        if (!this.clientTrackingOriginStore.hasTrackingOrigin) this.alignmentRequired = true;
        break;
      case "localization_map_transform":
        if (message.odom_reference_id !== this.hello?.odom_reference_id) return;
        this.clientTrackingOriginStore.applyMapTransform(message);
        break;
      case "localization_status":
        if (!this.clientTrackingOriginStore.acceptsContext(message)) return;
        if (message.episode_id !== undefined) {
          if (message.episode_id !== this.captureEpisodeId) return;
          if (message.ts !== undefined && !this.localizationSubmission.accept(message.ts, this.clock.now())) return;
          this.cancelLocalizationSubmission();
          this.captureEpisodeId = null;
        }
        break;
      case "localization_result":
        if (!this.localizationSubmission.accept(message.ts, this.clock.now())) return;
        try {
          this.clientTrackingOriginStore.setFromLocalizationResult(message);
          this.alignmentRequired = false;
        } catch (error) {
          this.fail(errorMessage(error));
          return;
        }
        break;
      case "localization_observations_request":
        this.cancelLocalizationSubmission();
        this.captureEpisodeId = message.episode_id ?? null;
        this.captureId = message.capture_id ?? null;
        this.emitCaptureRequest(message);
        this.emitOutbound(message);
        this.emitView();
        return;
      case "agent_message":
        this.agentMessage = message.text;
        this.agentMessageRevision++;
        break;
      case "agent_skill":
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

  private reportDecodeError(error: unknown, excerpt: string, type = "unknown"): void {
    const context = error instanceof ProtocolDecodeError ? error.context : { message_type: type };
    const detail = errorMessage(error).slice(0, 1024);
    if (["unknown", "hello", "interaction_state", "interaction_result", "state", "nav_goal", "localization_context", "localization_map_transform", "localization_status"].includes(context.message_type)) {
      this.collaboration.cancel(); this.fail(`Invalid critical ${context.message_type}: ${detail}`); return;
    }
    if (context.message_type.startsWith("manipulation_") && this.manipulationError !== detail) {
      this.collaboration.cancel(["manipulation_planning", "manipulation_following"]);
      this.manipulationError = detail; this.emitView();
    }
    const now = this.clock.now(), key = `${context.message_type}:${detail}`;
    if (now - this.reportWindow.at >= 1) this.reportWindow = { at: now, count: 0 };
    if (this.reportWindow.count >= 4) return;
    const prior = this.decodeReports.get(key);
    if (prior && now - prior.at < 5) { prior.suppressed++; return; }
    this.decodeReports.delete(key);
    if (this.decodeReports.size >= 32) this.decodeReports.delete(this.decodeReports.keys().next().value!);
    this.decodeReports.set(key, { at: now, suppressed: 0 });
    this.reportWindow.count++;
    const sync = this.hello?.time_sync;
    try {
      this.transport.sendText(encodeClientError({ type: "client_error", ...context,
        message_type: context.message_type.slice(0, 128), detail, excerpt: (error instanceof ProtocolDecodeError ? error.excerpt ?? excerpt : excerpt).slice(0, 512),
        ts: now + (sync ? sync.ts_server - sync.ts_client : 0),
        ...(prior?.suppressed ? { suppressed_count: prior.suppressed } : {}) }));
    } catch { /* Transport notifications own actual connection failures. */ }
  }

  private enterConnecting(): void {
    if (this.recoveryUntil && this.clock.now() >= this.recoveryUntil) this.resumeToken = undefined;
    this.clearConnectionFacts(this.resumeToken !== undefined && this.clock.now() < this.recoveryUntil);
    this.phase = "connecting";
    this.emitView();
    this.transport.connect();
  }

  private fail(reason: string): void {
    if (this.phase === "disconnected" || this.phase === "failed") {
      return;
    }
    const origin = this.clientTrackingOriginStore.T_odom_client;
    if (origin) this.alignmentRequired = true;
    if (origin && this.hello?.odom_reference_id) this.retainedOrigin = { reference: this.hello.odom_reference_id, origin };
    this.lastError = reason;
    this.helloDeadline = null;
    this.pendingHelloTs = null;
    if (!this.recoveryUntil) this.recoveryUntil = this.clock.now() + 1;
    this.clearConnectionFacts(this.resumeToken !== undefined && this.clock.now() < this.recoveryUntil);
    this.phase = "failed";
    if (this.wantConnected) {
      this.reconnectAt = this.clock.now() + (this.resumeToken ? 0.05 : this.reconnectDelayS);
    }
    this.closeTransport();
    this.emitView();
  }

  private clearConnectionFacts(preserveInteraction = false): void {
    this.pendingStreams.clear();
    this.pendingControl.clear();
    this.captureId = null;
    this.assetConnection++; this.assetGenerations.clear();
    this.bulk.reset(); this.deferredAssets.clear(); this.uploadResultTimeout = this.resultDeadline = null;
    if (!preserveInteraction) this.collaboration.reset();
    if (!preserveInteraction) this.manipulation = null;
    this.captureEpisodeId = null;
    this.localizationSubmission.reset();
    if (!preserveInteraction) this.hello = null;
    this.state = null;
    this.pose = null;
    this.nav_goal = null;
    this.nav_preview = null;
    this.lidar = null;
    if (!preserveInteraction) this.manipulation = null;
    this.manipulationError = null;
    this.agentMessage = null;
    this.clientTrackingOriginStore.clear();
    this.framer = new TextFramer();
    this.decodeReports.clear();
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

export function requireCapability(session: Pick<ARModuleSession, "view">, name: CapabilityName): void {
  if (session.view().connection !== "ready") {
    throw new Error("send requires a ready session");
  }
  if (session.view().capabilities?.[name]?.available !== true) {
    throw new Error(`hello.capabilities.${name} is not available`);
  }
}

export function requireNavigation(session: Pick<ARModuleSession, "view">, name: NavigationInputName): void {
  requireCapability(session, "navigation");
  if (session.view().capabilities?.navigation?.[name]?.available !== true) {
    throw new Error(`hello.capabilities.navigation.${name} is not available`);
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
