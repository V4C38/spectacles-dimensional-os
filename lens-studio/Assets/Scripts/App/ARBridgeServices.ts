import { ARBridgeSession } from "../ARBridge/Network/ARBridgeSession";
import { FrameCaptureController } from "../ARBridge/Camera/FrameCaptureController";
import {
  RegistrationClient,
  RegistrationClientDeps,
} from "../ARBridge/Registration/RegistrationClient";
import { InboundRouter } from "../ARBridge/Session/InboundRouter";
import { AppStateStore } from "./AppState";
import { NavigationController } from "./Navigation/NavigationController";
import { RobotPresenter, RobotPresenterMenuCallbacks } from "./Robot/RobotPresenter";
import { RegistrationPreviewPresenter } from "./Registration/RegistrationWizardView";
import { PointCloudRenderer } from "./Lidar/PointCloudRenderer";
import { RobotMarker } from "./Robot/RobotMarker";
import { StatusClient } from "../ARBridge/Status/StatusClient";
import { TelemetryClient } from "../ARBridge/Telemetry/TelemetryClient";
import { NavigationClient } from "../ARBridge/Navigation/NavigationClient";
import { AgentClient } from "../ARBridge/Agent/AgentClient";

/** Scene wiring hub and Lens event host for AR bridge runtime plain service classes. */
@component
export class ARBridgeServices extends BaseScriptComponent {
  @input
  bridgeSession: ARBridgeSession;

  @input
  frameCaptureController: FrameCaptureController;

  @input
  robotMarker: RobotMarker;

  @input
  pointCloudRenderer: PointCloudRenderer;

  @input
  navigationMarkerPrefab: ObjectPrefab;

  @input
  deviceTracking: DeviceTracking;

  @input
  worldMeshObject: SceneObject;

  @input
  worldMeshVisual: RenderMeshVisual;

  @input
  robotGroundDeadzoneRadiusCm = 75;

  private _state: AppStateStore | null = null;
  private _robot: RobotPresenter | null = null;
  private _navigation: NavigationController | null = null;
  private _router: InboundRouter | null = null;
  private _registration: RegistrationClient | null = null;
  private _status: StatusClient | null = null;
  private _telemetry: TelemetryClient | null = null;
  private _navClient: NavigationClient | null = null;
  private _agentClient: AgentClient | null = null;
  private _registrationPreview: RegistrationPreviewPresenter | null = null;
  private _bound = false;

  public get state(): AppStateStore {
    this._ensureInstances();
    return this._state!;
  }

  public get robot(): RobotPresenter {
    this._ensureInstances();
    return this._robot!;
  }

  public get navigation(): NavigationController {
    this._ensureInstances();
    return this._navigation!;
  }

  public get router(): InboundRouter {
    this._ensureInstances();
    return this._router!;
  }

  public get registration(): RegistrationClient {
    this._ensureInstances();
    return this._registration!;
  }

  public get registrationPreview(): RegistrationPreviewPresenter {
    this._ensureInstances();
    return this._registrationPreview!;
  }

  public get telemetry(): TelemetryClient {
    this._ensureInstances();
    return this._telemetry!;
  }

  public get agent(): AgentClient {
    this._ensureInstances();
    return this._agentClient!;
  }

  public bind(
    robotMenuCallbacks: RobotPresenterMenuCallbacks,
    registrationDeps: RegistrationClientDeps,
  ): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._ensureInstances();

    this._robot!.bind(robotMenuCallbacks);
    this._navigation!.bindHost({
      appStateStore: this._state!,
      robotPresenter: this._robot!,
    });
    this._registration!.initialize(registrationDeps);
    this._router!.bind();
    this.frameCaptureController?.bind({
      registrationClient: this._registration!,
      telemetryClient: this._telemetry!,
      inboundRouter: this._router!,
      statusClient: this._status!,
      uiLogger: this._state!.uiLogger,
      getBridgeConnected: () => this._router!.isBridgeSessionReady(),
      getWorldFrameCommitted: () => {
        const snapshot = this._state!.snapshot;
        return (
          snapshot.phase === "runtime" &&
          snapshot.bridgeSnapshot.worldFrameCommitted
        );
      },
    });

    this.createEvent("UpdateEvent").bind(() => {
      this._router!.tick();
    });
  }

  private _ensureInstances(): void {
    if (this._state) {
      return;
    }
    const session = this.bridgeSession ?? null;
    const transport = session?.transport ?? null;
    const inbound = session?.inbound ?? null;

    this._state = new AppStateStore();
    this._status = new StatusClient(session, transport, inbound);
    this._telemetry = new TelemetryClient(this._state, session, transport, inbound);
    this._navClient = new NavigationClient(transport, inbound);
    this._agentClient = new AgentClient(this, transport, inbound);
    this._robot = new RobotPresenter(
      this._state,
      this.robotMarker ?? null,
      this.pointCloudRenderer ?? null,
      session,
      this._telemetry,
    );
    this._registration = new RegistrationClient(
      session,
      transport,
      inbound,
      this.robotMarker ?? null,
    );
    this._registrationPreview = new RegistrationPreviewPresenter(
      this._state,
      this._robot,
    );
    this._navigation = NavigationController.create({
      eventHost: this,
      pathParentFallback: this.getSceneObject(),
      appStateStore: this._state,
      navClient: this._navClient,
      session,
      statusClient: this._status,
      robotPresenter: this._robot,
      robotMarker: this.robotMarker ?? null,
      navigationMarkerPrefab: this.navigationMarkerPrefab,
      robotGroundDeadzoneRadiusCm: this.robotGroundDeadzoneRadiusCm,
      deviceTracking: this.deviceTracking,
      worldMeshObject: this.worldMeshObject,
      worldMeshVisual: this.worldMeshVisual,
    });
    this._router = new InboundRouter(
      session,
      this._state,
      this._status,
      this._telemetry,
      this._navClient,
      this._agentClient,
      this._navigation,
      this._robot,
      this._registration,
    );
  }
}
