import { ARBridgeSession } from "../Network/ARBridgeSession";
import { CameraClient } from "./CameraClient";
import {
  CameraPolicyDynamicInput,
  CameraPolicyResult,
  CameraPolicyStaticContext,
  CameraStreamOffReason,
  computeCameraPolicy,
  CaptureMode,
  CapturePolicy,
  shouldLogStreamOffReason,
} from "./CameraStreamPolicy";
import { DeviceCameraStream } from "./DeviceCameraStream";

export type { CaptureMode, CapturePolicy };

const DEFAULT_STREAM_CONTEXT: CameraPolicyStaticContext = {
  forceOff: true,
  appPhase: "registration",
  tagCaptureSessionActive: false,
  worldFrameCommitted: false,
  bridgeConnected: false,
  registrationCaptureHint: "off",
};

const STREAM_OFF_LOG_MIN_INTERVAL_S = 30.0;

/** @component Scene inputs for camera capture; wire pipeline lives in CameraClient. */
@component
export class FrameCaptureController extends BaseScriptComponent {
  @input
  bridgeSession: ARBridgeSession;

  @input
  cameraObject: SceneObject;

  private _client: CameraClient | null = null;
  private _camera: DeviceCameraStream | null = null;
  private _streamEnabled = false;
  private _appliedMode: CaptureMode = "off";
  private _appliedPolicy: CapturePolicy = "off";
  private _streamContext: CameraPolicyStaticContext = { ...DEFAULT_STREAM_CONTEXT };
  private _lastStreamOffLogTime = -STREAM_OFF_LOG_MIN_INTERVAL_S;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._camera = DeviceCameraStream.getInstance();
      this._client = new CameraClient({
        session: this.bridgeSession ?? null,
        camera: this._camera,
        getCameraObject: () => this.cameraObject,
      });
      this._client.bindInbound();
      this.createEvent("UpdateEvent").bind(() => {
        this._syncCameraStream();
      });
    });
  }

  public setCaptureErrorHandler(handler: (message: string) => void): void {
    this._client?.setCaptureErrorHandler(handler);
  }

  public setRobotWorldPosition(position: vec3 | null): void {
    this._client?.setRobotWorldPosition(position);
  }

  public setStreamPolicyContext(context: CameraPolicyStaticContext): void {
    const previous = this._streamContext;
    const shouldResetLatch =
      context.forceOff ||
      !context.bridgeConnected ||
      context.appPhase !== previous.appPhase;
    this._streamContext = { ...context };
    if (shouldResetLatch) {
      this._client?.resetStreamState();
    }
  }

  public requestImmediateCapture(): void {
    this._client?.requestImmediateCapture();
  }

  public resetCapturePipeline(): void {
    this._client?.resetCapturePipeline();
  }

  public notifyRobotSpeed(speedMps: number | null): void {
    this._client?.notifyRobotSpeed(speedMps);
  }

  public notifyWorldFrameCorrection(): void {
    this._client?.notifyWorldFrameCorrection();
  }

  private _syncCameraStream(): void {
    const policy = this._evaluatePolicy();
    this._applyPolicyResult(policy);
    if (policy.mode !== "off") {
      this._client?.recordPose();
    }
    if (policy.streamEnabled) {
      this._client?.tick();
    }
  }

  private _evaluatePolicy(): CameraPolicyResult {
    const cameraObject = this.cameraObject;
    const client = this._client;
    const dynamic: CameraPolicyDynamicInput = {
      robotWorldPos: client?.getRobotWorldPosition() ?? null,
      cameraPos: null,
      cameraRot: null,
      robotSpeedMps: client?.getRobotSpeedMps() ?? null,
      correctionSinceLastMovement: client?.getCorrectionSinceLastMovement() ?? false,
    };
    if (cameraObject) {
      const transform = cameraObject.getTransform();
      dynamic.cameraPos = transform.getWorldPosition();
      dynamic.cameraRot = transform.getWorldRotation();
    }
    return computeCameraPolicy(this._streamContext, dynamic);
  }

  private _applyPolicyResult(policy: CameraPolicyResult): void {
    if (policy.mode !== this._appliedMode) {
      this._appliedMode = policy.mode;
      this._client?.setMode(policy.mode);
    }
    if (policy.policy !== this._appliedPolicy) {
      this._appliedPolicy = policy.policy;
      this._client?.setCapturePolicy(policy.policy);
    }

    if (policy.streamEnabled !== this._streamEnabled) {
      this._streamEnabled = policy.streamEnabled;
      if (policy.streamEnabled) {
        this._camera?.start();
        print("FrameCaptureController: camera stream ON");
        if (policy.mode === "runtime" || policy.mode === "registration") {
          this.requestImmediateCapture();
        }
      } else {
        this._camera?.stop();
        this._client?.resetCapturePipeline();
        this._logStreamOffTransition(policy.streamOffReason);
      }
      return;
    }
  }

  /** Log at most once per cooldown, only on stream ON→OFF transitions. */
  private _logStreamOffTransition(reason: CameraStreamOffReason | null): void {
    if (!shouldLogStreamOffReason(reason)) {
      return;
    }
    const now = getTime();
    if (now - this._lastStreamOffLogTime < STREAM_OFF_LOG_MIN_INTERVAL_S) {
      return;
    }
    this._lastStreamOffLogTime = now;
    print(`FrameCaptureController: camera stream OFF (${reason})`);
  }
}
