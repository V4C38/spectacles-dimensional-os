import { ARBridgeSession } from "../Network/ARBridgeSession";
import { InboundRouter } from "../Session/InboundRouter";
import { StatusClient } from "../Status/StatusClient";
import { TelemetryClient } from "../Telemetry/TelemetryClient";
import { protocolMetersToLensCentimeters } from "../Network/Protocol";
import { RegistrationClient } from "../Registration/RegistrationClient";
import { CameraClient } from "./CameraClient";
import {
  CameraStreamSession,
  CapturePhase,
  cameraStreamLogStatus,
  evaluateOptionalGeometricGates,
  evaluateOptionalSpeedGate,
  resolveHardwareTransition,
} from "./CameraStreamSession";
import { DeviceCameraStream } from "./DeviceCameraStream";
import { UILogger } from "../../App/UI/UILogger";

export interface FrameCaptureControllerDeps {
  registrationClient: RegistrationClient;
  telemetryClient: TelemetryClient;
  inboundRouter: InboundRouter;
  statusClient: StatusClient;
  uiLogger: UILogger;
  getBridgeConnected: () => boolean;
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
  private _session = new CameraStreamSession();
  private _hardwareEnabled = false;
  private _robotWorldPos: vec3 | null = null;
  private _worldFrameCommitted = false;
  private _lastSpeedMps: number | null = null;
  private _deps: FrameCaptureControllerDeps | null = null;
  private _bound = false;
  private _pendingHardwareOff = false;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._camera = DeviceCameraStream.getInstance();
      this._client = new CameraClient({
        session: this.bridgeSession ?? null,
        camera: this._camera,
        getCameraObject: () => this.cameraObject,
      });
      this._client.setOnFrameAck((obsAdded, refinementComplete) => {
        this._session.onFrameAck(obsAdded, refinementComplete);
      });
      this._client.bindInbound();
      this.createEvent("UpdateEvent").bind(() => {
        this._syncCameraStream();
      });
    });
  }

  public bind(deps: FrameCaptureControllerDeps): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._deps = deps;

    deps.registrationClient.onAprilTagCaptureStart.add(() => {
      this._session.startRegistration();
    });
    deps.registrationClient.onAprilTagCaptureEnd.add(() => {
      this._session.requestStreamStop();
    });

    deps.registrationClient.onRegistrationStatus.add((msg) => {
      if (msg.preview_pose) {
        this._robotWorldPos = protocolMetersToLensCentimeters(msg.preview_pose.position);
      }
    });

    deps.statusClient.onCapturePolicy.add((policy) => {
      this._session.applyPolicy(policy);
    });

    deps.telemetryClient.onPose.add((msg) => {
      this._robotWorldPos = protocolMetersToLensCentimeters(msg.position);
      const speed = msg.speed_mps ?? null;
      if (this._worldFrameCommitted) {
        this._session.onSpeedChanged(this._lastSpeedMps, speed);
      }
      this._lastSpeedMps = speed;
    });

    deps.inboundRouter.onBridgeConnectionChanged.add((connected) => {
      if (!connected) {
        this._session.requestStreamStop();
        this._worldFrameCommitted = false;
        this._lastSpeedMps = null;
        this._robotWorldPos = null;
        this._pendingHardwareOff = false;
        this._stopHardwareIfRunning("disconnect", true);
      }
    });

    deps.statusClient.onBridgeStatus.add((msg) => {
      this._worldFrameCommitted = msg.world_frame_committed;
    });
  }

  public unbind(): void {
    this._bound = false;
    this._deps = null;
  }

  public setCaptureErrorHandler(handler: (message: string) => void): void {
    this._client?.setCaptureErrorHandler(handler);
  }

  private _syncCameraStream(): void {
    const client = this._client;
    const camera = this._camera;
    if (!client || !camera) {
      return;
    }

    const bridgeConnected = this._deps?.getBridgeConnected() ?? false;
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
    const runtimePolicyReady = !this._worldFrameCommitted || this._session.policyApplied;
    const geometricGatesPass =
      runtimePolicyReady && (!cameraReady ||
      evaluateOptionalGeometricGates(
        cameraPos!,
        cameraRot!,
        this._worldFrameCommitted ? this._robotWorldPos : null,
        distanceGate.minDistanceCm,
        distanceGate.maxDistanceCm,
        this._session.policyApplied,
      ));
    const speedGatePass = evaluateOptionalSpeedGate(
      this._lastSpeedMps,
      this._session.maxSpeedMps,
      this._session.policyApplied,
    );

    const result = this._session.evaluate(
      {
        bridgeConnected,
        posesReady: cameraReady,
        geometricGatesPass,
        speedGatePass,
      },
      getTime(),
    );

    const transition = resolveHardwareTransition({
      evalHardwareEnabled: result.hardwareEnabled,
      requestActive: result.requestActive,
      hardwareCurrentlyEnabled: this._hardwareEnabled,
      pendingHardwareOff: this._pendingHardwareOff,
      hasInFlightCapture: client.hasInFlightCapture(),
    });
    this._pendingHardwareOff = transition.nextPendingHardwareOff;

    if (transition.targetHardwareEnabled !== this._hardwareEnabled) {
      if (transition.targetHardwareEnabled) {
        this._startHardware(this._hardwareStartReason(result));
      } else {
        this._stopHardware(
          transition.stopIsLifecycleEnd
            ? this._lifecycleStopReason()
            : "gate_pause",
          transition.stopIsLifecycleEnd,
        );
      }
      this._hardwareEnabled = transition.targetHardwareEnabled;
    }

    const displayStatus = cameraStreamLogStatus(
      camera.isRunning(),
      result.requestActive,
    );
    this._deps?.uiLogger.setCameraStreamStatus(displayStatus);

    client.setCaptureEnabled(transition.captureEnabled);
    if (transition.targetHardwareEnabled) {
      client.recordPose();
      client.tick();
    }
  }

  private _hardwareStartReason(result: { requestActive: boolean }): string {
    if (this._session.phase === "registration") {
      return "registration";
    }
    if (!result.requestActive) {
      return "resume";
    }
    if (this._session.phase === "tracking_motion") {
      return "motion";
    }
    if (this._session.phase === "refining_stop") {
      return "stop_refine";
    }
    return "resume";
  }

  private _lifecycleStopReason(): string {
    if (!this._worldFrameCommitted) {
      return "registration_end";
    }
    return "episode_complete";
  }

  private _startHardware(reason: string): void {
    const camera = this._camera;
    if (!camera) {
      return;
    }
    camera.start();
    this._logHardwareTransition(true, reason);
  }

  private _stopHardware(reason: string, lifecycleEnd: boolean): void {
    const camera = this._camera;
    const client = this._client;
    if (!camera || !client) {
      return;
    }
    camera.stop();
    if (lifecycleEnd) {
      client.resetCapturePipeline();
    } else {
      client.prepareForHardwarePause();
    }
    this._logHardwareTransition(false, reason);
  }

  private _stopHardwareIfRunning(reason: string, lifecycleEnd: boolean): void {
    if (!this._hardwareEnabled) {
      if (lifecycleEnd) {
        this._client?.resetCapturePipeline();
      }
      return;
    }
    this._stopHardware(reason, lifecycleEnd);
    this._hardwareEnabled = false;
  }

  private _logHardwareTransition(running: boolean, reason: string): void {
    const phase: CapturePhase = this._session.phase;
    print(
      `FrameCaptureController: camera stream ${running ? "ON" : "OFF"} phase=${phase} reason=${reason}`,
    );
  }
}
