import {
  RegistrationStatusMessage,
  CameraFrameAckMessage,
  BridgeStatusMessage,
  HelloMessage,
  LidarMessage,
  NavStatusMessage,
  PathMessage,
  PongMessage,
  WorldFrameCorrectionMessage,
  PoseMessage,
  RuntimeSnapshotMessage,
  buildRegistrationCommand,
  buildRegistrationPose,
  buildCancelGoal,
  buildEmergencyStop,
  buildGetStatus,
  buildSetLidarMode,
  buildNavigateGoal,
  buildPreviewGoal,
  LidarObstacleSettings,
  ProtocolParseError,
  RegistrationCommandAction,
  RegistrationMode,
} from "./Protocol";
import {
  BridgeConnectionManager,
  ClockSyncState,
} from "./BridgeConnectionManager";
import { BridgeInboundProcessor } from "./BridgeInboundProcessor";
import { Signal } from "../Core/Utilities";

const SEND_DROP_LOG_INTERVAL_S = 1.0;
const REGISTRATION_POSE_TX_LOG_INTERVAL_S = 1.0;
const SEND_BINARY_LOG_INTERVAL_S = 2.0;
const HELLO_TIMEOUT_S = 5.0;
const DEBUG_VERBOSE = false;

/**
 * Wire/session owner: WebSocket transport, hello handshake, inbound decode,
 * clock sync, and outbound commands. App code connects via tryConnect(ip).
 */
@component
export class BridgeClient extends BaseScriptComponent {
  /** Default Mac LAN IP when no IP is saved on device. */
  @input
  defaultBridgeIp: string = "192.168.1.62";

  @input
  internetModule: InternetModule;

  public baseUrl: string = "";

  private _connection: BridgeConnectionManager | null = null;
  private _inbound: BridgeInboundProcessor | null = null;
  private _lastSendDropLogTime = -1;
  private _lastAlignPoseTxLogTime = -1;
  private _lastSendBinaryLogTime = -1;
  private _parseRecoveryEvent: DelayedCallbackEvent | null = null;
  private _connectInFlight: Promise<boolean> | null = null;
  private _connectInFlightIp: string | null = null;
  private _connectAttemptId = 0;
  private _lastRegistrationCommandLogAction = "";

  public get onHello(): Signal<HelloMessage> {
    return this._inbound!.onHello;
  }
  public get onLidar(): Signal<LidarMessage> {
    return this._inbound!.onLidar;
  }
  public get onPose(): Signal<PoseMessage> {
    return this._inbound!.onPose;
  }
  public get onWorldFrameCorrection(): Signal<WorldFrameCorrectionMessage> {
    return this._inbound!.onWorldFrameCorrection;
  }
  public get onRegistrationStatus(): Signal<RegistrationStatusMessage> {
    return this._inbound!.onRegistrationStatus;
  }
  public get onCameraFrameAck(): Signal<CameraFrameAckMessage> {
    return this._inbound!.onCameraFrameAck;
  }
  public get onBridgeStatus(): Signal<BridgeStatusMessage> {
    return this._inbound!.onBridgeStatus;
  }
  public get onPath(): Signal<PathMessage> {
    return this._inbound!.onPath;
  }
  public get onNavStatus(): Signal<NavStatusMessage> {
    return this._inbound!.onNavStatus;
  }
  public get onRuntimeSnapshot(): Signal<RuntimeSnapshotMessage> {
    return this._inbound!.onRuntimeSnapshot;
  }
  public get onPong(): Signal<PongMessage> {
    return this._inbound!.onPong;
  }
  public readonly onConnectionChanged = new Signal<boolean>();
  public get onProtocolError(): Signal<ProtocolParseError> {
    return this._inbound!.onProtocolError;
  }
  public get onClockSyncStateChanged(): Signal<ClockSyncState> {
    return this._connection!.onClockSyncStateChanged;
  }

  public get lastBridgeStatus(): BridgeStatusMessage | null {
    return this._inbound?.lastBridgeStatus ?? null;
  }

  public get poseRxCount(): number {
    return this._inbound?.poseRxCount ?? 0;
  }

  public get messageRxCount(): number {
    return this._inbound?.messageRxCount ?? 0;
  }

  public get isClockSyncReady(): boolean {
    return this._connection?.isClockSyncReady ?? false;
  }

  public get clockSyncState(): ClockSyncState {
    return this._connection?.clockSyncState ?? "idle";
  }

  public mapCaptureTime(lensTs: number): number {
    return this._connection!.mapCaptureTime(lensTs);
  }

  onAwake() {
    this._connection = new BridgeConnectionManager(this.internetModule, this);
    const saved = this._connection.loadIp();
    if (saved) {
      this.baseUrl = saved;
    } else if (this.defaultBridgeIp) {
      this.baseUrl = BridgeClient.normalizeIp(this.defaultBridgeIp);
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
        print(`BridgeClient: parse-recovery reconnect failed: ${error}`);
      });
    });
    this._parseRecoveryEvent = parseRecovery;

    this._inbound = new BridgeInboundProcessor(this, this._connection, {
      onHelloConnection: (connected) => this._notifyConnection(connected),
      onSocketClosed: () => this._notifyConnection(false),
      scheduleParseRecoveryReconnect: () => this._parseRecoveryEvent!.reset(0.5),
    });

    this._connection.wireClockSync(this._inbound);
  }

  /** Strip protocol prefix, port, and trailing slashes to get a bare IP/hostname. */
  public static normalizeIp(raw: string): string {
    return BridgeConnectionManager.normalizeIp(raw);
  }

  public saveIp(ip: string): void {
    this._connection?.saveIp(ip);
  }

  public loadIp(): string | null {
    return this._connection?.loadIp() ?? null;
  }

  public clearIp(): void {
    this._connection?.clearIp();
  }

  public isSocketOpen(): boolean {
    return this._connection?.isSocketOpen() ?? false;
  }

  /**
   * Connect to the bridge at `ip` (WS open + v7 hello + requestStatus).
   * Concurrent calls with the same IP await one in-flight attempt; a different
   * IP cancels the prior attempt.
   */
  public tryConnect(ip: string): Promise<boolean> {
    const normalized = BridgeClient.normalizeIp(ip);
    if (!normalized) {
      print("BridgeClient: tryConnect failed — empty IP");
      return Promise.resolve(false);
    }

    if (this._connectInFlight && this._connectInFlightIp === normalized) {
      return this._connectInFlight;
    }

    this._connectAttemptId += 1;
    if (this._connectInFlight) {
      if (this._connection?.isConnecting) {
        this._connection.cancelConnect();
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
      this._connection?.isSocketOpen() || (this._inbound?.helloReceived ?? false);
    this._connection?.disconnect(false);
    this._inbound?.resetSessionState();
    if (hadSocket) {
      this._notifyConnection(false);
    }
  }

  public get activeRobotId(): string | null {
    return this._inbound?.activeRobotId ?? null;
  }

  /** @deprecated Prefer robotRuntime.capabilities from app state after hello. */
  public hasCapability(capability: string): boolean {
    return this._inbound?.hasCapability(capability) ?? false;
  }

  public isCapabilityAvailable(capability: string): boolean {
    return this._inbound?.isCapabilityAvailable(capability) ?? true;
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

  public sendRegistrationCommand(
    command: RegistrationCommandAction,
    mode?: RegistrationMode,
  ): boolean {
    const action = mode !== undefined ? `registration_command:${command}:${mode}` : `registration_command:${command}`;
    return this._sendForActiveRobot(action, (robotId) =>
      buildRegistrationCommand(robotId, command, mode),
    );
  }

  public sendRegistrationPose(position: vec3, rotation: quat): boolean {
    return this._sendForActiveRobot("registration_pose", (robotId) =>
      buildRegistrationPose(position, rotation, robotId),
    );
  }

  public sendNavGoal(position: vec3, rotation: quat): boolean {
    return this._sendForActiveRobot("goal:navigate", (robotId) =>
      buildNavigateGoal(robotId, position, rotation),
    );
  }

  public sendPreviewGoal(position: vec3, rotation?: quat | null): boolean {
    return this._sendForActiveRobot("goal:preview", (robotId) =>
      buildPreviewGoal(robotId, position, rotation),
    );
  }

  public sendCancelGoal(): boolean {
    return this._sendForActiveRobot("cancel_goal", buildCancelGoal);
  }

  public sendEmergencyStop(): boolean {
    return this._sendForActiveRobot("emergency_stop", buildEmergencyStop);
  }

  public isConnected(): boolean {
    return (
      this._connection !== null &&
      this._connection.isSocketOpen() &&
      (this._inbound?.helloReceived ?? false)
    );
  }

  public send(text: string): boolean {
    const payload = text.endsWith("\n") ? text : `${text}\n`;
    const sent = this._connection?.send(payload) ?? false;
    if (!sent) {
      const now = getTime();
      if (now - this._lastSendDropLogTime >= SEND_DROP_LOG_INTERVAL_S) {
        this._lastSendDropLogTime = now;
        print("BridgeClient: send dropped — socket not open");
      }
    }
    return sent;
  }

  public sendBinary(bytes: Uint8Array): void {
    const sent = this._connection?.sendBinary(bytes) ?? false;
    if (!sent) {
      print("BridgeClient: sendBinary skipped — not open");
      return;
    }
    if (DEBUG_VERBOSE) {
      const now = getTime();
      if (now - this._lastSendBinaryLogTime >= SEND_BINARY_LOG_INTERVAL_S) {
        this._lastSendBinaryLogTime = now;
        print(`BridgeClient: sendBinary bytes=${bytes.byteLength}`);
      }
    }
  }

  private async _runTryConnect(ip: string, attemptId: number): Promise<boolean> {
    if (!this._connection || !this._inbound) {
      return false;
    }

    if (this.isConnected() && BridgeClient.normalizeIp(this.baseUrl) === ip) {
      this.requestStatus();
      return true;
    }

    if (attemptId !== this._connectAttemptId) {
      return false;
    }

    if (
      this._connection.isSocketOpen() &&
      BridgeClient.normalizeIp(this.baseUrl) === ip &&
      !this._inbound.helloReceived
    ) {
      return this._awaitHelloHandshake(ip, attemptId);
    }

    this.disconnect();
    if (attemptId !== this._connectAttemptId) {
      return false;
    }

    let handshakeError: string | null = null;
    const offProtocolError = this._inbound.onProtocolError.add((error) => {
      if (!this._inbound!.helloReceived) {
        handshakeError = error.message;
      }
    });

    try {
      this._connection.baseUrl = ip;
      await this._connection.connect();
      if (attemptId !== this._connectAttemptId) {
        return false;
      }

      return this._finishHelloHandshake(ip, attemptId, handshakeError);
    } catch (error) {
      if (attemptId === this._connectAttemptId) {
        print(`BridgeClient: tryConnect failed — ${error}`);
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
    const offProtocolError = this._inbound.onProtocolError.add((error) => {
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
      print(`BridgeClient: tryConnect failed — ${detail}`);
      this.disconnect();
      return false;
    }

    this.requestStatus();
    return true;
  }

  private _notifyConnection(connected: boolean): void {
    this._connection?.onBridgeConnectionChanged(connected);
    this.onConnectionChanged.emit(connected);
  }

  private _requireRobotId(action: string): string | null {
    const robotId = this.activeRobotId;
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
    if (action.startsWith("registration")) {
      if (action === "registration_pose") {
        const now = getTime();
        if (now - this._lastAlignPoseTxLogTime >= REGISTRATION_POSE_TX_LOG_INTERVAL_S) {
          this._lastAlignPoseTxLogTime = now;
          print(
            `BridgeClient: ${action} TX robot=${robotId} bytes=${payload.length} sent=${sent}`,
          );
        }
      } else if (action !== this._lastRegistrationCommandLogAction) {
        this._lastRegistrationCommandLogAction = action;
        print(
          `BridgeClient: ${action} TX robot=${robotId} bytes=${payload.length} sent=${sent}`,
        );
      }
    }
    return sent;
  }
}
