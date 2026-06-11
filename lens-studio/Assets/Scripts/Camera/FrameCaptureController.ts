import { BridgeClient } from "../Network/BridgeClient";
import { buildCameraFrameBytes, buildCameraInfo } from "../Network/Protocol";
import {
  CameraFrameAckMessage,
  getActiveRobotId,
} from "../Network/ProtocolTypes";

const POSE_BUFFER_CAPACITY = 180;
const SETUP_CAPTURE_INTERVAL_S = 0.7;
const RUNTIME_CAPTURE_INTERVAL_S = 1.0;
const RUNTIME_TRACKING_INTERVAL_S = 4.0;
const RUNTIME_TRACKING_WINDOW_S = 3.0;
const IN_FLIGHT_TIMEOUT_S = 2.0;
const MAX_HEAD_ANGULAR_VEL_DEG_S = 40.0;
const RUNTIME_MAX_DISTANCE_CM = 450.0;
const RUNTIME_MAX_ANGLE_DEG = 35.0;
const DEFAULT_STILL_WIDTH = 3200;
const DEFAULT_STILL_HEIGHT = 2400;

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
  private _lastCaptureTime = 0;
  private _poseBuffer: PoseSample[] = [];
  private _updateEvent: SceneEvent | null = null;
  private _helloBound = false;
  private _robotWorldPos: vec3 | null = null;
  private _sentCameraInfo = false;
  private _sentResolution: { w: number; h: number } | null = null;
  private _onCaptureError: ((message: string) => void) | null = null;
  private _lastRuntimeTagAckTime = 0;

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
    this._mode = mode;
    if (mode === "off") {
      this._inFlight = false;
      this._inFlightSeq = -1;
      this._lastRuntimeTagAckTime = 0;
    }
  }

  private _bindBridge(): void {
    if (this._helloBound || !this.bridgeClient) {
      return;
    }
    this.bridgeClient.ensureEventHandlers();
    this.bridgeClient.onHello.push(this._onHello);
    this.bridgeClient.onCameraFrameAck.push(this._onCameraFrameAck);
    this._helloBound = true;
  }

  private _onHello = (): void => {
    this._inFlight = false;
    this._inFlightSeq = -1;
    this._sentCameraInfo = false;
    this._sendCameraInfo(DEFAULT_STILL_WIDTH, DEFAULT_STILL_HEIGHT);
  };

  private _onCameraFrameAck = (msg: CameraFrameAckMessage): void => {
    if (msg.seq === this._inFlightSeq) {
      this._inFlight = false;
      this._inFlightSeq = -1;
    }
    if (this._mode === "runtime" && msg.tag_detected) {
      this._lastRuntimeTagAckTime = getTime();
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
    if (this._inFlight) {
      if (now - this._inFlightStart > IN_FLIGHT_TIMEOUT_S) {
        this._inFlight = false;
        this._inFlightSeq = -1;
      } else {
        return;
      }
    }
    let interval: number;
    if (this._mode === "setup") {
      interval = SETUP_CAPTURE_INTERVAL_S;
    } else if (
      now - this._lastRuntimeTagAckTime <= RUNTIME_TRACKING_WINDOW_S
    ) {
      interval = RUNTIME_TRACKING_INTERVAL_S;
    } else {
      interval = RUNTIME_CAPTURE_INTERVAL_S;
    }
    if (now - this._lastCaptureTime < interval) {
      return;
    }
    if (this._mode === "runtime" && !this._isRobotPlausiblyInView()) {
      return;
    }
    if (this._headAngularVelocityDegS() > MAX_HEAD_ANGULAR_VEL_DEG_S) {
      return;
    }
    this._lastCaptureTime = now;
    this._captureStill();
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

  private async _captureStill(): Promise<void> {
    const robotId = getActiveRobotId();
    if (!robotId || !this._deviceCamera) {
      return;
    }
    this._inFlight = true;
    this._inFlightStart = getTime();
    const seq = ++this._seq;
    this._inFlightSeq = seq;
    try {
      const imageRequest = CameraModule.createImageRequest();
      (imageRequest as { cameraId?: number }).cameraId =
        CameraModule.CameraId.Default_Color;
      const imageFrame = await this._cameraModule.requestImage(imageRequest);
      const texture = imageFrame.texture;
      if (!texture) {
        throw new Error("No texture from still capture");
      }
      const captureTs = getTime();
      const pose = this._lookupPose(captureTs);
      if (!pose) {
        this._inFlight = false;
        return;
      }
      const width = texture.getWidth();
      const height = texture.getHeight();
      if (
        !this._sentCameraInfo ||
        (this._sentResolution &&
          (this._sentResolution.w !== width || this._sentResolution.h !== height))
      ) {
        this._sendCameraInfo(width, height);
      }
      const camPose = this._cameraWorldPose(pose);
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
    } catch (error) {
      this._inFlight = false;
      this._inFlightSeq = -1;
      const message = String(error);
      if (this._onCaptureError) {
        this._onCaptureError(message);
      }
      print("FrameCaptureController: capture failed: " + message);
    }
  }

  private _sendCameraInfo(width: number, height: number): void {
    if (!this._deviceCamera || !this.bridgeClient) {
      return;
    }
    const robotId = getActiveRobotId();
    if (!robotId) {
      return;
    }
    const res = this._deviceCamera.resolution;
    const sx = width / res.x;
    const sy = height / res.y;
    const fx = this._deviceCamera.focalLength.x * sx;
    const fy = this._deviceCamera.focalLength.y * sy;
    const cx = this._deviceCamera.principalPoint.x * sx;
    const cy = this._deviceCamera.principalPoint.y * sy;
    this.bridgeClient.send(
      buildCameraInfo({
        robotId,
        width,
        height,
        fx,
        fy,
        cx,
        cy,
        deviceModel: "spectacles",
      }),
    );
    this._sentCameraInfo = true;
    this._sentResolution = { w: width, h: height };
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
