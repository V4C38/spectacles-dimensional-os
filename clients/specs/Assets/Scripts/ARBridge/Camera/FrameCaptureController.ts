import { ARBridgeSession } from "../Network/ARBridgeSession";
import { InboundRouter } from "../Session/InboundRouter";
import { StatusClient } from "../Status/StatusClient";
import { TelemetryClient } from "../Telemetry/TelemetryClient";
import { protocolMetersToLensCentimeters } from "../Network/Protocol";
import { RegistrationClient } from "../Registration/RegistrationClient";
import { CameraClient } from "./CameraClient";
import {
  CameraCaptureSession,
  CameraCaptureState,
  deriveCameraCapture,
  evaluateOptionalGeometricGates,
  evaluateOptionalSpeedGate,
  isActiveCaptureState,
} from "./CameraCaptureSession";
import { DeviceCameraStream } from "./DeviceCameraStream";
import { UILogger } from "../../App/UI/UILogger";

export interface FrameCaptureControllerDeps {
  registrationClient: RegistrationClient;
  telemetryClient: TelemetryClient;
  inboundRouter: InboundRouter;
  statusClient: StatusClient;
  uiLogger: UILogger;
  getBridgeConnected: () => boolean;
  getWorldFrameCommitted: () => boolean;
}

/** @component Scene inputs for camera capture; wire pipeline lives in CameraClient. */
@component
export class FrameCaptureController extends BaseScriptComponent {
  @input
  bridgeSession: ARBridgeSession;

  @input
  cameraObject: SceneObject;

  private _client: CameraClient | null = null;
  private _camera: DeviceCameraStream | null = null;
  private _session = new CameraCaptureSession();
  private _captureState: CameraCaptureState = "off";
  private _robotWorldPos: vec3 | null = null;
  private _lastSpeedMps: number | null = null;
  private _deps: FrameCaptureControllerDeps | null = null;
  private _bound = false;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._camera = DeviceCameraStream.getInstance();
      this._client = new CameraClient({
        session: this.bridgeSession ?? null,
        camera: this._camera,
        getCameraObject: () => this.cameraObject,
      });
      this._client.setOnFrameAck((msg) => {
        this._session.onFrameAck(msg);
      });
      this._client.bindInbound();
      this.createEvent("UpdateEvent").bind(() => {
        this._syncCameraCapture();
      });
    });
  }

  public bind(deps: FrameCaptureControllerDeps): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._deps = deps;

    deps.registrationClient.onRegistrationStatus.add((msg) => {
      if (msg.preview_pose) {
        this._robotWorldPos = protocolMetersToLensCentimeters(msg.preview_pose.position);
      }
      if (msg.state === "april_tag" && msg.mode === "april_tag") {
        this._lastSpeedMps = null;
        if (!msg.preview_pose) {
          this._robotWorldPos = null;
        }
        this._session.endCameraCapture();
        this._session.beginCameraCapture();
        this._client?.resetCapturePipeline();
      } else if (
        msg.state === "succeeded" ||
        msg.state === "failed" ||
        msg.state === "idle"
      ) {
        this._session.endCameraCapture();
      }
    });

    deps.statusClient.onCapturePolicy.add((policy) => {
      this._session.applyPolicy(policy);
    });

    deps.telemetryClient.onPose.add((msg) => {
      this._robotWorldPos = protocolMetersToLensCentimeters(msg.position);
      const speed = msg.speed_mps ?? null;
      if (deps.getWorldFrameCommitted()) {
        this._session.onSpeedChanged(this._lastSpeedMps, speed);
      }
      this._lastSpeedMps = speed;
    });

    deps.inboundRouter.onBridgeConnectionChanged.add((connected) => {
      if (!connected) {
        this._applyCapture(this._captureState, "off");
        this._captureState = "off";
        this._session.endCameraCapture();
        this._lastSpeedMps = null;
        this._robotWorldPos = null;
        this._client?.resetCapturePipeline();
      }
    });
  }

  public unbind(): void {
    this._bound = false;
    this._deps = null;
  }

  public setCaptureErrorHandler(handler: (message: string) => void): void {
    this._client?.setCaptureErrorHandler(handler);
  }

  public endCameraCaptureSession(): void {
    if (this._captureState !== "off") {
      this._applyCapture(this._captureState, "off");
    }
    this._captureState = "off";
    this._session.endCameraCapture();
    this._lastSpeedMps = null;
    this._robotWorldPos = null;
    this._client?.resetCapturePipeline();
    this._deps?.uiLogger.setCameraCaptureState("off");
  }

  private _syncCameraCapture(): void {
    const client = this._client;
    const camera = this._camera;
    if (!client || !camera) {
      return;
    }

    const bridgeConnected = this._deps?.getBridgeConnected() ?? false;
    const worldFrameCommitted = this._deps?.getWorldFrameCommitted() ?? false;
    const cameraObject = this.cameraObject;
    let cameraPos: vec3 | null = null;
    let cameraRot: quat | null = null;
    if (cameraObject) {
      const transform = cameraObject.getTransform();
      cameraPos = transform.getWorldPosition();
      cameraRot = transform.getWorldRotation();
    }

    const cameraReady = cameraPos !== null && cameraRot !== null;
    const distanceGate = this._session.getDistanceGateCm();
    const runtimePolicyReady = !worldFrameCommitted || this._session.policyApplied;
    const geometricGatesPass =
      runtimePolicyReady &&
      (!cameraReady ||
        evaluateOptionalGeometricGates(
          cameraPos!,
          cameraRot!,
          worldFrameCommitted ? this._robotWorldPos : null,
          distanceGate.minDistanceCm,
          distanceGate.maxDistanceCm,
          this._session.policyApplied,
        ));
    const speedGatePass = evaluateOptionalSpeedGate(
      this._lastSpeedMps,
      this._session.maxSpeedMps,
      this._session.policyApplied,
    );

    const gates = {
      bridgeConnected,
      posesReady: cameraReady,
      geometricGatesPass,
      speedGatePass,
      hasInFlightCapture: client.hasInFlightCapture(),
    };

    this._session.updateGateDebounce(gates, getTime());
    const nextState = deriveCameraCapture(this._session.getFacts(), gates, getTime());
    this._session.updatePendingDrain(nextState, gates.hasInFlightCapture);
    const resolvedState = deriveCameraCapture(
      this._session.getFacts(),
      gates,
      getTime(),
    );

    if (resolvedState !== this._captureState) {
      this._applyCapture(this._captureState, resolvedState);
      this._captureState = resolvedState;
    }

    this._deps?.uiLogger.setCameraCaptureState(resolvedState);

    const pipelineEnabled =
      isActiveCaptureState(resolvedState) ||
      (this._session.getFacts().pendingDrain && gates.hasInFlightCapture);
    client.setCaptureEnabled(pipelineEnabled);
    if (isActiveCaptureState(resolvedState)) {
      client.recordPose();
      client.tick();
    }
  }

  private _applyCapture(prev: CameraCaptureState, next: CameraCaptureState): void {
    const camera = this._camera;
    const client = this._client;
    if (!camera || !client) {
      return;
    }

    const wasActive = isActiveCaptureState(prev);
    const isActive = isActiveCaptureState(next);

    if (isActive && !wasActive) {
      camera.start();
      this._logCaptureTransition(next, true, this._startReason());
      return;
    }

    if (!isActive && wasActive) {
      camera.stop();
      if (next === "off") {
        client.resetCapturePipeline();
        this._logCaptureTransition(next, false, this._lifecycleStopReason());
      } else {
        client.prepareForHardwarePause();
        this._logCaptureTransition(next, false, "gate_pause");
      }
      return;
    }

    if (!isActive && next === "off" && prev !== "off") {
      client.resetCapturePipeline();
      this._logCaptureTransition(next, false, this._lifecycleStopReason());
    }
  }

  private _startReason(): string {
    const worldFrameCommitted = this._deps?.getWorldFrameCommitted() ?? false;
    if (!worldFrameCommitted) {
      return "registration";
    }
    if ((this._session.obsBudget ?? 0) > 0) {
      return "stop_refine";
    }
    return "motion";
  }

  private _lifecycleStopReason(): string {
    const worldFrameCommitted = this._deps?.getWorldFrameCommitted() ?? false;
    if (!worldFrameCommitted) {
      return "registration_end";
    }
    return "episode_complete";
  }

  private _logCaptureTransition(
    state: CameraCaptureState,
    running: boolean,
    reason: string,
  ): void {
    print(
      `FrameCaptureController: camera capture ${running ? "ON" : "OFF"} state=${state} reason=${reason}`,
    );
  }
}
