import { BridgeClient } from "../Bridge/BridgeClient";
import { buildCameraFrameBytes, buildCameraInfo, CameraFrameAckMessage, HelloMessage } from "../Bridge/domain";
import { DeviceCameraStream } from "./DeviceCameraStream";
import { quatFromMat4Rotation } from "../Core/Utilities";

const POSE_BUFFER_CAPACITY = 360;
// Interval measured from pipeline END (ack or finally), guaranteeing idle GC time.
const SETUP_CAPTURE_INTERVAL_S = 1.0;
const SAMPLING_BURST_INTERVAL_S = 0.2;
const RUNTIME_CAPTURE_INTERVAL_S = 3.0;
// Safety net only: ack clears _inFlight in the normal case.
const IN_FLIGHT_TIMEOUT_S = 12.0;
const MAX_HEAD_ANGULAR_VEL_DEG_S = 40.0;
const RUNTIME_CAMERA_MAX_DISTANCE_CM = 700.0;
// Capture runs ~1/s; collapse the per-frame pipeline trace into a periodic summary.
const PIPELINE_LOG_INTERVAL_S = 2.0;
const CAPTURE_TS_LOG_INTERVAL_S = 2.0;
const CLOCK_SYNC_RACE_LOG_INTERVAL_S = 2.0;

type CaptureMode = "off" | "setup" | "runtime";
export type CapturePolicy = "off" | "steady" | "burst" | "hold";

interface PoseSample {
  t: number;
  position: vec3;
  rotation: quat;
}

@component
export class FrameCaptureController extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  cameraObject: SceneObject;

  private _camera: DeviceCameraStream = DeviceCameraStream.getInstance();
  private _mode: CaptureMode = "off";
  private _seq = 0;
  private _inFlight = false;
  private _inFlightSeq = -1;
  private _inFlightStart = 0;
  // Hard lock: prevents overlapping encode pipelines regardless of ack-timeout state.
  private _pipelineBusy = false;
  // Idle-gap pacing: timestamp of the last pipeline END (ack or finally).
  // The interval timer starts here, not at capture start, so idle GC time
  // is guaranteed regardless of how long the pipeline takes.
  private _lastPipelineEndTime = 0;
  private _poseBuffer: PoseSample[] = [];
  private _updateEvent: SceneEvent | null = null;
  private _helloBound = false;
  private _robotWorldPos: vec3 | null = null;
  private _sentCameraInfo = false;
  private _onCaptureError: ((message: string) => void) | null = null;
  private _lastPipelineLogTime = 0;
  private _lastCaptureTsLogTime = 0;
  private _lastClockSyncRaceLogTime = 0;
  private _capturePolicy: CapturePolicy = "off";

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._camera.start();
      this._bindBridge();
      this._ensureUpdateLoop();
    });
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
    print(`FrameCaptureController: mode ${this._mode} -> ${mode}`);
    this._mode = mode;
    this._sentCameraInfo = false;
    if (mode === "off") {
      this._inFlight = false;
      this._inFlightSeq = -1;
    }
    this._capturePolicy = mode === "setup" ? "steady" : "off";
    // Reset pacing so the first capture in the new mode fires promptly
    // (within one interval), not after a potentially stale gap from the old mode.
    this._lastPipelineEndTime = 0;
  }

  public setCapturePolicy(policy: CapturePolicy): void {
    if (this._capturePolicy === policy) {
      return;
    }
    this._capturePolicy = policy;
    this._lastPipelineEndTime = 0;
  }

  private _bindBridge(): void {
    if (this._helloBound || !this.bridgeClient) {
      return;
    }
    this.bridgeClient.onHello.add(this._onHello);
    this.bridgeClient.onCameraFrameAck.add(this._onCameraFrameAck);
    this._helloBound = true;
  }

  private _onHello = (_msg: HelloMessage): void => {
    this._inFlight = false;
    this._inFlightSeq = -1;
    this._capturePolicy = this._mode === "setup" ? "steady" : "off";
    this._sentCameraInfo = false;
  };

  private _onCameraFrameAck = (msg: CameraFrameAckMessage): void => {
    if (msg.seq === this._inFlightSeq) {
      this._inFlight = false;
      this._inFlightSeq = -1;
      // Idle-gap pacing: start the interval clock from ack receipt.
      this._lastPipelineEndTime = getTime();
    } else {
      // Only interesting when it doesn't match the frame we're waiting on.
      print(`FrameCaptureController: ack seq=${msg.seq} expected=${this._inFlightSeq} (mismatch)`);
    }
  };

  private _ensureUpdateLoop(): void {
    if (this._updateEvent) {
      return;
    }
    this._updateEvent = this.createEvent("UpdateEvent");
    this._updateEvent.bind(() => {
      this._recordPose();
      this._maybeCapture();
    });
  }

  private _recordPose(): void {
    if (!this.cameraObject) {
      return;
    }
    const t = getTime();
    const transform = this.cameraObject.getTransform();
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
    if (this._mode === "off" || !this.bridgeClient?.isConnected()) {
      return;
    }
    if (!this.bridgeClient.isClockSyncReady) {
      return;
    }
    if (this._mode === "setup" && (this._capturePolicy === "off" || this._capturePolicy === "hold")) {
      return;
    }
    const now = getTime();
    if (this._mode === "runtime" && !this._shouldRunRuntimeCaptureWindow()) {
      return;
    }
    // Hard guard: never start a new encode pipeline while one is still running.
    if (this._pipelineBusy) {
      return;
    }
    if (this._inFlight) {
      if (now - this._inFlightStart > IN_FLIGHT_TIMEOUT_S) {
        this._inFlight = false;
        this._inFlightSeq = -1;
        this._lastPipelineEndTime = now;
      } else {
        return;
      }
    }
    const interval =
      this._mode === "setup"
        ? (this._capturePolicy === "burst"
          ? SAMPLING_BURST_INTERVAL_S
          : SETUP_CAPTURE_INTERVAL_S)
        : RUNTIME_CAPTURE_INTERVAL_S;
    // Idle-gap pacing: measure from the end of the last pipeline, not its start.
    if (now - this._lastPipelineEndTime < interval) {
      return;
    }
    if (this._headAngularVelocityDegS() > MAX_HEAD_ANGULAR_VEL_DEG_S) {
      return;
    }
    // Request the next frame from the always-on stream for both setup and runtime.
    this._captureNextStreamFrame().catch((err) => {
      print("FrameCaptureController: capture error: " + String(err));
    });
  }

  private _shouldRunRuntimeCaptureWindow(): boolean {
    if (this._mode !== "runtime") {
      return true;
    }
    const robot = this._robotWorldPos;
    if (!robot || !this.cameraObject) {
      return true;
    }
    const cameraPos = this.cameraObject.getTransform().getWorldPosition();
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
    const robotId = this.bridgeClient?.activeRobotId;
    const deviceCamera = this._camera.deviceCamera;
    if (!robotId || !deviceCamera) {
      return;
    }
    const seq = this._beginPipeline();
    const pipelineStart = getTime();
    try {
      const frame = await this._camera.requestNextFrame();
      await this._captureFromStream(frame.texture, frame.timestampSeconds, robotId, seq, pipelineStart);
    } catch (error) {
      this._finishPipelineWithoutAck(seq);
      const message = String(error);
      if (this._onCaptureError) {
        this._onCaptureError(message);
      }
      print("FrameCaptureController: capture failed: " + message);
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
      print("FrameCaptureController: capture failed: " + message);
    }
  }

  private _beginPipeline(): number {
    this._pipelineBusy = true;
    this._inFlight = true;
    this._inFlightStart = getTime();
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
    if (!Number.isFinite(args.captureTs)) {
      throw new Error("non-finite capture timestamp");
    }
    const pose = this._lookupPose(args.captureTs);
    if (!pose) {
      this._finishPipelineWithoutAck(args.seq);
      return;
    }
    if (!this.bridgeClient.isClockSyncReady) {
      this._finishPipelineWithoutAck(args.seq);
      const now = getTime();
      if (now - this._lastClockSyncRaceLogTime >= CLOCK_SYNC_RACE_LOG_INTERVAL_S) {
        this._lastClockSyncRaceLogTime = now;
        print(
          "FrameCaptureController: clock sync not ready at send time; skipping frame (no capture_ts_robot)",
        );
      }
      return;
    }
    const camPose = this._cameraWorldPose(pose);
    if (!this._sentCameraInfo) {
      this._sendCameraInfo(args.texture);
    }
    const jpegBytes = await this._encodeJpeg(args.texture);
    const captureTsRobot = this.bridgeClient.mapCaptureTime(args.captureTs);
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
    this.bridgeClient.sendBinary(bytes);
    const now = getTime();
    if (now - this._lastCaptureTsLogTime >= CAPTURE_TS_LOG_INTERVAL_S) {
      this._lastCaptureTsLogTime = now;
      const offset = captureTsRobot - args.captureTs;
      print(
        `FrameCaptureController: seq=${args.seq} capture_ts_robot=${captureTsRobot.toFixed(4)} lens_ts=${args.captureTs.toFixed(4)} offset=${offset.toFixed(4)}`,
      );
    }
    if (now - this._lastPipelineLogTime >= PIPELINE_LOG_INTERVAL_S) {
      this._lastPipelineLogTime = now;
      const pipelineMs = Math.round((now - args.pipelineStart) * 1000);
      print(
        `FrameCaptureController: seq=${args.seq} pipeline=${pipelineMs}ms jpeg=${jpegBytes.byteLength}B`,
      );
    }
  }

  private _sendCameraInfo(frameTexture: Texture): void {
    const deviceCamera = this._camera.deviceCamera;
    if (!deviceCamera || !this.bridgeClient) {
      return;
    }
    const robotId = this.bridgeClient.activeRobotId;
    if (!robotId) {
      return;
    }
    // Use the actual encoded frame dimensions so the camera matrix matches.
    // For the stream, these equal DeviceCamera.resolution (scale factor = 1).
    const frameWidth = frameTexture.getWidth();
    const frameHeight = frameTexture.getHeight();
    const nativeRes = deviceCamera.resolution;
    const scaleX = nativeRes.x > 0 ? frameWidth / nativeRes.x : 1.0;
    const scaleY = nativeRes.y > 0 ? frameHeight / nativeRes.y : 1.0;
    const fx = deviceCamera.focalLength.x * scaleX;
    const fy = deviceCamera.focalLength.y * scaleY;
    const cx = deviceCamera.principalPoint.x * scaleX;
    const cy = deviceCamera.principalPoint.y * scaleY;
    this.bridgeClient.send(
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
    print(`FrameCaptureController: camera_info sent ${frameWidth}x${frameHeight} scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);
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
    const deviceCamera = this._camera.deviceCamera;
    if (!deviceCamera) {
      return { position: devicePose.position, rotation: devicePose.rotation };
    }
    // DeviceCamera.pose is T_device_camera on Spectacles: converts camera-space
    // points to device-center space. Composing with devicePose gives T_world_camera.
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
