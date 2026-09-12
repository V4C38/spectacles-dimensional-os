import { ARBridgeSession } from "../ARBridge/Network/ARBridgeSession";
import {
  RegistrationClient,
  RegistrationClientDeps,
} from "../ARBridge/Registration/RegistrationClient";
import { InboundRouter } from "../ARBridge/Session/InboundRouter";
import { AppStateStore } from "./AppState";
import { ManualRegistrationPlacement } from "../ARBridge/Registration/ManualRegistrationPlacement";
import { RegistrationPreviewPresenter } from "./Registration/RegistrationWizardView";
import { RobotMarker } from "./Robot/RobotMarker";
import { StatusClient } from "../ARBridge/Status/StatusClient";
import { TelemetryClient } from "../ARBridge/Telemetry/TelemetryClient";
import { NavigationClient } from "../ARBridge/Navigation/NavigationClient";
import { AgentClient } from "../ARBridge/Agent/AgentClient";
import { ArSkillHandlers } from "../ARBridge/Agent/ArSkillHandlers";
import { AgentSpeechController } from "./Agent/AgentSpeechController";
import { WorldAnnotationPresenter } from "./Agent/WorldAnnotationPresenter";

/** Scene wiring hub and Lens event host for AR bridge runtime plain service classes. */
@component
export class ARBridgeServices extends BaseScriptComponent {
  @input
  bridgeSession: ARBridgeSession;

  @input
  robotMarker: RobotMarker;

  @input
  annotationMarkerPrefab: ObjectPrefab;

  private _state: AppStateStore | null = null;
  private _router: InboundRouter | null = null;
  private _registration: RegistrationClient | null = null;
  private _status: StatusClient | null = null;
  private _telemetry: TelemetryClient | null = null;
  private _navClient: NavigationClient | null = null;
  private _agentClient: AgentClient | null = null;
  private _agentSpeechController: AgentSpeechController | null = null;
  private _worldAnnotations: WorldAnnotationPresenter | null = null;
  private _registrationPreview: RegistrationPreviewPresenter | null = null;
  private _bound = false;

  public get state(): AppStateStore {
    this._ensureInstances();
    return this._state!;
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

  public get worldAnnotations(): WorldAnnotationPresenter {
    this._ensureInstances();
    return this._worldAnnotations!;
  }

  public bind(
    registrationDeps: Omit<RegistrationClientDeps, "manualRegistrationPlacement">,
  ): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._ensureInstances();

    this._registration!.initialize({
      ...registrationDeps,
      manualRegistrationPlacement: new ManualRegistrationPlacement(),
    });
    this._router!.bind();
    this._agentSpeechController!.bind();

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
    this._worldAnnotations = new WorldAnnotationPresenter({
      eventHost: this,
      parent: this.getSceneObject(),
      markerPrefab: this.annotationMarkerPrefab ?? null,
    });
    const skillHandlers = new ArSkillHandlers({
      getHmdWorldTransform: () => null,
      annotations: this._worldAnnotations,
    });
    this._agentClient = new AgentClient(this, transport, inbound, skillHandlers);
    this._registration = new RegistrationClient(
      session,
      transport,
      inbound,
      this.robotMarker ?? null,
    );
    this._registrationPreview = new RegistrationPreviewPresenter(this._state);
    this._router = new InboundRouter(
      session,
      this._state,
      this._status,
      this._telemetry,
      this._navClient,
      this._agentClient,
      this._registration,
    );
    this._agentSpeechController = new AgentSpeechController({
      eventHost: this,
      asrModule: require("LensStudio:AsrModule") as AsrModule,
      agentClient: this._agentClient,
      appStateStore: this._state,
      uiLogger: this._state.uiLogger,
      getBridgeSessionReady: () => this._router!.isBridgeSessionReady(),
    });
  }
}
