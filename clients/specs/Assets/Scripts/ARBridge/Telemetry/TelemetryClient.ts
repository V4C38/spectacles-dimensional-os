import {
  buildSetLidarMode,
  DEFAULT_LIDAR_OBSTACLE_SETTINGS,
  LidarMessage,
  LidarObstacleSettings,
  PoseMessage,
  WorldFrameCorrectionMessage,
} from "../Network/Protocol";
import { InboundProcessor } from "../Network/InboundProcessor";
import { WebSocketTransport } from "../Network/WebSocketTransport";
import { sendForActiveRobot } from "../Network/WebSocketTransport";
import { Signal } from "../../App/Utilities/Utilities";
import { AppStateStore } from "../../App/AppState";
import { LidarDisplayMode } from "../../App/AppState";
import { ARBridgeSession } from "../Network/ARBridgeSession";

const DRIFTING_TRANSLATION_THRESHOLD_M = 0.05;
const WORLD_FRAME_CORRECTION_LOG_INTERVAL_S = 1.0;

/** Pose, LiDAR mode/points, world_frame_correction — mirrors TelemetryPublisher. */
export class TelemetryClient {
  public readonly onPose = new Signal<PoseMessage>();
  public readonly onLidar = new Signal<LidarMessage>();
  public readonly onWorldFrameCorrection = new Signal<WorldFrameCorrectionMessage>();

  private _lastPose: PoseMessage | null = null;
  private _pendingPose: PoseMessage | null = null;
  private _lastSentBridgeLidarMode: LidarDisplayMode | null = null;
  private _lastWorldFrameCorrectionLogTime = 0;
  private readonly _sendDropLog = { value: -1 };
  private _bound = false;

  constructor(
    private readonly _state: AppStateStore,
    private readonly _session: ARBridgeSession | null,
    private readonly _transport: WebSocketTransport | null,
    private readonly _inbound: InboundProcessor | null,
  ) {}

  public get lastPose(): PoseMessage | null {
    return this._lastPose;
  }

  public bind(): void {
    if (this._bound || !this._inbound) {
      return;
    }
    this._bound = true;
    this._inbound.onPose.add((msg) => this._handlePose(msg));
    this._inbound.onLidar.add((msg) => this.onLidar.emit(msg));
    this._inbound.onWorldFrameCorrection.add((msg) => this._handleWorldFrameCorrection(msg));
  }

  public handlePose(msg: PoseMessage): void {
    this._handlePose(msg);
  }

  public handleWorldFrameCorrection(msg: WorldFrameCorrectionMessage): void {
    this._handleWorldFrameCorrection(msg);
  }

  public consumePendingPose(): PoseMessage | null {
    const msg = this._pendingPose;
    this._pendingPose = null;
    return msg;
  }

  public resetBridgeLidarModeTracking(): void {
    this._lastSentBridgeLidarMode = null;
  }

  public onDisconnect(): void {
    this._lastSentBridgeLidarMode = null;
    this._lastPose = null;
    this._pendingPose = null;
  }

  public syncLidarMode(mode: LidarDisplayMode): void {
    if (this._lastSentBridgeLidarMode === mode) {
      return;
    }
    if (!this._session?.isConnected() || !this._transport || !this._inbound) {
      return;
    }
    this._lastSentBridgeLidarMode = mode;
    print(`TelemetryClient: lidarMode bridge sync mode=${mode}`);
    sendForActiveRobot(
      this._transport,
      this._inbound,
      "set_lidar_mode",
      (robotId) => buildSetLidarMode(robotId, mode, DEFAULT_LIDAR_OBSTACLE_SETTINGS),
      this._sendDropLog,
    );
  }

  public setLidarMode(
    mode: "off" | "obstacles" | "full",
    settings: LidarObstacleSettings = DEFAULT_LIDAR_OBSTACLE_SETTINGS,
  ): boolean {
    if (!this._transport || !this._inbound) {
      return false;
    }
    return sendForActiveRobot(
      this._transport,
      this._inbound,
      "set_lidar_mode",
      (robotId) => buildSetLidarMode(robotId, mode, settings),
      this._sendDropLog,
    );
  }

  private _handlePose(msg: PoseMessage): void {
    this._lastPose = msg;
    this._pendingPose = msg;
    this.onPose.emit(msg);
  }

  private _handleWorldFrameCorrection(msg: WorldFrameCorrectionMessage): void {
    this._state.update({
      driftState: {
        isDrifting: msg.trans_delta_m > DRIFTING_TRANSLATION_THRESHOLD_M,
        transDeltaM: msg.trans_delta_m,
        yawDeltaDeg:
          typeof msg.yaw_delta_deg === "number" ? msg.yaw_delta_deg : null,
        yawCorrected: msg.yaw_corrected,
        solveQuality: msg.solve_quality,
        solveMethod: msg.solve_method,
        lastUpdateTs: msg.ts,
      },
    });
    const now = getTime();
    if (
      this._lastWorldFrameCorrectionLogTime === 0 ||
      now - this._lastWorldFrameCorrectionLogTime >= WORLD_FRAME_CORRECTION_LOG_INTERVAL_S
    ) {
      this._lastWorldFrameCorrectionLogTime = now;
      const yawDeltaText =
        typeof msg.yaw_delta_deg === "number" ? msg.yaw_delta_deg.toFixed(2) : "n/a";
      const confidenceText =
        typeof msg.alignment_confidence === "number"
          ? msg.alignment_confidence.toFixed(2)
          : "n/a";
      print(
        `TelemetryClient: world_frame_correction transDeltaM=${msg.trans_delta_m.toFixed(3)} yawDeltaDeg=${yawDeltaText} yawCorrected=${msg.yaw_corrected} solveQuality=${msg.solve_quality.toFixed(3)} solveMethod=${msg.solve_method} confidence=${confidenceText} yawObservable=${msg.yaw_observable ?? "n/a"} scaleObservable=${msg.scale_observable ?? "n/a"}`,
      );
    }
    this.onWorldFrameCorrection.emit(msg);
  }
}
