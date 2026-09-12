import { ClientTrackingOriginStore } from "./core/localization/clientTrackingOrigin";
import { LocalizationCaptureEpisode } from "./core/localization/localizationCaptureEpisode";
import { ARModuleSession } from "./core/websocket/arModuleSession";
import { AR_MODULE_CLIENT_CONFIG } from "./core/websocket/hostPorts";
import { SpecsCameraSource } from "./localization/SpecsCameraSource";
import { SpecsCameraStream } from "./localization/SpecsCameraStream";
import { NavigationController } from "./navigation/NavigationController";
import { NavGoalPresenter } from "./navigation/NavGoalPresenter";
import { RobotPresenter } from "./robot/RobotPresenter";
import { PointCloudRenderer } from "./sensors/PointCloudRenderer";
import { SpecsWebSocketTransport } from "./websocket/SpecsWebSocketTransport";

@component
export class DimosARClient extends BaseScriptComponent {
  @input
  robotPresenter: RobotPresenter;
  
  @input
  lidarPresenter: PointCloudRenderer;

  @input
  cameraObject: SceneObject;

  @input
  internetModule: InternetModule;

  @input
  defaultWebsocketIp: string = "192.168.1.108";

  @input
  navGoalMarkerPrefab: ObjectPrefab;


  private clientTrackingOriginStore: ClientTrackingOriginStore | null = null;
  private session: ARModuleSession | null = null;
  private episode: LocalizationCaptureEpisode | null = null;
  private navGoalPresenter: NavGoalPresenter | null = null;
  private navigationController: NavigationController | null = null;
  private unsubscribeView: (() => void) | null = null;
  private updateEvent: SceneEvent | null = null;

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
    const deviceTracking = this.cameraObject.getComponent(
      "Component.DeviceTracking",
    ) as DeviceTracking;
    if (!deviceTracking) {
      throw new Error("DeviceTracking is required");
    }

    const host = (this.defaultWebsocketIp ?? "").trim();
    const clock = { now: () => getTime() };
    const transport = new SpecsWebSocketTransport({
      internetModule: this.internetModule,
      script: this,
      url: `ws://${host}:${AR_MODULE_CLIENT_CONFIG.port}`,
    });
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
    const robotPresenter = this.robotPresenter;
    const navGoalPresenter = new NavGoalPresenter(parent);
    const navigationController = new NavigationController({
      session,
      eventHost: this,
      deviceTracking,
      robotPresenter,
      parent,
      navGoalMarkerPrefab: this.navGoalMarkerPrefab,
    });
    this.navGoalPresenter = navGoalPresenter;
    this.navigationController = navigationController;

    const applyNavPath = (): void => {
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

    this.unsubscribeView = session.subscribeView((view) => {
      const origin = clientTrackingOriginStore.T_odom_client;
      if (!view.hasTrackingOrigin || !origin) {
        robotPresenter.hide();
        this.lidarPresenter.hide();
        navGoalPresenter.hide();
        navigationController.hide();
        return;
      }
      if (view.hello) {
        robotPresenter.apply({ robot: view.hello.robot, pose: view.pose, origin });
      } else {
        robotPresenter.hide();
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
    });
    this.updateEvent = updateEvent;

    this.createEvent("OnDestroyEvent").bind(() => {
      this.unsubscribeView?.();
      this.unsubscribeView = null;
      this.navigationController!.dispose();
      this.robotPresenter!.hide();
      this.lidarPresenter.hide();
      this.navGoalPresenter!.destroy();
      this.episode!.dispose();
      this.updateEvent!.enabled = false;
      this.session!.stop();
    });

    if (host) {
      session.start();
    }
  }
}
