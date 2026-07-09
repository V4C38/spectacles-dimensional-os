import { ARBridgeSession } from "../Network/ARBridgeSession";
import { InboundRouter } from "../Session/InboundRouter";
import { StatusClient } from "../Status/StatusClient";
import { TelemetryClient } from "../Telemetry/TelemetryClient";
import { protocolMetersToLensCentimeters } from "../Network/Protocol";
import { RegistrationClient } from "../Registration/RegistrationClient";
import { CameraClient } from "./CameraClient";
import {
  CameraStreamSession,
  evaluateStreamGeometricGates,
  isRobotMoving,
  isRobotStopped,
  isStartingMovement,
  isStoppingMovement,
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

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._camera = DeviceCameraStream.getInstance();
      this._client = new CameraClient({
        session: this.bridgeSession ?? null,
        camera: this._camera,
        getCameraObject: () => this.cameraObject,
      });
      this._client.setOnFrameAck(() => {
        this._session.onFrameAck();
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
      this._session.requestStreamStart(0);
    });
    deps.registrationClient.onAprilTagCaptureEnd.add(() => {
      this._session.requestStreamStop();
    });

    deps.registrationClient.onRegistrationStatus.add((msg) => {
      if (msg.preview_pose) {
        this._robotWorldPos = protocolMetersToLensCentimeters(msg.preview_pose.position);
      }
    });

    deps.telemetryClient.onPose.add((msg) => {
      this._robotWorldPos = protocolMetersToLensCentimeters(msg.position);
      const speed = msg.speed_mps ?? null;
      if (this._worldFrameCommitted) {
        if (isStartingMovement(this._lastSpeedMps, speed)) {
          this._session.requestStreamStart(0);
        } else if (isStoppingMovement(this._lastSpeedMps, speed)) {
          this._session.requestStreamStart(2);
          this._client?.resetCaptureSpacingDeadline();
        }
      }
      this._lastSpeedMps = speed;
    });

    deps.inboundRouter.onBridgeConnectionChanged.add((connected) => {
      if (!connected) {
        this._session.requestStreamStop();
        this._worldFrameCommitted = false;
        this._lastSpeedMps = null;
        this._robotWorldPos = null;
      }
    });

    deps.statusClient.onBridgeStatus.add((msg) => {
      const wasCommitted = this._worldFrameCommitted;
      this._worldFrameCommitted = msg.world_frame_committed;
      if (!wasCommitted && msg.world_frame_committed) {
        this._bootstrapRuntimeStream();
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

  private _bootstrapRuntimeStream(): void {
    if (isRobotMoving(this._lastSpeedMps)) {
      this._session.requestStreamStart(0);
    } else if (isRobotStopped(this._lastSpeedMps)) {
      this._session.requestStreamStart(2);
      this._client?.resetCaptureSpacingDeadline();
    }
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

    const posesReady = cameraPos !== null && cameraRot !== null;
    const geometricGatesPass =
      posesReady &&
      evaluateStreamGeometricGates(cameraPos!, cameraRot!, this._robotWorldPos);

    const result = this._session.evaluate(
      {
        bridgeConnected,
        posesReady,
        geometricGatesPass,
      },
      getTime(),
    );

    if (result.hardwareEnabled !== this._hardwareEnabled) {
      this._hardwareEnabled = result.hardwareEnabled;
      if (result.hardwareEnabled) {
        camera.start();
        print("FrameCaptureController: camera stream ON");
        this._deps?.uiLogger.logCameraStreamStarted();
      } else {
        camera.stop();
        client.resetCapturePipeline();
        print("FrameCaptureController: camera stream OFF");
        this._deps?.uiLogger.logCameraStreamStopped();
      }
    }

    client.setCaptureEnabled(result.hardwareEnabled);
    if (result.hardwareEnabled) {
      client.recordPose();
      client.tick();
    }
  }
}
