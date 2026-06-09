import {
  AlignStatusMessage,
  BridgeStatusMessage,
  HelloMessage,
  LidarMessage,
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  PoseMessage,
  clearActiveRobotId,
  getActiveRobotId,
  setActiveRobotId,
} from "./ProtocolTypes";
import {
  buildAlignMarker,
  buildAlignCommit,
  buildAlignManualPose,
  buildAlignStart,
  buildAlignStop,
  buildCancelGoal,
  buildEmergencyStop,
  buildGetStatus,
  buildNavGoal,
  buildPlanPath,
  emit,
  isNonCriticalInboundMessageType,
  parseInboundMessage,
  ProtocolParseError,
  sniffInboundMessageType,
} from "./Protocol";
import { IP_STORAGE_KEY, WS_PORT } from "../UI/Shared/UICore";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const PARSE_RECOVERY_COOLDOWN_S = 2.0;
const PARSE_RECONNECT_THRESHOLD = 5;

// ================================================================
// WebSocket client to the DimOS AR bridge; parses inbound messages and sends alignment/navigation commands.
// ================================================================
/** WebSocket client to the DimOS AR bridge; parses inbound messages and sends alignment/navigation commands. */
@component
export class BridgeClient extends BaseScriptComponent {
  /** Default Mac LAN IP when no IP is saved on device. */
  @input
  defaultBridgeIp: string = "192.168.1.166";

  @input
  internetModule: InternetModule;

  public baseUrl: string = "";

  public onHello: ((msg: HelloMessage) => void)[] = [];
  public onLidar: ((msg: LidarMessage) => void)[] = [];
  public onPose: ((msg: PoseMessage) => void)[] = [];
  public onAlignStatus: ((msg: AlignStatusMessage) => void)[] = [];
  public onBridgeStatus: ((msg: BridgeStatusMessage) => void)[] = [];
  public onPath: ((msg: PathMessage) => void)[] = [];
  public onPathPreview: ((msg: PathPreviewMessage) => void)[] = [];
  public onNavStatus: ((msg: NavStatusMessage) => void)[] = [];
  public onConnectionChanged: ((connected: boolean) => void)[] = [];
  public onProtocolError: ((error: ProtocolParseError) => void)[] = [];

  private ws: WebSocket | null = null;
  private isConnecting = false;
  private helloReceived = false;
  private _consecutiveParseFailures = 0;
  private _lastParseRecoveryRequestTime = -PARSE_RECOVERY_COOLDOWN_S;
  private _reconnectScheduled = false;
  private _activeRobotId: string | null = null;
  private _helloCapabilities: string[] = [];
  private _capabilityStates: Record<string, { available: boolean; reason?: string }> =
    {};
  public lastHello: HelloMessage | null = null;
  public lastBridgeStatus: BridgeStatusMessage | null = null;

  /** Lens Studio may not run field initializers before other scripts read these arrays. */
  public ensureEventHandlers(): void {
    if (!this.onHello) {
      this.onHello = [];
    }
    if (!this.onLidar) {
      this.onLidar = [];
    }
    if (!this.onPose) {
      this.onPose = [];
    }
    if (!this.onAlignStatus) {
      this.onAlignStatus = [];
    }
    if (!this.onConnectionChanged) {
      this.onConnectionChanged = [];
    }
    if (!this.onBridgeStatus) {
      this.onBridgeStatus = [];
    }
    if (!this.onPath) {
      this.onPath = [];
    }
    if (!this.onPathPreview) {
      this.onPathPreview = [];
    }
    if (!this.onNavStatus) {
      this.onNavStatus = [];
    }
    if (!this.onProtocolError) {
      this.onProtocolError = [];
    }
  }

  onAwake() {
    this.ensureEventHandlers();
    const saved = this.loadIp();
    if (saved) {
      this.baseUrl = saved;
    } else if (this.defaultBridgeIp) {
      this.baseUrl = BridgeClient.normalizeIp(this.defaultBridgeIp);
    }
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
      } catch (error) {
        this.isConnecting = false;
        reject(new Error(`Failed to create WebSocket: ${error}`));
        return;
      }

      this.ws.onopen = () => {
        this.isConnecting = false;
        print("BridgeClient: connected");
        resolve();
      };

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
        this._onMessage(event);
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        this._notifyConnection(false);
        reject(new Error("WebSocket connection error"));
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.helloReceived = false;
        this._activeRobotId = null;
        this._helloCapabilities = [];
        this._capabilityStates = {};
        this.lastHello = null;
        clearActiveRobotId();
        this.lastBridgeStatus = null;
        this._notifyConnection(false);
      };

      const timeout = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      timeout.bind(() => {
        if (this.isConnecting) {
          this.isConnecting = false;
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
          reject(new Error("WebSocket connection timeout"));
        }
      });
      timeout.reset(5.0);
    });
  }

  public disconnect(): void {
    if (this.ws) {
      const socket = this.ws;
      this._detachSocketHandlers(socket);
      socket.close();
      this.ws = null;
    }
    this.isConnecting = false;
    this.helloReceived = false;
    this._activeRobotId = null;
    this._helloCapabilities = [];
    this._capabilityStates = {};
    this.lastHello = null;
    clearActiveRobotId();
    this.lastBridgeStatus = null;
    this._notifyConnection(false);
  }

  public get activeRobotId(): string | null {
    return this._activeRobotId;
  }

  public get negotiatedCapabilities(): string[] {
    return this._helloCapabilities.slice();
  }

  public hasCapability(capability: string): boolean {
    return this._helloCapabilities.indexOf(capability) >= 0;
  }

  public isCapabilityAvailable(capability: string): boolean {
    if (!this.hasCapability(capability)) {
      return false;
    }
    const state = this._capabilityStates[capability];
    return state ? state.available : true;
  }

  public capabilityUnavailableReason(capability: string): string | null {
    const state = this._capabilityStates[capability];
    if (!state || state.available) {
      return null;
    }
    return state.reason ?? null;
  }

  public requestStatus(): boolean {
    return this._sendForActiveRobot("get_status", buildGetStatus);
  }

  public sendAlignStart(): boolean {
    return this._sendForActiveRobot("align_start", buildAlignStart);
  }

  public sendAlignStop(): boolean {
    return this._sendForActiveRobot("align_stop", buildAlignStop);
  }

  public sendAlignCommit(): boolean {
    return this._sendForActiveRobot("align_commit", buildAlignCommit);
  }

  public sendAlignMarker(position: vec3, rotation: quat): boolean {
    return this._sendForActiveRobot("align_marker", (robotId) =>
      buildAlignMarker(position, rotation, robotId),
    );
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
      const finish = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        const idx = this.onHello.indexOf(onHello);
        if (idx >= 0) {
          this.onHello.splice(idx, 1);
        }
        resolve(ok);
      };
      const onHello = () => finish(true);
      this.ensureEventHandlers();
      this.onHello.push(onHello);
      const timeout = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      timeout.bind(() => finish(false));
      timeout.reset(timeoutSeconds);
    });
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN && this.helloReceived;
  }

  public send(text: string): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(text);
    }
  }

  private _onMessage(event: WebSocketMessageEvent): void {
    this.ensureEventHandlers();
    const raw = event.data as string;
    try {
      const msg = parseInboundMessage(raw);
      this._consecutiveParseFailures = 0;
      if (!msg) {
        return;
      }
      switch (msg.type) {
        case "hello":
          this.helloReceived = true;
          this.lastHello = msg;
          this._helloCapabilities = msg.capabilities.slice();
          this._capabilityStates = msg.capability_states;
          this._adoptRobotId(msg.robot.robot_id);
          this._notifyConnection(true);
          emit(this.onHello, msg);
          break;
        case "lidar":
          this._adoptRobotId(msg.robot_id);
          emit(this.onLidar, msg);
          break;
        case "pose":
          this._adoptRobotId(msg.robot_id);
          emit(this.onPose, msg);
          break;
        case "align_status":
          this._adoptRobotId(msg.robot_id);
          emit(this.onAlignStatus, msg);
          break;
        case "bridge_status":
          this._adoptRobotId(msg.robot_id);
          this.lastBridgeStatus = msg;
          emit(this.onBridgeStatus, msg);
          break;
        case "path":
          this._adoptRobotId(msg.robot_id);
          emit(this.onPath, msg);
          break;
        case "path_preview":
          this._adoptRobotId(msg.robot_id);
          emit(this.onPathPreview, msg);
          break;
        case "nav_status":
          this._adoptRobotId(msg.robot_id);
          emit(this.onNavStatus, msg);
          break;
      }
    } catch (error) {
      this._handleParseFailure(raw, error);
    }
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
    this._consecutiveParseFailures += 1;
    emit(this.onProtocolError, parseError);

    const nonCritical =
      isNonCriticalInboundMessageType(parseError.messageType) ||
      (parseError.kind === "json" &&
        isNonCriticalInboundMessageType(sniffed));

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

    if (nonCritical && this._consecutiveParseFailures === 1) {
      return;
    }

    const now = getTime();
    if (now - this._lastParseRecoveryRequestTime >= PARSE_RECOVERY_COOLDOWN_S) {
      this._lastParseRecoveryRequestTime = now;
      this.requestStatus();
    }
  }

  private _scheduleReconnectAfterParseFailures(): void {
    if (this._reconnectScheduled) {
      return;
    }
    this._reconnectScheduled = true;
    this._consecutiveParseFailures = 0;
    const timeout = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    timeout.bind(() => {
      this._reconnectScheduled = false;
      if (!this.baseUrl) {
        return;
      }
      this.disconnect();
      this.connect().catch((error) => {
        print(`BridgeClient: parse-recovery reconnect failed: ${error}`);
      });
    });
    timeout.reset(0.5);
  }

  private _notifyConnection(connected: boolean): void {
    emit(this.onConnectionChanged, connected);
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
    if (getActiveRobotId() !== robotId) {
      setActiveRobotId(robotId);
    }
  }

  private _requireRobotId(action: string): string | null {
    const robotId = this._activeRobotId ?? getActiveRobotId();
    if (!robotId) {
      print(`BridgeClient: cannot send ${action} before hello negotiates robot_id`);
      return null;
    }
    this._activeRobotId = robotId;
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
    this.send(build(robotId));
    return true;
  }

  private _snippet(text: string, start: number): string {
    return text
      .substring(start, Math.min(text.length, start + 80))
      .replace("\n", "\\n")
      .replace("\r", "\\r");
  }
}
