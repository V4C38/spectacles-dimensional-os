import { BridgeClient } from "../Network/BridgeClient";
import { buildCameraFrameBytes, buildCameraInfo } from "../Network/Protocol";
import {
  CameraFrameAckMessage,
  getActiveRobotId,
} from "../Network/ProtocolTypes";

const POSE_BUFFER_CAPACITY = 180;
// Interval measured from pipeline END (ack or finally), guaranteeing idle GC time.
const SETUP_CAPTURE_INTERVAL_S = 1.0;
const RUNTIME_CAPTURE_INTERVAL_S = 3.0;
// Safety net only: ack clears _inFlight in the normal case.
const IN_FLIGHT_TIMEOUT_S = 12.0;
const MAX_HEAD_ANGULAR_VEL_DEG_S = 40.0;
const RUNTIME_MAX_DISTANCE_CM = 450.0;
const RUNTIME_MAX_ANGLE_DEG = 35.0;

type CaptureMode = "off" | "setup" | "runtime";

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
    print(`FrameCaptureController: mode ${this._mode} -> ${mode}`);
    this._mode = mode;
    if (mode === "off") {
      this._inFlight = false;
      this._inFlightSeq = -1;
      this._captureRequested = false;
      this._stopCameraStream();
    } else {
      this._ensureCameraStream();
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
    print(`FrameCaptureController: ack seq=${msg.seq} tag_detected=${msg.tag_detected} expected=${this._inFlightSeq}`);
    if (msg.seq === this._inFlightSeq) {
      this._inFlight = false;
      this._inFlightSeq = -1;
      // Idle-gap pacing: start the interval clock from ack receipt.
      this._lastPipelineEndTime = getTime();
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
    // Hard guard: never start a new encode pipeline while one is still running.
    if (this._pipelineBusy) {
      return;
    }
    const now = getTime();
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
    if (this._mode === "runtime" && !this._isRobotPlausiblyInView()) {
      return;
    }
    if (this._headAngularVelocityDegS() > MAX_HEAD_ANGULAR_VEL_DEG_S) {
      return;
    }
    // Signal the onNewFrame handler to grab the next available stream frame.
    this._captureRequested = true;
  }

  private _isRobotPlausiblyInView(): boolean {
    if (!this._robotWorldPos || !this.cameraObject) {
      return false;
    }
    const camPos = this.cameraObject.getTransform().getWorldPosition();
    const toRobot = this._robotWorldPos.sub(camPos);
    const dist = toRobot.length;
    if (dist > RUNTIME_MAX_DISTANCE_CM) {
      return false;
    }
    const forward = this.cameraObject
      .getTransform()
      .getWorldRotation()
      .multiplyVec3(new vec3(0, 0, -1));
    const angleRad = Math.acos(
      Math.max(-1, Math.min(1, forward.dot(toRobot.normalize()))),
    );
    return (angleRad * 180) / Math.PI <= RUNTIME_MAX_ANGLE_DEG;
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
    }
    this._cameraTextureProvider = null;
    this._cameraTexture = null;
    print("FrameCaptureController: camera stream stopped");
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
    const robotId = getActiveRobotId();
    if (!robotId || !this._deviceCamera) {
      return;
    }
    this._pipelineBusy = true;
    this._inFlight = true;
    this._inFlightStart = getTime();
    const seq = ++this._seq;
    this._inFlightSeq = seq;
    const pipelineStart = getTime();
    print(`FrameCaptureController: seq=${seq} capture start`);
    try {
      const pose = this._lookupPose(captureTs);
      if (!pose) {
        this._inFlight = false;
        this._inFlightSeq = -1;
        return;
      }
      const camPose = this._cameraWorldPose(pose);
      if (!this._sentCameraInfo) {
        this._sendCameraInfo(texture);
      }
      print(`FrameCaptureController: seq=${seq} encode start`);
      const jpegBytes = await this._encodeJpeg(texture);
      const bytes = buildCameraFrameBytes({
        robotId,
        seq,
        ts: captureTs,
        sendTs: getTime(),
        camPos: camPose.position,
        camRot: camPose.rotation,
        jpegBytes,
      });
      this.bridgeClient.sendBinary(bytes);
      const pipelineMs = Math.round((getTime() - pipelineStart) * 1000);
      print(
        `FrameCaptureController: seq=${seq} pipeline=${pipelineMs}ms jpeg=${jpegBytes.byteLength}B`,
      );
    } catch (error) {
      this._inFlight = false;
      this._inFlightSeq = -1;
      this._lastPipelineEndTime = getTime();
      const message = String(error);
      if (this._onCaptureError) {
        this._onCaptureError(message);
      }
      print("FrameCaptureController: capture failed: " + message);
    } finally {
      this._pipelineBusy = false;
    }
  }

  private _sendCameraInfo(frameTexture: Texture): void {
    if (!this._deviceCamera || !this.bridgeClient) {
      return;
    }
    const robotId = getActiveRobotId();
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
    const offset = new vec3(
      this._deviceCamera.pose.column3.x,
      this._deviceCamera.pose.column3.y,
      this._deviceCamera.pose.column3.z,
    );
    const worldOffset = devicePose.rotation.multiplyVec3(offset);
    return {
      position: devicePose.position.add(worldOffset),
      rotation: devicePose.rotation,
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
