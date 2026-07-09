import { ARBridgeSession } from "../Network/ARBridgeSession";
import {
  buildCameraFrameBytes,
  buildCameraInfo,
  CameraFrameAckMessage,
  HelloMessage,
} from "../Network/Protocol";
import { sendBinary } from "../Network/WebSocketTransport";
import { quatFromMat4Rotation } from "../../App/Utilities/Utilities";
import { DeviceCameraStream } from "./DeviceCameraStream";

const POSE_BUFFER_CAPACITY = 360;
const SETUP_CAPTURE_INTERVAL_S = 0.7;
const SAMPLING_BURST_INTERVAL_S = 0.5;
const RUNTIME_CAPTURE_INTERVAL_S = 1.0;
const RUNTIME_STOP_SPEED_MPS = 0.05;
const RUNTIME_STOP_BURST_COUNT = 3;
const MAX_HEAD_ANGULAR_VEL_DEG_S = 40.0;
const RUNTIME_CAMERA_MAX_DISTANCE_CM = 700.0;
const PIPELINE_LOG_INTERVAL_S = 2.0;
const CAPTURE_TS_LOG_INTERVAL_S = 2.0;
const CLOCK_SYNC_RACE_LOG_INTERVAL_S = 2.0;

export type CaptureMode = "off" | "registration" | "runtime";
export type CapturePolicy = "off" | "steady" | "burst" | "hold";

export function shouldTriggerStopBurst(
  previousSpeedMps: number | null,
  nextSpeedMps: number | null,
): boolean {
  const wasMoving = previousSpeedMps !== null && previousSpeedMps >= RUNTIME_STOP_SPEED_MPS;
  const isStopped = nextSpeedMps !== null && nextSpeedMps < RUNTIME_STOP_SPEED_MPS;
  return wasMoving && isStopped;
}

interface PoseSample {
  t: number;
  position: vec3;
  rotation: quat;
}

export interface CameraClientDeps {
  session: ARBridgeSession | null;
  camera: DeviceCameraStream;
  getCameraObject: () => SceneObject | null;
}

/** Wire + capture pipeline for camera_info and binary camera frames. */
export class CameraClient {
  private _mode: CaptureMode = "off";
  private _seq = 0;
  private _inFlight = false;
  private _inFlightSeq = -1;
  private _inFlightStart = 0;
  private _pipelineBusy = false;
  private _lastPipelineEndTime = 0;
  private _poseBuffer: PoseSample[] = [];
  private _helloBound = false;
  private _robotWorldPos: vec3 | null = null;
  private _sentCameraInfo = false;
  private _onCaptureError: ((message: string) => void) | null = null;
  private _lastPipelineLogTime = 0;
  private _lastCaptureTsLogTime = 0;
  private _lastClockSyncRaceLogTime = 0;
  private _capturePolicy: CapturePolicy = "off";
  private _lastSpeedMps: number | null = null;
  private _burstCapturesRemaining = 0;

  constructor(private readonly _deps: CameraClientDeps) {}

  public bindInbound(): void {
    if (this._helloBound || !this._deps.session) {
      return;
    }
    this._deps.session.inbound.onHello.add(this._onHello);
    this._deps.session.inbound.onCameraFrameAck.add(this._onCameraFrameAck);
    this._helloBound = true;
  }

  public setCaptureErrorHandler(handler: (message: string) => void): void {
    this._onCaptureError = handler;
  }

  public setRobotWorldPosition(position: vec3 | null): void {
    this._robotWorldPos = position;
  }

  public setMode(mode: CaptureMode): void {
    if (this._mode === mode) {
      return;
    }
    print(`CameraClient: mode ${this._mode} -> ${mode}`);
    this._mode = mode;
    this._sentCameraInfo = false;
    if (mode === "off") {
      this._inFlight = false;
      this._inFlightSeq = -1;
    }
    this._capturePolicy = mode === "registration" ? "steady" : "off";
    this._lastPipelineEndTime = 0;
  }

  public setCapturePolicy(policy: CapturePolicy): void {
    if (this._capturePolicy === policy) {
      return;
    }
    print(`CameraClient: capture policy ${this._capturePolicy} -> ${policy}`);
    this._capturePolicy = policy;
    this._lastPipelineEndTime = 0;
  }

  public tick(): void {
    this._recordPose();
    this._maybeCapture();
  }

  public requestImmediateCapture(): void {
    if (this._mode !== "runtime") {
      return;
    }
    this._lastPipelineEndTime = 0;
  }

  public notifyRobotSpeed(speedMps: number | null): void {
    if (this._mode === "runtime" && shouldTriggerStopBurst(this._lastSpeedMps, speedMps)) {
      this._burstCapturesRemaining = RUNTIME_STOP_BURST_COUNT;
      this._lastPipelineEndTime = 0;
    }
    this._lastSpeedMps = speedMps;
  }

  private _onHello = (_msg: HelloMessage): void => {
    this._inFlight = false;
    this._inFlightSeq = -1;
    this._capturePolicy = this._mode === "registration" ? "steady" : "off";
    this._sentCameraInfo = false;
  };

  private _onCameraFrameAck = (msg: CameraFrameAckMessage): void => {
    if (msg.seq === this._inFlightSeq) {
      this._inFlight = false;
      this._inFlightSeq = -1;
      // Cadence is send-gated (see _sendCapturedFrame); ACK no longer drives the interval timer.
    } else {
      print(`CameraClient: ack seq=${msg.seq} expected=${this._inFlightSeq} (mismatch)`);
    }
  };

  private _recordPose(): void {
    const cameraObject = this._deps.getCameraObject();
    if (!cameraObject) {
      return;
    }
    const t = getTime();
    const transform = cameraObject.getTransform();
    this._poseBuffer.push({
      t,
      position: transform.getWorldPosition(),
      rotation: transform.getWorldRotation(),
    });
    if (this._poseBuffer.length > POSE_BUFFER_CAPACITY) {
      this._poseBuffer.shift();
    }
  }

  private _maybeCapture(): void {
    const session = this._deps.session;
    if (this._mode === "off" || !session?.isConnected()) {
      return;
    }
    if (!session.isClockSyncReady) {
      return;
    }
    if (
      this._mode === "registration" &&
      (this._capturePolicy === "off" || this._capturePolicy === "hold")
    ) {
      return;
    }
    const now = getTime();
    if (this._mode === "runtime" && !this._shouldRunRuntimeCaptureWindow()) {
      return;
    }
    if (this._pipelineBusy) {
      return;
    }
    const interval =
      this._mode === "registration"
        ? this._capturePolicy === "burst"
          ? SAMPLING_BURST_INTERVAL_S
          : SETUP_CAPTURE_INTERVAL_S
        : this._burstCapturesRemaining > 0
          ? SAMPLING_BURST_INTERVAL_S
          : RUNTIME_CAPTURE_INTERVAL_S;
    if (now - this._lastPipelineEndTime < interval) {
      return;
    }
    if (this._headAngularVelocityDegS() > MAX_HEAD_ANGULAR_VEL_DEG_S) {
      return;
    }
    this._captureNextStreamFrame().catch((err) => {
      print("CameraClient: capture error: " + String(err));
    });
  }

  private _shouldRunRuntimeCaptureWindow(): boolean {
    if (this._mode !== "runtime") {
      return true;
    }
    const robot = this._robotWorldPos;
    const cameraObject = this._deps.getCameraObject();
    if (!robot || !cameraObject) {
      return true;
    }
    const cameraPos = cameraObject.getTransform().getWorldPosition();
    return cameraPos.distance(robot) <= RUNTIME_CAMERA_MAX_DISTANCE_CM;
  }

  private _headAngularVelocityDegS(): number {
    if (this._poseBuffer.length < 2) {
      return 0;
    }
    const a = this._poseBuffer[this._poseBuffer.length - 2];
    const b = this._poseBuffer[this._poseBuffer.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) {
      return 0;
    }
    const dot = Math.abs(a.rotation.dot(b.rotation));
    const angleRad = 2 * Math.acos(Math.min(1, dot));
    return (angleRad * 180) / Math.PI / dt;
  }

  private async _captureNextStreamFrame(): Promise<void> {
    const session = this._deps.session;
    const robotId = session?.activeRobotId;
    const deviceCamera = this._deps.camera.deviceCamera;
    if (!robotId || !deviceCamera) {
      return;
    }
    const seq = this._beginPipeline();
    const pipelineStart = getTime();
    try {
      const frame = await this._deps.camera.requestNextFrame();
      await this._captureFromStream(frame.texture, frame.timestampSeconds, robotId, seq, pipelineStart);
    } catch (error) {
      this._finishPipelineWithoutAck(seq);
      const message = String(error);
      if (this._onCaptureError) {
        this._onCaptureError(message);
      }
      print("CameraClient: capture failed: " + message);
    } finally {
      this._pipelineBusy = false;
    }
  }

  private async _captureFromStream(
    texture: Texture,
    captureTs: number,
    robotId: string,
    seq: number,
    pipelineStart: number,
  ): Promise<void> {
    try {
      await this._sendCapturedFrame({
        texture,
        captureTs,
        robotId,
        seq,
        pipelineStart,
      });
    } catch (error) {
      this._finishPipelineWithoutAck(seq);
      const message = String(error);
      if (this._onCaptureError) {
        this._onCaptureError(message);
      }
      print("CameraClient: capture failed: " + message);
    }
  }

  private _beginPipeline(): number {
    this._pipelineBusy = true;
    this._inFlight = true;
    this._inFlightStart = getTime();
    if (this._mode === "runtime" && this._burstCapturesRemaining > 0) {
      this._burstCapturesRemaining--;
    }
    const seq = ++this._seq;
    this._inFlightSeq = seq;
    return seq;
  }

  private _finishPipelineWithoutAck(seq: number): void {
    if (this._inFlightSeq === seq) {
      this._inFlight = false;
      this._inFlightSeq = -1;
    }
    this._lastPipelineEndTime = getTime();
  }

  private async _sendCapturedFrame(args: {
    texture: Texture;
    captureTs: number;
    robotId: string;
    seq: number;
    pipelineStart: number;
  }): Promise<void> {
    const session = this._deps.session;
    if (!session) {
      this._finishPipelineWithoutAck(args.seq);
      return;
    }
    if (!Number.isFinite(args.captureTs)) {
      throw new Error("non-finite capture timestamp");
    }
    const pose = this._lookupPose(args.captureTs);
    if (!pose) {
      this._finishPipelineWithoutAck(args.seq);
      return;
    }
    if (!session.isClockSyncReady) {
      this._finishPipelineWithoutAck(args.seq);
      const now = getTime();
      if (now - this._lastClockSyncRaceLogTime >= CLOCK_SYNC_RACE_LOG_INTERVAL_S) {
        this._lastClockSyncRaceLogTime = now;
        print(
          "CameraClient: clock sync not ready at send time; skipping frame (no capture_ts_robot)",
        );
      }
      return;
    }
    const camPose = this._cameraWorldPose(pose);
    if (!this._sentCameraInfo) {
      this.sendCameraInfo(args.texture);
    }
    const jpegBytes = await this._encodeJpeg(args.texture);
    const captureTsRobot = session.mapCaptureTime(args.captureTs);
    const bytes = buildCameraFrameBytes({
      robotId: args.robotId,
      seq: args.seq,
      ts: args.captureTs,
      sendTs: getTime(),
      camPos: camPose.position,
      camRot: camPose.rotation,
      jpegBytes,
      captureTsRobot,
    });
    const transport = session.transport;
    if (transport) {
      sendBinary(transport, bytes);
      // Send-gated cadence: the interval timer starts when the frame leaves the device,
      // not when the bridge ACK returns. Decouples frame rate from round-trip latency.
      this._lastPipelineEndTime = getTime();
    }
    const now = getTime();
    if (now - this._lastCaptureTsLogTime >= CAPTURE_TS_LOG_INTERVAL_S) {
      this._lastCaptureTsLogTime = now;
      const offset = captureTsRobot - args.captureTs;
      print(
        `CameraClient: seq=${args.seq} capture_ts_robot=${captureTsRobot.toFixed(4)} lens_ts=${args.captureTs.toFixed(4)} offset=${offset.toFixed(4)}`,
      );
    }
    if (now - this._lastPipelineLogTime >= PIPELINE_LOG_INTERVAL_S) {
      this._lastPipelineLogTime = now;
      const pipelineMs = Math.round((now - args.pipelineStart) * 1000);
      print(
        `CameraClient: seq=${args.seq} pipeline=${pipelineMs}ms jpeg=${jpegBytes.byteLength}B`,
      );
    }
  }

  public sendCameraInfo(frameTexture: Texture): void {
    const session = this._deps.session;
    const deviceCamera = this._deps.camera.deviceCamera;
    if (!deviceCamera || !session) {
      return;
    }
    const robotId = session.activeRobotId;
    if (!robotId) {
      return;
    }
    const frameWidth = frameTexture.getWidth();
    const frameHeight = frameTexture.getHeight();
    const nativeRes = deviceCamera.resolution;
    const scaleX = nativeRes.x > 0 ? frameWidth / nativeRes.x : 1.0;
    const scaleY = nativeRes.y > 0 ? frameHeight / nativeRes.y : 1.0;
    const fx = deviceCamera.focalLength.x * scaleX;
    const fy = deviceCamera.focalLength.y * scaleY;
    const cx = deviceCamera.principalPoint.x * scaleX;
    const cy = deviceCamera.principalPoint.y * scaleY;
    const transport = session.transport;
    if (!transport) {
      return;
    }
    transport.send(
      buildCameraInfo({
        robotId,
        width: frameWidth,
        height: frameHeight,
        fx,
        fy,
        cx,
        cy,
        deviceModel: "spectacles",
      }),
    );
    this._sentCameraInfo = true;
    print(
      `CameraClient: camera_info sent ${frameWidth}x${frameHeight} scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`,
    );
  }

  private _lookupPose(ts: number): PoseSample | null {
    if (this._poseBuffer.length === 0) {
      return null;
    }
    let before: PoseSample | null = null;
    let after: PoseSample | null = null;
    for (const sample of this._poseBuffer) {
      if (sample.t <= ts) {
        before = sample;
      } else if (!after) {
        after = sample;
        break;
      }
    }
    if (before && after && after.t > before.t) {
      const alpha = (ts - before.t) / (after.t - before.t);
      return {
        t: ts,
        position: vec3.lerp(before.position, after.position, alpha),
        rotation: quat.slerp(before.rotation, after.rotation, alpha),
      };
    }
    const nearest = before || after || this._poseBuffer[this._poseBuffer.length - 1];
    if (Math.abs(nearest.t - ts) > 0.1) {
      return null;
    }
    return nearest;
  }

  private _cameraWorldPose(devicePose: PoseSample): {
    position: vec3;
    rotation: quat;
  } {
    const deviceCamera = this._deps.camera.deviceCamera;
    if (!deviceCamera) {
      return { position: devicePose.position, rotation: devicePose.rotation };
    }
    const extrinsic = deviceCamera.pose;
    const extrinsicPos = new vec3(extrinsic.column3.x, extrinsic.column3.y, extrinsic.column3.z);
    const extrinsicRot = quatFromMat4Rotation(extrinsic);
    return {
      position: devicePose.position.add(devicePose.rotation.multiplyVec3(extrinsicPos)),
      rotation: devicePose.rotation.multiply(extrinsicRot),
    };
  }

  private _encodeJpeg(texture: Texture): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      Base64.encodeTextureAsync(
        texture,
        (base64: string) => {
          const decoded = Base64.decode(base64);
          if (decoded instanceof Uint8Array) {
            resolve(decoded);
            return;
          }
          const binaryStr = decoded as string;
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          resolve(bytes);
        },
        () => reject(new Error("JPEG encode failed")),
        CompressionQuality.IntermediateQuality,
        EncodingType.Jpg,
      );
    });
  }
}
