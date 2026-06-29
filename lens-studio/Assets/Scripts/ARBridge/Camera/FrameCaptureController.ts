import { ARBridgeSession } from "../Network/ARBridgeSession";
import { CameraClient, CaptureMode, CapturePolicy } from "./CameraClient";
import { DeviceCameraStream } from "./DeviceCameraStream";

export type { CaptureMode, CapturePolicy };

/** @component Scene inputs for camera capture; wire pipeline lives in CameraClient. */
@component
export class FrameCaptureController extends BaseScriptComponent {
  @input
  bridgeSession: ARBridgeSession;

  @input
  cameraObject: SceneObject;

  private _client: CameraClient | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      const camera = DeviceCameraStream.getInstance();
      camera.start();
      this._client = new CameraClient({
        session: this.bridgeSession ?? null,
        camera,
        getCameraObject: () => this.cameraObject,
      });
      this._client.bindInbound();
      this.createEvent("UpdateEvent").bind(() => {
        this._client?.tick();
      });
    });
  }

  public setCaptureErrorHandler(handler: (message: string) => void): void {
    this._client?.setCaptureErrorHandler(handler);
  }

  public setRobotWorldPosition(position: vec3 | null): void {
    this._client?.setRobotWorldPosition(position);
  }

  public setMode(mode: CaptureMode): void {
    this._client?.setMode(mode);
  }

  public setCapturePolicy(policy: CapturePolicy): void {
    this._client?.setCapturePolicy(policy);
  }
}
