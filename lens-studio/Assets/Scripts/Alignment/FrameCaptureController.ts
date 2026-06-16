import { BridgeClient } from "../Bridge/BridgeClient";
import { buildCameraFrameBytes, buildCameraInfo, CameraFrameAckMessage } from "../Bridge/Protocol";
import { quatFromMat4Rotation } from "../Core/MathUtils";

const POSE_BUFFER_CAPACITY = 360;
// Interval measured from pipeline END (ack or finally), guaranteeing idle GC time.
const SETUP_CAPTURE_INTERVAL_S = 1.0;
const RUNTIME_CAPTURE_INTERVAL_S = 3.0;
// Safety net only: ack clears _inFlight in the normal case.
const IN_FLIGHT_TIMEOUT_S = 12.0;
const MAX_HEAD_ANGULAR_VEL_DEG_S = 40.0;
const RUNTIME_CAMERA_MAX_DISTANCE_CM = 700.0;
const RUNTIME_STILL_WIDTH = 3200;
const RUNTIME_STILL_HEIGHT = 2400;
// Capture runs ~1/s; collapse the per-frame pipeline trace into a periodic summary.
const PIPELINE_LOG_INTERVAL_S = 2.0;
const STILL_TIMING_LOG_INTERVAL_S = 1.0;
const MAX_STILL_WINDOW_ANGULAR_DELTA_DEG = 3.0;
const MAX_STILL_WINDOW_LINEAR_DELTA_CM = 5.0;
// Set to true to re-enable steady-state pipeline summary logs for deep debugging.
const DEBUG_VERBOSE = false;

type CaptureMode = "off" | "setup" | "runtime";

interface PoseSample {
  t: number;
  position: vec3;
  rotation: quat;
}

interface StillCaptureTimestampResolution {
  captureTs: number;
  source: "frame_timestamp_seconds" | "frame_timestamp_millis" | "midpoint_fallback";
}

interface HeadMotionWindow {
  angularDeg: number;
  linearCm: number;
}

@component
export class FrameCaptureController extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  cameraObject: SceneObject;

  private _cameraModule: CameraModule = require("LensStudio:CameraModule");
  private _deviceCamera: DeviceCamera | null = null;
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
  private _lastStillTimingLogTime = 0;
  private _runtimeStillErrorLogged = false;
  private _runtimeStillTimestampFallbackLogged = false;

  // Camera-stream state
  private _cameraTexture: Texture | null = null;
  private _cameraTextureProvider: CameraTextureProvider | null = null;
  private _frameRegistration: EventRegistration | null = null;
  private _captureRequested = false;
  private _latestFrameTs = 0;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._deviceCamera = global.deviceInfoSystem.getTrackingCameraForId(
        CameraModule.CameraId.Default_Color,
      );
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
    this._captureRequested = false;
    this._sentCameraInfo = false;
    this._lastStillTimingLogTime = 0;
    this._runtimeStillErrorLogged = false;
    this._runtimeStillTimestampFallbackLogged = false;
    if (mode === "off") {
      this._inFlight = false;
      this._inFlightSeq = -1;
      this._stopCameraStream();
    } else {
      if (mode === "setup") {
        this._ensureCameraStream();
      } else {
        this._stopCameraStream();
      }
    }
    // Reset pacing so the first capture in the new mode fires promptly
    // (within one interval), not after a potentially stale gap from the old mode.
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

  private _onHello = (): void => {
    this._inFlight = false;
    this._inFlightSeq = -1;
    // Reset so camera_info is re-sent on the next capture with the live texture dimensions.
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
      this._mode === "setup" ? SETUP_CAPTURE_INTERVAL_S : RUNTIME_CAPTURE_INTERVAL_S;
    // Idle-gap pacing: measure from the end of the last pipeline, not its start.
    if (now - this._lastPipelineEndTime < interval) {
      return;
    }
    if (this._headAngularVelocityDegS() > MAX_HEAD_ANGULAR_VEL_DEG_S) {
      return;
    }
    if (this._mode === "setup") {
      // Signal the onNewFrame handler to grab the next available stream frame.
      this._captureRequested = true;
      return;
    }
    this._captureStill().catch((err) => {
      print("FrameCaptureController: still capture error: " + String(err));
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

  private _ensureCameraStream(): void {
    if (this._cameraTexture !== null) {
      return;
    }
    const cameraRequest = CameraModule.createCameraRequest();
    cameraRequest.cameraId = CameraModule.CameraId.Default_Color;
    this._cameraTexture = this._cameraModule.requestCamera(cameraRequest);
    this._cameraTextureProvider = this._cameraTexture.control as CameraTextureProvider;
    this._frameRegistration = this._cameraTextureProvider.onNewFrame.add(
      (frame: CameraFrame) => this._onNewFrame(frame),
    );
    print("FrameCaptureController: camera stream started");
  }

  private _stopCameraStream(): void {
    // Spectacles has no explicit stopCamera; unsubscribe the handler and null refs.
    // The underlying stream will be GC'd when no references remain.
    if (this._frameRegistration !== null && this._cameraTextureProvider !== null) {
      this._cameraTextureProvider.onNewFrame.remove(this._frameRegistration);
      this._frameRegistration = null;
      this._cameraTextureProvider = null;
      this._cameraTexture = null;
      print("FrameCaptureController: camera stream stopped");
    } else {
      this._cameraTextureProvider = null;
      this._cameraTexture = null;
    }
  }

  private _onNewFrame(frame: CameraFrame): void {
    // Always update the latest timestamp from the live stream.
    // CameraFrame.timestampSeconds is the frame capture time in scene seconds.
    const frameTs = frame.timestampSeconds;
    this._latestFrameTs = typeof frameTs === "number" && frameTs > 0
      ? frameTs
      : getTime();

    if (!this._captureRequested || this._pipelineBusy || this._mode === "off") {
      return;
    }
    if (!this._cameraTexture || !this.bridgeClient?.isConnected()) {
      return;
    }

    this._captureRequested = false;
    this._captureFromStream(this._cameraTexture, this._latestFrameTs).catch((err) => {
      print("FrameCaptureController: capture error: " + String(err));
    });
  }

  private async _captureFromStream(texture: Texture, captureTs: number): Promise<void> {
    const robotId = this.bridgeClient?.activeRobotId;
    if (!robotId || !this._deviceCamera) {
      return;
    }
    const seq = this._beginPipeline();
    const pipelineStart = getTime();
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
    } finally {
      this._pipelineBusy = false;
    }
  }

  private async _captureStill(): Promise<void> {
    const robotId = this.bridgeClient?.activeRobotId;
    if (!robotId || !this._deviceCamera) {
      return;
    }
    const seq = this._beginPipeline();
    const pipelineStart = getTime();
    try {
      const request = CameraModule.createImageRequest();
      request.resolution = new vec2(RUNTIME_STILL_WIDTH, RUNTIME_STILL_HEIGHT);
      const requestStartTs = getTime();
      const imageFrame = await this._cameraModule.requestImage(request);
      const resolveTs = getTime();
      const timestampResolution = this._resolveStillCaptureTimestamp(
        imageFrame,
        requestStartTs,
        resolveTs,
      );
      const headMotionWindow = this._measureHeadMotionWindow(
        requestStartTs,
        resolveTs,
      );
      const droppedForMotion = this._shouldDropStillForHeadMotion(
        headMotionWindow,
      );
      this._maybeLogStillTiming({
        latencyMs: Math.round((resolveTs - requestStartTs) * 1000.0),
        headMotionWindow,
        captureTsSource: timestampResolution.source,
        droppedForMotion,
      });
      if (droppedForMotion) {
        this._finishPipelineWithoutAck(seq);
        return;
      }
      await this._sendCapturedFrame({
        texture: imageFrame.texture,
        captureTs: timestampResolution.captureTs,
        robotId,
        seq,
        pipelineStart,
      });
    } catch (error) {
      this._finishPipelineWithoutAck(seq);
      const message = String(error);
      if (!this._runtimeStillErrorLogged) {
        this._runtimeStillErrorLogged = true;
        print("FrameCaptureController: runtime still capture unavailable: " + message);
        if (this._onCaptureError) {
          this._onCaptureError(message);
        }
      }
    } finally {
      this._pipelineBusy = false;
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
    const camPose = this._cameraWorldPose(pose);
    if (!this._sentCameraInfo) {
      this._sendCameraInfo(args.texture);
    }
    const jpegBytes = await this._encodeJpeg(args.texture);
    const bytes = buildCameraFrameBytes({
      robotId: args.robotId,
      seq: args.seq,
      ts: args.captureTs,
      sendTs: getTime(),
      camPos: camPose.position,
      camRot: camPose.rotation,
      jpegBytes,
    });
    this.bridgeClient.sendBinary(bytes);
    if (DEBUG_VERBOSE) {
      const now = getTime();
      if (now - this._lastPipelineLogTime >= PIPELINE_LOG_INTERVAL_S) {
        this._lastPipelineLogTime = now;
        const pipelineMs = Math.round((now - args.pipelineStart) * 1000);
        print(
          `FrameCaptureController: seq=${args.seq} pipeline=${pipelineMs}ms jpeg=${jpegBytes.byteLength}B`,
        );
      }
    }
  }

  private _resolveStillCaptureTimestamp(
    imageFrame: ImageFrame,
    requestStartTs: number,
    resolveTs: number,
  ): StillCaptureTimestampResolution {
    const frameWithTimestamp = imageFrame as ImageFrame & {
      timestampMillis?: unknown;
      timestampSeconds?: unknown;
    };
    const rawTimestampSeconds = frameWithTimestamp.timestampSeconds;
    if (
      typeof rawTimestampSeconds === "number" &&
      Number.isFinite(rawTimestampSeconds) &&
      rawTimestampSeconds > 0
    ) {
      return {
        captureTs: rawTimestampSeconds,
        source: "frame_timestamp_seconds",
      };
    }
    const rawTimestampMillis = frameWithTimestamp.timestampMillis;
    if (
      typeof rawTimestampMillis === "number" &&
      Number.isFinite(rawTimestampMillis) &&
      rawTimestampMillis > 0
    ) {
      return {
        captureTs: rawTimestampMillis / 1000,
        source: "frame_timestamp_millis",
      };
    }
    // Some Spectacles builds expose ImageFrame.texture but not a usable
    // timestamp field. In that case the midpoint of the still-request window is
    // the best available capture-time estimate to keep pose lookup and bridge
    // headers closer to the actual photo time.
    if (!this._runtimeStillTimestampFallbackLogged) {
      this._runtimeStillTimestampFallbackLogged = true;
      print(
        "FrameCaptureController: ImageFrame timestamp unavailable; using still request midpoint fallback",
      );
    }
    return {
      captureTs: (requestStartTs + resolveTs) * 0.5,
      source: "midpoint_fallback",
    };
  }

  private _measureHeadMotionWindow(
    startTs: number,
    endTs: number,
  ): HeadMotionWindow | null {
    const startPose = this._lookupPose(startTs);
    const endPose = this._lookupPose(endTs);
    if (!startPose || !endPose) {
      return null;
    }
    const dot = Math.abs(startPose.rotation.dot(endPose.rotation));
    const clampedDot = Math.min(1, Math.max(0, dot));
    const angleRad = 2 * Math.acos(clampedDot);
    return {
      angularDeg: (angleRad * 180.0) / Math.PI,
      linearCm: startPose.position.distance(endPose.position),
    };
  }

  private _shouldDropStillForHeadMotion(
    headMotionWindow: HeadMotionWindow | null,
  ): boolean {
    return headMotionWindow !== null && (
      headMotionWindow.angularDeg > MAX_STILL_WINDOW_ANGULAR_DELTA_DEG ||
      headMotionWindow.linearCm > MAX_STILL_WINDOW_LINEAR_DELTA_CM
    );
  }

  private _maybeLogStillTiming(args: {
    latencyMs: number;
    headMotionWindow: HeadMotionWindow | null;
    captureTsSource: StillCaptureTimestampResolution["source"];
    droppedForMotion: boolean;
  }): void {
    const now = getTime();
    if (
      this._lastStillTimingLogTime !== 0 &&
      now - this._lastStillTimingLogTime < STILL_TIMING_LOG_INTERVAL_S
    ) {
      return;
    }
    this._lastStillTimingLogTime = now;
    const headAngularText = args.headMotionWindow
      ? args.headMotionWindow.angularDeg.toFixed(2)
      : "n/a";
    const headLinearText = args.headMotionWindow
      ? args.headMotionWindow.linearCm.toFixed(2)
      : "n/a";
    print(
      `FrameCaptureController: stillWindow latencyMs=${args.latencyMs} headAngularDeg=${headAngularText} headLinearCm=${headLinearText} captureTsSource=${args.captureTsSource} dropped=${args.droppedForMotion}`,
    );
  }

  private _sendCameraInfo(frameTexture: Texture): void {
    if (!this._deviceCamera || !this.bridgeClient) {
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
    const nativeRes = this._deviceCamera.resolution;
    const scaleX = nativeRes.x > 0 ? frameWidth / nativeRes.x : 1.0;
    const scaleY = nativeRes.y > 0 ? frameHeight / nativeRes.y : 1.0;
    const fx = this._deviceCamera.focalLength.x * scaleX;
    const fy = this._deviceCamera.focalLength.y * scaleY;
    const cx = this._deviceCamera.principalPoint.x * scaleX;
    const cy = this._deviceCamera.principalPoint.y * scaleY;
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
    if (!this._deviceCamera) {
      return { position: devicePose.position, rotation: devicePose.rotation };
    }
    // DeviceCamera.pose is T_device_camera on Spectacles: converts camera-space
    // points to device-center space. Composing with devicePose gives T_world_camera.
    const extrinsic = this._deviceCamera.pose;
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
