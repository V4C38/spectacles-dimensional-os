import { ClientTrackingOriginStore } from "../DimOSARClient/localization/clientTrackingOrigin";
import { LocalizationCaptureEpisode } from "../DimOSARClient/localization/localizationCaptureEpisode";
import { ARModuleSession } from "../DimOSARClient/websocket/arModuleSession";
import { AR_MODULE_CLIENT_CONFIG } from "../DimOSARClient/websocket/hostPorts";
import { buildModuleWebSocketUrl, normalizeHost } from "../DimOSARClient/websocket/hostNormalization";
import { SpecsCameraSource } from "./localization/SpecsCameraSource";
import { SpecsCameraStream } from "./localization/SpecsCameraStream";
import { NavigationController } from "./navigation/NavigationController";
import { NavGoalPresenter } from "./navigation/NavGoalPresenter";
import { UIPresenter } from "./presentation/UIPresenter";
import { RobotPresenter } from "./presentation/RobotPresenter";
import { PointCloudRenderer } from "./sensors/PointCloudRenderer";
import { SpecsWebSocketTransport } from "./websocket/SpecsWebSocketTransport";

@component
export class DimOSSpecsClient extends BaseScriptComponent {
  @input
  robotPresenter: RobotPresenter;

  @input
  lidarPresenter: PointCloudRenderer;

  @input
  uiPresenter: UIPresenter;

  @input
  cameraObject: SceneObject;

  @input
  internetModule: InternetModule;

  @input
  defaultWebsocketIp: string = "192.168.1.108";

  @input
  navGoalMarkerPrefab: ObjectPrefab;

  private cameraSource: SpecsCameraSource | null = null;
  private transport: SpecsWebSocketTransport | null = null;
  private clientTrackingOriginStore: ClientTrackingOriginStore | null = null;
  private session: ARModuleSession | null = null;
  private episode: LocalizationCaptureEpisode | null = null;
  private navGoalPresenter: NavGoalPresenter | null = null;
  private navigationController: NavigationController | null = null;
  private unsubscribeView: (() => void) | null = null;
  private updateEvent: SceneEvent | null = null;
  private lastSessionView: ReturnType<ARModuleSession["view"]> | null = null;

  onAwake(): void {
    if (!this.internetModule) {
      throw new Error("internetModule is required");
    }
    if (!this.cameraObject) {
      throw new Error("cameraObject is required");
    }
    if (!this.lidarPresenter) {
      throw new Error("lidarPresenter is required");
    }
    if (!this.navGoalMarkerPrefab) {
      throw new Error("navGoalMarkerPrefab is required");
    }
    if (!this.robotPresenter) {
      throw new Error("robotPresenter is required");
    }
    if (!this.uiPresenter) {
      throw new Error("uiPresenter is required");
    }
    const deviceTracking = this.cameraObject.getComponent(
      "Component.DeviceTracking",
    ) as DeviceTracking;
    if (!deviceTracking) {
      throw new Error("DeviceTracking is required");
    }

    const host = normalizeHost(this.defaultWebsocketIp ?? "");
    const clock = { now: () => getTime() };
    const transport = new SpecsWebSocketTransport({
      internetModule: this.internetModule,
      script: this,
      url: buildModuleWebSocketUrl(host, AR_MODULE_CLIENT_CONFIG.port),
    });
    this.transport = transport;
    const clientTrackingOriginStore = new ClientTrackingOriginStore();
    this.clientTrackingOriginStore = clientTrackingOriginStore;
    const session = new ARModuleSession({
      transport,
      clock,
      clientTrackingOriginStore,
    });
    this.session = session;

    transport.bind({
      onTransportOpen: () => session.onTransportOpen(),
      onTransportClose: () => session.onTransportClose(),
      onTransportText: (chunk) => session.onTransportText(chunk),
      onTransportBinary: (data) => session.onTransportBinary(data),
    });

    const cameraSource = new SpecsCameraSource({
      stream: SpecsCameraStream.getInstance(),
      cameraObject: this.cameraObject,
    });
    this.cameraSource = cameraSource;
    cameraSource.samplePose();
    const episode = new LocalizationCaptureEpisode({
      session,
      clientTrackingOriginStore,
      clock,
      tracking: cameraSource,
      capture: cameraSource,
    });
    this.episode = episode;

    const parent = this.getSceneObject();
    const navGoalPresenter = new NavGoalPresenter(parent);
    const navigationController = new NavigationController({
      session,
      eventHost: this,
      deviceTracking,
      robotPresenter: this.robotPresenter,
      parent,
      navGoalMarkerPrefab: this.navGoalMarkerPrefab,
    });
    this.navGoalPresenter = navGoalPresenter;
    this.navigationController = navigationController;

    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => {
      this.unsubscribeView?.();
      this.unsubscribeView = null;
      this.navigationController!.dispose();
      this.robotPresenter!.reset();
      this.lidarPresenter.hide();
      this.navGoalPresenter!.destroy();
      this.episode!.dispose();
      this.updateEvent!.enabled = false;
      this.session!.stop();
    });
  }

  private onStart(): void {
    const session = this.session!;
    const episode = this.episode!;
    const cameraSource = this.cameraSource!;
    const clientTrackingOriginStore = this.clientTrackingOriginStore!;
    const navGoalPresenter = this.navGoalPresenter!;
    const navigationController = this.navigationController!;
    const robotPresenter = this.robotPresenter;

    this.lidarPresenter.hide();
    navGoalPresenter.hide();
    navigationController.hide();

    const applyNavPath = (): void => {
      if (!this.uiPresenter.isWizardFinished()) {
        return;
      }
      const origin = clientTrackingOriginStore.T_odom_client;
      const view = session.view();
      navGoalPresenter.apply({
        nav_goal: view.nav_goal,
        origin,
        pathVisible: navigationController.flash() === null,
        floorY: robotPresenter.floorWorldY(),
        goalY: navigationController.currentPose()?.position.y ?? null,
      });
    };
    navigationController.onFlashChange = applyNavPath;

    this.uiPresenter.bind({
      session,
      episode,
      transport: this.transport!,
      clientTrackingOriginStore,
      robotPresenter,
      defaultWebsocketIp: this.defaultWebsocketIp,
      script: this,
    });
    this.uiPresenter.start();

    this.unsubscribeView = session.subscribeView((view) => {
      const prevView = this.lastSessionView;
      this.lastSessionView = view;
      this.uiPresenter.onSessionView(view, prevView);
      this.uiPresenter.applyRoomPresentation(view);

      if (!this.uiPresenter.isWizardFinished()) {
        this.lidarPresenter.hide();
        navGoalPresenter.hide();
        navigationController.hide();
        return;
      }

      const origin = clientTrackingOriginStore.T_odom_client;
      if (!view.hasTrackingOrigin || !origin) {
        this.lidarPresenter.hide();
        navGoalPresenter.hide();
        navigationController.hide();
        return;
      }
      this.lidarPresenter.apply({ points: view.lidar?.points ?? null, origin });
      navigationController.applyView(view, origin);
      applyNavPath();
    });

    const updateEvent = this.createEvent("UpdateEvent");
    updateEvent.bind(() => {
      cameraSource.samplePose();
      session.tick();
      episode.tick();
      this.uiPresenter.tick(getDeltaTime());
    });
    this.updateEvent = updateEvent;
  }
}
