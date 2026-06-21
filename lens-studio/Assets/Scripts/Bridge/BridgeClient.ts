import {
  RegistrationStatusMessage,
  CameraFrameAckMessage,
  BridgeStatusMessage,
  HelloMessage,
  LidarMessage,
  NavStatusMessage,
  PathMessage,
  PongMessage,
  PoseCorrectionMessage,
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
const DEBUG_VERBOSE = false;

/** Scene facade: WebSocket transport, inbound decode, clock sync, and outbound commands. */
@component
export class BridgeClient extends BaseScriptComponent {
  /** Default Mac LAN IP when no IP is saved on device. */
  @input
  defaultBridgeIp: string = "192.168.1.166";

  @input
  internetModule: InternetModule;

  public baseUrl: string = "";

  private _connection: BridgeConnectionManager | null = null;
  private _inbound: BridgeInboundProcessor | null = null;
  private _lastSendDropLogTime = -1;
  private _lastAlignPoseTxLogTime = -1;
  private _lastSendBinaryLogTime = -1;
  private _parseRecoveryEvent: DelayedCallbackEvent | null = null;

  public get onHello(): Signal<HelloMessage> {
    return this._inbound!.onHello;
  }
  public get onLidar(): Signal<LidarMessage> {
    return this._inbound!.onLidar;
  }
  public get onPose(): Signal<PoseMessage> {
    return this._inbound!.onPose;
  }
  public get onPoseCorrection(): Signal<PoseCorrectionMessage> {
    return this._inbound!.onPoseCorrection;
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
      this.connect().catch((error) => {
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

  public async connect(): Promise<void> {
    if (!this._connection) {
      return;
    }
    if (this._connection.isSocketOpen()) {
      return;
    }
    if (this._connection.isConnecting) {
      return;
    }
    this.disconnect();
    this._connection.baseUrl = this.baseUrl;
    await this._connection.connect();
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

  /** Wait for server `hello` after the socket is open (bridge sends it on connect). */
  public waitForHello(timeoutSeconds: number = 3.0): Promise<boolean> {
    return this._inbound?.waitForHello(timeoutSeconds) ?? Promise.resolve(false);
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
      } else {
        print(
          `BridgeClient: ${action} TX robot=${robotId} bytes=${payload.length} sent=${sent}`,
        );
      }
    }
    return sent;
  }
}
