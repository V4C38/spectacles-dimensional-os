/** Inbound protocol decode: text dispatch, hello-wait, binary LiDAR pump, parse recovery. */
import {
  RegistrationStatusMessage,
  BridgeStatusMessage,
  CameraFrameAckMessage,
  CapabilityState,
  HelloMessage,
  LidarMessage,
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  PongMessage,
  PoseCorrectionMessage,
  PoseMessage,
  isNonCriticalInboundMessageType,
  parseInboundMessage,
  parseLidarBinary,
  ProtocolParseError,
  sniffInboundMessageType,
} from "./Protocol";
import {
  BridgeConnectionManager,
  PendingBinaryFrame,
} from "./BridgeConnectionManager";
import { Signal } from "../Core/Utilities";

const PARSE_RECONNECT_THRESHOLD = 5;
const POSE_LOG_INTERVAL_S = 30;

export interface BridgeInboundProcessorCallbacks {
  onHelloConnection: (connected: boolean) => void;
  onSocketClosed: () => void;
  scheduleParseRecoveryReconnect: () => void;
}

export class BridgeInboundProcessor {
  public readonly onHello = new Signal<HelloMessage>();
  public readonly onLidar = new Signal<LidarMessage>();
  public readonly onPose = new Signal<PoseMessage>();
  public readonly onPoseCorrection = new Signal<PoseCorrectionMessage>();
  public readonly onRegistrationStatus = new Signal<RegistrationStatusMessage>();
  public readonly onCameraFrameAck = new Signal<CameraFrameAckMessage>();
  public readonly onBridgeStatus = new Signal<BridgeStatusMessage>();
  public readonly onPath = new Signal<PathMessage>();
  public readonly onPathPreview = new Signal<PathPreviewMessage>();
  public readonly onNavStatus = new Signal<NavStatusMessage>();
  public readonly onPong = new Signal<PongMessage>();
  public readonly onProtocolError = new Signal<ProtocolParseError>();

  public helloReceived = false;
  public lastBridgeStatus: BridgeStatusMessage | null = null;

  private readonly _connection: BridgeConnectionManager;
  private readonly _callbacks: BridgeInboundProcessorCallbacks;
  private readonly _helloTimeoutEvent: DelayedCallbackEvent;

  private _activeRobotId: string | null = null;
  private _capabilities: Record<string, CapabilityState> = {};
  private _consecutiveParseFailures = 0;
  private _reconnectScheduled = false;
  private _poseRxCount = 0;
  private _lastPoseRxLogTime = -1;
  private _lastBridgeStatusKey = "";
  private _lastNavStatusKey = "";
  private _messageRxCount = 0;
  private _pendingBinaryFrames: PendingBinaryFrame[] = [];
  private _binaryDecodeRunning = false;
  private _pendingHelloFinish: ((ok: boolean) => void) | null = null;

  constructor(
    script: ScriptComponent,
    connection: BridgeConnectionManager,
    callbacks: BridgeInboundProcessorCallbacks,
  ) {
    this._connection = connection;
    this._callbacks = callbacks;

    const helloTimeout = script.createEvent(
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

    connection.onTextMessage.add((line) => {
      this._messageRxCount++;
      this._dispatchTextMessage(line);
    });
    connection.onBinaryBlob.add((frame) => {
      this._messageRxCount++;
      this._pendingBinaryFrames.push(frame);
      this._pumpBinaryFrames();
    });
    connection.onClose.add(() => {
      this._resetSessionState();
      this._callbacks.onSocketClosed();
    });
  }

  public get poseRxCount(): number {
    return this._poseRxCount;
  }

  public get messageRxCount(): number {
    return this._messageRxCount;
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

  public resetSessionState(): void {
    this._resetSessionState();
  }

  public waitForHello(timeoutSeconds: number = 3.0): Promise<boolean> {
    if (this.helloReceived) {
      return Promise.resolve(true);
    }
    if (!this._connection.isSocketOpen()) {
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
      this._pendingHelloFinish = (ok: boolean) => finish(ok);
      this._helloTimeoutEvent.reset(timeoutSeconds);
    });
  }

  private _resetSessionState(): void {
    this._pendingBinaryFrames = [];
    this._binaryDecodeRunning = false;
    this.helloReceived = false;
    this._activeRobotId = null;
    this._capabilities = {};
    this.lastBridgeStatus = null;
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
          this._callbacks.onHelloConnection(true);
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
        case "registration_status":
          this._adoptRobotId(msg.robot_id);
          this._logDiagnosticRx(msg);
          this.onRegistrationStatus.emit(msg);
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
        case "pong":
          this._adoptRobotId(msg.robot_id);
          this.onPong.emit(msg);
          break;
      }
    } catch (error) {
      this._handleParseFailure(payload, error);
    }
  }

  private async _pumpBinaryFrames(): Promise<void> {
    if (this._binaryDecodeRunning) {
      return;
    }
    this._binaryDecodeRunning = true;
    try {
      while (this._pendingBinaryFrames.length > 0) {
        if (this._pendingBinaryFrames.length > 1) {
          this._pendingBinaryFrames.splice(0, this._pendingBinaryFrames.length - 1);
        }
        const frame = this._pendingBinaryFrames.shift();
        if (!frame) {
          continue;
        }
        try {
          const bytes = await frame.blob.bytes();
          if (this._connection.ws !== frame.socket) {
            continue;
          }
          const msg = parseLidarBinary(bytes, this._activeRobotId ?? "");
          if (msg) {
            this.onLidar.emit(msg);
          }
        } catch (e: unknown) {
          print(`BridgeInboundProcessor: binary frame decode failed: ${e}`);
        }
      }
    } finally {
      this._binaryDecodeRunning = false;
      if (this._pendingBinaryFrames.length > 0) {
        this._pumpBinaryFrames();
      }
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

    const nonCritical =
      isNonCriticalInboundMessageType(parseError.messageType) ||
      (parseError.kind === "json" &&
        isNonCriticalInboundMessageType(sniffed));

    if (parseError.kind === "json") {
      return;
    }

    if (nonCritical) {
      return;
    }

    this._consecutiveParseFailures += 1;
    this.onProtocolError.emit(parseError);

    print(
      `BridgeInboundProcessor: protocol ${parseError.kind} error on ${parseError.messageType ?? sniffed ?? "unknown"} (${this._consecutiveParseFailures}); len=${raw.length}; first="${this._snippet(raw, 0)}" last="${this._snippet(raw, Math.max(0, raw.length - 80))}"`,
    );

    if (this._consecutiveParseFailures >= PARSE_RECONNECT_THRESHOLD) {
      print(
        `BridgeInboundProcessor: ${this._consecutiveParseFailures} consecutive parse failures; reconnecting`,
      );
      this._scheduleReconnectAfterParseFailures();
    }
  }

  private _scheduleReconnectAfterParseFailures(): void {
    if (this._reconnectScheduled) {
      return;
    }
    this._reconnectScheduled = true;
    this._consecutiveParseFailures = 0;
    this._callbacks.scheduleParseRecoveryReconnect();
  }

  private _adoptRobotId(robotId: string | null): void {
    if (!robotId) {
      return;
    }
    this._activeRobotId = robotId;
  }

  private _snippet(text: string, start: number): string {
    return text
      .substring(start, Math.min(text.length, start + 80))
      .replace("\n", "\\n")
      .replace("\r", "\\r");
  }

  private _logPoseRx(msg: PoseMessage): void {
    this._poseRxCount++;
    const now = getTime();
    if (this._poseRxCount === 1 || now - this._lastPoseRxLogTime >= POSE_LOG_INTERVAL_S) {
      this._lastPoseRxLogTime = now;
      const pos = msg.position;
      print(
        `BridgeInboundProcessor: RX pose #${this._poseRxCount}` +
          ` pos=(${pos[0].toFixed(2)},${pos[1].toFixed(2)},${pos[2].toFixed(2)})`,
      );
    }
  }

  private _logDiagnosticRx(
    msg: RegistrationStatusMessage | CameraFrameAckMessage | BridgeStatusMessage | NavStatusMessage,
  ): void {
    switch (msg.type) {
      case "registration_status":
        break;
      case "camera_frame_ack":
        break;
      case "bridge_status": {
        const key = `${msg.registered}|${msg.robot_connected}|${msg.registration_method ?? "-"}`;
        if (key !== this._lastBridgeStatusKey) {
          this._lastBridgeStatusKey = key;
          print(
            `BridgeInboundProcessor: RX bridge_status registered=${msg.registered} robot_connected=${msg.robot_connected}`,
          );
        }
        break;
      }
      case "nav_status": {
        const key = `${msg.state}|${msg.goal_reached}|${msg.goal_failed}|${msg.error_code ?? "-"}`;
        if (key !== this._lastNavStatusKey) {
          this._lastNavStatusKey = key;
          print(
            `BridgeInboundProcessor: RX nav_status state=${msg.state} goal_reached=${msg.goal_reached} goal_failed=${msg.goal_failed} error_code=${msg.error_code ?? "-"}`,
          );
        }
        break;
      }
    }
  }
}
