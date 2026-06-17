import {
  AlignStatusMessage,
  CameraFrameAckMessage,
  BridgeStatusMessage,
  CapabilityState,
  HelloMessage,
  LidarMessage,
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  PoseCorrectionMessage,
  PoseMessage,
  buildAlignCommit,
  buildAlignManualPose,
  buildAlignStart,
  buildAlignStop,
  buildAssistConfirm,
  buildCancelGoal,
  buildEmergencyStop,
  buildGetStatus,
  buildSetLidarMode,
  buildNavGoal,
  buildPlanPath,
  isNonCriticalInboundMessageType,
  LidarObstacleSettings,
  parseInboundMessage,
  parseLidarBinary,
  ProtocolParseError,
  sniffInboundMessageType,
} from "./Protocol";
import { IP_STORAGE_KEY, WS_PORT } from "../UI/kit/UIKit";
import { Signal } from "../Core/SignalEmitter";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const PARSE_RECONNECT_THRESHOLD = 5;
const FRAGMENT_REASSEMBLY_MAX_BYTES = 1_048_576;
const SEND_DROP_LOG_INTERVAL_S = 1.0;
const ALIGN_POSE_TX_LOG_INTERVAL_S = 1.0;
// Diagnostic RX/TX prints fire per-frame/per-status; collapse the repetitive
// ones so the logs aren't flooded with thousands of identical lines.
const ALIGN_STATUS_RX_LOG_INTERVAL_S = 2.0;
const SEND_BINARY_LOG_INTERVAL_S = 2.0;
// Set to true to re-enable steady-state binary + RX noise for deep debugging.
const DEBUG_VERBOSE = false;

interface PendingBinaryFrame {
  blob: Blob;
  socket: WebSocket | null;
}

/** WebSocket client to the DimOS AR bridge; parses inbound messages and sends alignment/navigation commands. */
@component
export class BridgeClient extends BaseScriptComponent {
  /** Default Mac LAN IP when no IP is saved on device. */
  @input
  defaultBridgeIp: string = "192.168.1.166";

  @input
  internetModule: InternetModule;

  public baseUrl: string = "";

  public readonly onHello = new Signal<HelloMessage>();
  public readonly onLidar = new Signal<LidarMessage>();
  public readonly onPose = new Signal<PoseMessage>();
  public readonly onPoseCorrection = new Signal<PoseCorrectionMessage>();
  public readonly onAlignStatus = new Signal<AlignStatusMessage>();
  public readonly onCameraFrameAck = new Signal<CameraFrameAckMessage>();
  public readonly onBridgeStatus = new Signal<BridgeStatusMessage>();
  public readonly onPath = new Signal<PathMessage>();
  public readonly onPathPreview = new Signal<PathPreviewMessage>();
  public readonly onNavStatus = new Signal<NavStatusMessage>();
  public readonly onConnectionChanged = new Signal<boolean>();
  public readonly onProtocolError = new Signal<ProtocolParseError>();

  private ws: WebSocket | null = null;
  private isConnecting = false;
  private helloReceived = false;
  private _consecutiveParseFailures = 0;
  private _reconnectScheduled = false;
  private _fragmentBuffer: string | null = null;
  private _activeRobotId: string | null = null;
  private _lastSendDropLogTime = -1;
  private _lastAlignPoseTxLogTime = -1;
  private _lastAlignStatusRxLogTime = -1;
  private _poseRxCount = 0;
  private _lastPoseRxLogTime = -1;
  private _lastAlignStatusRxKey = "";
  private _lastSendBinaryLogTime = -1;
  private _lastBridgeStatusKey = "";
  private _lastNavStatusKey = "";
  private _capabilities: Record<string, CapabilityState> = {};
  private _messageRxCount = 0;
  public lastBridgeStatus: BridgeStatusMessage | null = null;
  private _pendingBinaryFrames: PendingBinaryFrame[] = [];
  private _binaryDecodeRunning = false;

  public get poseRxCount(): number {
    return this._poseRxCount;
  }

  public get messageRxCount(): number {
    return this._messageRxCount;
  }

  // BUG-2: cached timer events (created once in onAwake, re-armed per use).
  private _connectTimeoutEvent: DelayedCallbackEvent | null = null;
  private _helloTimeoutEvent: DelayedCallbackEvent | null = null;
  private _parseRecoveryEvent: DelayedCallbackEvent | null = null;
  private _pendingConnectReject: ((error: Error) => void) | null = null;
  private _pendingHelloFinish: ((ok: boolean) => void) | null = null;
  private _connectingSocket: WebSocket | null = null;

  onAwake() {
    const saved = this.loadIp();
    if (saved) {
      this.baseUrl = saved;
    } else if (this.defaultBridgeIp) {
      this.baseUrl = BridgeClient.normalizeIp(this.defaultBridgeIp);
    }

    // BUG-2: create all timer events once here and re-arm with reset() per use.
    const connectTimeout = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    connectTimeout.bind(() => {
      const socket = this._connectingSocket;
      if (!this.isConnecting || this.ws !== socket || socket === null) {
        return;
      }
      this.isConnecting = false;
      this._connectingSocket = null;
      this._detachSocketHandlers(socket);
      socket.close();
      this.ws = null;
      const rejectFn = this._pendingConnectReject;
      this._pendingConnectReject = null;
      rejectFn?.(new Error("WebSocket connection timeout"));
    });
    this._connectTimeoutEvent = connectTimeout;

    const helloTimeout = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    helloTimeout.bind(() => {
      const finish = this._pendingHelloFinish;
      if (finish === null) {
        return;
      }
      this._pendingHelloFinish = null;
      finish(false);
    });
    this._helloTimeoutEvent = helloTimeout;

    const parseRecovery = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    parseRecovery.bind(() => {
      this._reconnectScheduled = false;
      if (!this.baseUrl) {
        return;
      }
      this.disconnect();
      this.connect().catch((error) => {
        print(`BridgeClient: parse-recovery reconnect failed: ${error}`);
      });
    });
    this._parseRecoveryEvent = parseRecovery;
  }

  private get store(): GeneralDataStore {
    return global.persistentStorageSystem.store;
  }

  /** Strip protocol prefix, port, and trailing slashes to get a bare IP/hostname. */
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
    this.store.putString(IP_STORAGE_KEY, BridgeClient.normalizeIp(ip));
  }

  public loadIp(): string | null {
    if (this.store.has(IP_STORAGE_KEY)) {
      return BridgeClient.normalizeIp(this.store.getString(IP_STORAGE_KEY));
    }
    return null;
  }

  private deriveWsUrl(input: string): string {
    const host = BridgeClient.normalizeIp(input);
    return `ws://${host}:${WS_PORT}`;
  }

  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      return;
    }
    if (this.isConnecting) {
      return;
    }
    this.disconnect();
    this.isConnecting = true;

    const wsUrl = this.deriveWsUrl(this.baseUrl);
    print(`BridgeClient: connecting to ${wsUrl}`);

    return new Promise((resolve, reject) => {
      try {
        this.ws = this.internetModule.createWebSocket(wsUrl);
        // Spectacles only supports binaryType "blob"; arraybuffer is not available.
        this.ws.binaryType = "blob";
      } catch (error) {
        this.isConnecting = false;
        reject(new Error(`Failed to create WebSocket: ${error}`));
        return;
      }

      // BUG-1: capture socket identity so stale handlers from a timed-out
      // attempt cannot corrupt a subsequently opened socket's state.
      const socket = this.ws;
      // BUG-2: store socket so the cached timeout handler can identify it.
      this._connectingSocket = socket;
      this._pendingConnectReject = reject;

      socket.onopen = () => {
        if (this.ws !== socket) {
          return;
        }
        this.isConnecting = false;
        this._connectingSocket = null;
        print("BridgeClient: connected");
        resolve();
      };

      socket.onmessage = (event: WebSocketMessageEvent) => {
        if (this.ws !== socket) {
          return;
        }
        this._onMessage(event);
      };

      socket.onerror = () => {
        if (this.ws !== socket) {
          return;
        }
        this.isConnecting = false;
        this._notifyConnection(false);
        reject(new Error("WebSocket connection error"));
      };

      socket.onclose = (event: WebSocketCloseEvent) => {
        if (this.ws !== socket) {
          return;
        }
        print(`BridgeClient: socket closed code=${(event as unknown as { code?: number }).code ?? "?"} reason="${(event as unknown as { reason?: string }).reason ?? ""}"`);
        this.ws = null;
        this._fragmentBuffer = null;
        this._pendingBinaryFrames = [];
        this._binaryDecodeRunning = false;
        this.helloReceived = false;
        this._activeRobotId = null;
        this._capabilities = {};
        this.lastBridgeStatus = null;
        this._notifyConnection(false);
      };

      // BUG-2: rearm the single cached timeout event (no new event object).
      this._connectTimeoutEvent!.reset(5.0);
    });
  }

  public disconnect(): void {
    // BUG-5: only emit disconnected if there was something to tear down.
    // Idle retry attempts call disconnect() before every connect() even while
    // already disconnected — notifying listeners every 2 s is churn.
    const hadSocket = this.ws !== null || this.helloReceived;
    if (this.ws) {
      const socket = this.ws;
      this._detachSocketHandlers(socket);
      socket.close();
      this.ws = null;
    }
    this._fragmentBuffer = null;
    this._pendingBinaryFrames = [];
    this._binaryDecodeRunning = false;
    this.isConnecting = false;
    this.helloReceived = false;
    this._activeRobotId = null;
    this._capabilities = {};
    this.lastBridgeStatus = null;
    if (hadSocket) {
      this._notifyConnection(false);
    }
  }

  public get activeRobotId(): string | null {
    return this._activeRobotId;
  }

  public hasCapability(capability: string): boolean {
    return capability in this._capabilities;
  }

  public isCapabilityAvailable(capability: string): boolean {
    const state = this._capabilities[capability];
    return state ? state.available : true;
  }

  public requestStatus(): boolean {
    return this._sendForActiveRobot("get_status", buildGetStatus);
  }

  public sendLidarMode(
    mode: "off" | "obstacles" | "full",
    settings: LidarObstacleSettings,
  ): boolean {
    return this._sendForActiveRobot("set_lidar_mode", (robotId) =>
      buildSetLidarMode(robotId, mode, settings),
    );
  }

  public sendAlignStart(method: "tag" | "manual", assist: boolean = false): boolean {
    return this._sendForActiveRobot("align_start", (robotId) =>
      buildAlignStart(robotId, method, assist),
    );
  }

  public sendAssistConfirm(): boolean {
    return this._sendForActiveRobot("assist_confirm", buildAssistConfirm);
  }

  public sendAlignStop(): boolean {
    return this._sendForActiveRobot("align_stop", buildAlignStop);
  }

  public sendAlignCommit(): boolean {
    return this._sendForActiveRobot("align_commit", buildAlignCommit);
  }

  public sendAlignManualPose(position: vec3, rotation: quat): boolean {
    return this._sendForActiveRobot("align_manual_pose", (robotId) =>
      buildAlignManualPose(position, rotation, robotId),
    );
  }

  public sendNavGoal(position: vec3, rotation: quat): boolean {
    return this._sendForActiveRobot("nav_goal", (robotId) =>
      buildNavGoal(position, rotation, robotId),
    );
  }

  public sendPlanPath(position: vec3, rotation?: quat | null): boolean {
    return this._sendForActiveRobot("plan_path", (robotId) =>
      buildPlanPath(position, robotId, rotation),
    );
  }

  public sendCancelGoal(): boolean {
    return this._sendForActiveRobot("cancel_goal", buildCancelGoal);
  }

  public sendEmergencyStop(): boolean {
    return this._sendForActiveRobot("emergency_stop", buildEmergencyStop);
  }

  /** Wait for server `hello` after the socket is open (bridge sends it on connect). */
  public waitForHello(timeoutSeconds: number = 3.0): Promise<boolean> {
    if (this.helloReceived) {
      return Promise.resolve(true);
    }
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let settled = false;
      let unsub: (() => void) | null = null;
      const finish = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        this._pendingHelloFinish = null;
        unsub?.();
        resolve(ok);
      };
      unsub = this.onHello.add(() => finish(true));
      // BUG-2: rearm the single cached hello timeout (no new event object per call).
      this._pendingHelloFinish = (ok: boolean) => finish(ok);
      this._helloTimeoutEvent!.reset(timeoutSeconds);
    });
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN && this.helloReceived;
  }

  public send(text: string): boolean {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(text);
      return true;
    }
    const now = getTime();
    if (now - this._lastSendDropLogTime >= SEND_DROP_LOG_INTERVAL_S) {
      this._lastSendDropLogTime = now;
      print(
        `BridgeClient: send dropped — socket not open (readyState=${this.ws ? this.ws.readyState : "null"})`,
      );
    }
    return false;
  }

  public sendBinary(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      if (DEBUG_VERBOSE) {
        const now = getTime();
        if (now - this._lastSendBinaryLogTime >= SEND_BINARY_LOG_INTERVAL_S) {
          this._lastSendBinaryLogTime = now;
          print(`BridgeClient: sendBinary bytes=${bytes.byteLength} readyState=${this.ws.readyState}`);
        }
      }
      this.ws.send(bytes);
    } else {
      print(`BridgeClient: sendBinary skipped — not open (readyState=${this.ws ? this.ws.readyState : "null"})`);
    }
  }

  private _onMessage(event: WebSocketMessageEvent): void {
    this._messageRxCount++;
    // Spectacles delivers binary WebSocket frames as Blob (arraybuffer unsupported).
    if (event.data instanceof Blob) {
      this._pendingBinaryFrames.push({
        blob: event.data,
        socket: this.ws,
      });
      this._pumpBinaryFrames();
      return;
    }
    if (typeof event.data !== "string") {
      return;
    }
    const lines = this._accumulateTextFrames(event.data);
    for (const line of lines) {
      this._dispatchTextMessage(line);
    }
  }

  private async _pumpBinaryFrames(): Promise<void> {
    if (this._binaryDecodeRunning) {
      return;
    }
    this._binaryDecodeRunning = true;
    try {
      while (this._pendingBinaryFrames.length > 0) {
        const frame = this._pendingBinaryFrames.shift();
        if (!frame) {
          continue;
        }
        try {
          const bytes = await frame.blob.bytes();
          if (this.ws !== frame.socket) {
            continue;
          }
          const msg = parseLidarBinary(bytes, this._activeRobotId ?? "");
          if (msg) {
            this.onLidar.emit(msg);
          }
        } catch (e: unknown) {
          print(`BridgeClient: binary frame decode failed: ${e}`);
        }
      }
    } finally {
      this._binaryDecodeRunning = false;
      if (this._pendingBinaryFrames.length > 0) {
        this._pumpBinaryFrames();
      }
    }
  }

  private _dispatchTextMessage(payload: string): void {
    try {
      const msg = parseInboundMessage(payload);
      this._consecutiveParseFailures = 0;
      if (!msg) {
        return;
      }
      switch (msg.type) {
        case "hello":
          this.helloReceived = true;
          this._capabilities = msg.capabilities;
          this._adoptRobotId(msg.robot.robot_id);
          this._notifyConnection(true);
          this.onHello.emit(msg);
          break;
        case "lidar":
          this._adoptRobotId(msg.robot_id);
          this.onLidar.emit(msg);
          break;
        case "pose":
          this._adoptRobotId(msg.robot_id);
          this._logPoseRx(msg);
          this.onPose.emit(msg);
          break;
        case "pose_correction":
          this._adoptRobotId(msg.robot_id);
          this.onPoseCorrection.emit(msg);
          break;
        case "align_status":
          this._adoptRobotId(msg.robot_id);
          this._logDiagnosticRx(msg);
          this.onAlignStatus.emit(msg);
          break;
        case "camera_frame_ack":
          this._adoptRobotId(msg.robot_id);
          this._logDiagnosticRx(msg);
          this.onCameraFrameAck.emit(msg);
          break;
        case "bridge_status":
          this._adoptRobotId(msg.robot_id);
          this.lastBridgeStatus = msg;
          this._logDiagnosticRx(msg);
          this.onBridgeStatus.emit(msg);
          break;
        case "path":
          this._adoptRobotId(msg.robot_id);
          this.onPath.emit(msg);
          break;
        case "path_preview":
          this._adoptRobotId(msg.robot_id);
          this.onPathPreview.emit(msg);
          break;
        case "nav_status":
          this._adoptRobotId(msg.robot_id);
          this._logDiagnosticRx(msg);
          this.onNavStatus.emit(msg);
          break;
      }
    } catch (error) {
      this._handleParseFailure(payload, error);
    }
  }

  /**
   * Bridge text frames are newline-delimited (see PROTOCOL.md). Accumulate
   * partial callbacks and return every complete line for dispatch.
   */
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

  private _handleParseFailure(raw: string, error: unknown): void {
    const sniffed = sniffInboundMessageType(raw);
    const parseError =
      error instanceof ProtocolParseError
        ? error
        : new ProtocolParseError(
            "json",
            sniffed,
            error instanceof Error ? error.message : String(error),
          );

    const nonCritical =
      isNonCriticalInboundMessageType(parseError.messageType) ||
      (parseError.kind === "json" &&
        isNonCriticalInboundMessageType(sniffed));

    if (parseError.kind === "json") {
      // Newline framing recovers complete messages; resync would resend large paths.
      return;
    }

    if (nonCritical) {
      return;
    }

    this._consecutiveParseFailures += 1;
    this.onProtocolError.emit(parseError);

    print(
      `BridgeClient: protocol ${parseError.kind} error on ${parseError.messageType ?? sniffed ?? "unknown"} (${this._consecutiveParseFailures}); len=${raw.length}; first="${this._snippet(raw, 0)}" last="${this._snippet(raw, Math.max(0, raw.length - 80))}"`,
    );

    if (this._consecutiveParseFailures >= PARSE_RECONNECT_THRESHOLD) {
      print(
        `BridgeClient: ${this._consecutiveParseFailures} consecutive parse failures; reconnecting`,
      );
      this._scheduleReconnectAfterParseFailures();
      return;
    }
  }

  private _scheduleReconnectAfterParseFailures(): void {
    if (this._reconnectScheduled) {
      return;
    }
    this._reconnectScheduled = true;
    this._consecutiveParseFailures = 0;
    // BUG-2: rearm the single cached parse-recovery event (no new event object).
    this._parseRecoveryEvent!.reset(0.5);
  }

  private _notifyConnection(connected: boolean): void {
    this.onConnectionChanged.emit(connected);
  }

  /**
   * Lens Studio expects WebSocket callbacks to stay function-typed.
   * Use no-op handlers when cancelling a pending connection.
   */
  private _detachSocketHandlers(socket: WebSocket): void {
    socket.onopen = () => {};
    socket.onmessage = () => {};
    socket.onerror = () => {};
    socket.onclose = () => {};
  }

  private _adoptRobotId(robotId: string | null): void {
    if (!robotId) {
      return;
    }
    this._activeRobotId = robotId;
  }

  private _requireRobotId(action: string): string | null {
    const robotId = this._activeRobotId;
    if (!robotId) {
      print(`BridgeClient: cannot send ${action} before hello negotiates robot_id`);
      return null;
    }
    return robotId;
  }

  private _sendForActiveRobot(
    action: string,
    build: (robotId: string) => string,
  ): boolean {
    const robotId = this._requireRobotId(action);
    if (!robotId) {
      return false;
    }
    const payload = build(robotId);
    const sent = this.send(payload);
    if (action.startsWith("align")) {
      if (action === "align_manual_pose") {
        const now = getTime();
        if (now - this._lastAlignPoseTxLogTime >= ALIGN_POSE_TX_LOG_INTERVAL_S) {
          this._lastAlignPoseTxLogTime = now;
          print(
            `BridgeClient: ${action} TX robot=${robotId} bytes=${payload.length} sent=${sent}`,
          );
        }
      } else {
        print(
          `BridgeClient: ${action} TX robot=${robotId} bytes=${payload.length} sent=${sent}`,
        );
      }
    }
    return sent;
  }

  private _snippet(text: string, start: number): string {
    return text
      .substring(start, Math.min(text.length, start + 80))
      .replace("\n", "\\n")
      .replace("\r", "\\r");
  }

  private _logPoseRx(msg: PoseMessage): void {
    const POSE_LOG_INTERVAL_S = 30;
    this._poseRxCount++;
    const now = getTime();
    if (this._poseRxCount === 1 || now - this._lastPoseRxLogTime >= POSE_LOG_INTERVAL_S) {
      this._lastPoseRxLogTime = now;
      const pos = msg.position;
      print(
        `BridgeClient: RX pose #${this._poseRxCount}` +
          ` pos=(${pos[0].toFixed(2)},${pos[1].toFixed(2)},${pos[2].toFixed(2)})`,
      );
    }
  }

  private _logDiagnosticRx(
    msg: AlignStatusMessage | CameraFrameAckMessage | BridgeStatusMessage | NavStatusMessage,
  ): void {
    switch (msg.type) {
      case "align_status":
        // SetupWizard / CalibrationFlow already log every align_status change;
        // skip the duplicate print here.
        break;
      case "camera_frame_ack":
        // Per-frame ack — silent in the normal path; FrameCaptureController
        // logs mismatches.
        break;
      case "bridge_status": {
        const key = `${msg.registered}|${msg.robot_connected}|${msg.registration_method ?? "-"}`;
        if (key !== this._lastBridgeStatusKey) {
          this._lastBridgeStatusKey = key;
          print(
            `BridgeClient: RX bridge_status registered=${msg.registered} robot_connected=${msg.robot_connected}`,
          );
        }
        break;
      }
      case "nav_status": {
        const key = `${msg.state}|${msg.goal_reached}|${msg.goal_failed}|${msg.error_code ?? "-"}`;
        if (key !== this._lastNavStatusKey) {
          this._lastNavStatusKey = key;
          print(
            `BridgeClient: RX nav_status state=${msg.state} goal_reached=${msg.goal_reached} goal_failed=${msg.goal_failed} error_code=${msg.error_code ?? "-"}`,
          );
        }
        break;
      }
    }
  }
}
