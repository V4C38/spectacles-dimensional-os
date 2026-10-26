import { RobotSelection } from "../DimOSARClient/robot/RobotSelection";
import { SpecsNavigationInput } from "./navigation/SpecsNavigationInput";
import { ViewerNotificationPresenter } from "./presentation/ViewerNotificationPresenter";
import { ClientPosePublisher } from "../DimOSARClient/agent/ClientPosePublisher";
import {
  ClientTrackingOriginStore,
  type ClientTrackingOrigin,
} from "../DimOSARClient/localization/clientTrackingOrigin";
import { LocalizationCaptureEpisode } from "../DimOSARClient/localization/localizationCaptureEpisode";
import { ARModuleSession } from "../DimOSARClient/websocket/arModuleSession";
import { AR_MODULE_CLIENT_CONFIG } from "../DimOSARClient/websocket/hostPorts";
import { buildModuleWebSocketUrl, normalizeHost } from "../DimOSARClient/websocket/hostNormalization";
import { SpecsCameraSource } from "./localization/SpecsCameraSource";
import { SpecsCameraStream } from "./localization/SpecsCameraStream";
import { NavigationController } from "./navigation/NavigationController";
import { NavGoalPresenter } from "./navigation/NavGoalPresenter";
import { IpRelayClient } from "./IpRelayClient";
import { UIPresenter } from "./presentation/UIPresenter";
import { RobotPresenter } from "./presentation/RobotPresenter";
import { PointCloudRenderer } from "./sensors/PointCloudRenderer";
import { SpecsWebSocketTransport } from "./websocket/SpecsWebSocketTransport";
import { AgentSpeechController } from "./agent/AgentSpeechController";
import { SpecsTextToSpeech } from "./presentation/SpecsTextToSpeech";
import { ARMarkerPresenter } from "./presentation/ARMarkerPresenter";
import {
  parsePlaceArMarkerArgs,
  parseRemoveArMarkerArgs,
} from "../DimOSARClient/agent/agentSkills";

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

  @input
  textToSpeechModule: TextToSpeechModule;

  @input
  textToSpeechAudio: AudioComponent;

  @input
  ARMarkerPrefab: ObjectPrefab;

  readonly selection = new RobotSelection();
  private navigationInput: SpecsNavigationInput | null = null;
  private previewRoute: NavGoalPresenter | null = null;
  private notifications: ViewerNotificationPresenter | null = null;
  private suspended = false;
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
  private speechController: AgentSpeechController | null = null;
  private tts: SpecsTextToSpeech | null = null;
  private annotations: ARMarkerPresenter | null = null;
  private unsubscribeOutbound: (() => void) | null = null;
  private posePublisher: ClientPosePublisher | null = null;
  private lastAnnotationOrigin: ClientTrackingOrigin | null = null;

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
    if (!this.textToSpeechModule) {
      throw new Error("textToSpeechModule is required");
    }
    if (!this.textToSpeechAudio) {
      throw new Error("textToSpeechAudio is required");
    }
    if (!this.ARMarkerPrefab) {
      throw new Error("ARMarkerPrefab is required");
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
    this.posePublisher = new ClientPosePublisher(session, clientTrackingOriginStore, cameraSource, clock);
    cameraSource.samplePose();
    const episode = new LocalizationCaptureEpisode({
      session,
      clientTrackingOriginStore,
      clock,
      tracking: cameraSource,
      capture: cameraSource,
      initiallyPaused: true,
      trace: event => { if (event.stage === "batch-sent" || event.stage === "result-received" || event.stage === "failed") print(`Localization: ${JSON.stringify(event)}`); },
    });
    this.episode = episode;

    const parent = this.getSceneObject();
    const navGoalPresenter = new NavGoalPresenter(parent);
    const navigationController = new NavigationController({
      session,
      deviceTracking,
      robotPresenter: this.robotPresenter,
      cameraObject: this.cameraObject,
      parent,
      navGoalMarkerPrefab: this.navGoalMarkerPrefab,
    });
    this.navGoalPresenter = navGoalPresenter;
    this.previewRoute = new NavGoalPresenter(parent);
    this.navigationInput = new SpecsNavigationInput(navigationController, this.robotPresenter);
    this.notifications = new ViewerNotificationPresenter(this.cameraObject);
    this.createEvent("OnPauseEvent").bind(() => {
      this.uiPresenter.invalidateSetupBaseline();
      this.suspended = true; this.selection.clear(); this.navigationInput?.reset();
      this.speechController?.endRecording(true); this.cameraSource?.stop();
    });
    this.createEvent("OnResumeEvent").bind(() => {
      this.suspended = false;
      if (this.uiPresenter.isSetupCompleted()) this.uiPresenter.requestAlignmentReview("Headset resumed");
    });
    this.createEvent("WorldTrackingResetEvent").bind(() => {
      this.uiPresenter.invalidateSetupBaseline();
      if (!this.uiPresenter.isSetupCompleted()) return;
      this.selection.clear(); this.navigationInput?.reset(); this.speechController?.reset();
      this.episode?.reset(); this.session?.restartPreservingTrackingOrigin();
      this.uiPresenter.requestAlignmentReview("Tracking origin reset");
    });
    this.navigationController = navigationController;

    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => {
      this.unsubscribeView?.();
      this.unsubscribeView = null;
      this.unsubscribeOutbound?.();
      this.unsubscribeOutbound = null;
      this.speechController?.dispose();
      this.speechController = null;
      this.tts?.stop();
      this.tts = null;
      this.annotations?.clearAll();
      this.annotations = null;
      this.navigationController!.dispose();
      this.robotPresenter!.reset();
      this.lidarPresenter.hide();
      this.navGoalPresenter!.destroy();
      this.previewRoute?.destroy(); this.notifications?.dispose();
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

    this.robotPresenter.bindSelection(() => this.selection.toggle(), this.cameraObject,
      sourceId => !this.navigationController?.ownsDraft(sourceId));
    this.selection.subscribe(selected => {
      this.robotPresenter.setSelected(selected);
      navigationController.setSelected(selected);
      if (!selected) this.speechController?.endRecording(true);
    });

    this.lidarPresenter.hide();
    navGoalPresenter.hide();
    navigationController.hide();


    this.uiPresenter.bind({
      session,
      episode,
      transport: this.transport!,
      clientTrackingOriginStore,
      robotPresenter,
      defaultWebsocketIp: this.defaultWebsocketIp,
      ipRelayClient: new IpRelayClient(this.internetModule),
      script: this,
      cameraObject: this.cameraObject,
      isRobotSelected: () => this.selection.isSelected(),
      toggleRobotSelection: () => this.selection.toggle(),
      emergencyStop: () => this.emergencyStop(),
      onModeChanged: () => { this.selection.clear(); this.navigationInput?.reset(); },
    });
    this.uiPresenter.start();

    const tts = new SpecsTextToSpeech({
      module: this.textToSpeechModule,
      audio: this.textToSpeechAudio,
    });
    this.tts = tts;
    let asrModule: AsrModule | null = null;
    try { asrModule = require("LensStudio:AsrModule") as AsrModule; }
    catch { print("Speech recognition is unavailable in this runtime"); }
    const speechController = new AgentSpeechController({
      asrModule,
      session,
      tts,
      getOperatingMode: () => this.uiPresenter.getOperatingMode(),
      isSelected: () => this.selection.isSelected(),
      select: () => this.selection.setSelected(true),
      isSetupCompleted: () => this.uiPresenter.isSetupCompleted() && !this.uiPresenter.isAlignmentReviewPending(),
      emergencyStop: () => this.emergencyStop(),
    });
    this.speechController = speechController;
    this.uiPresenter.attachVoice(speechController, tts);
    speechController.bind();

    const annotationParent = this.getSceneObject();
    this.annotations = new ARMarkerPresenter({
      parent: annotationParent,
      markerPrefab: this.ARMarkerPrefab,
    });
    this.unsubscribeOutbound = session.subscribeOutbound((message) => {
      if (message.type !== "agent_skill") {
        return;
      }
      try {
        if (message.name === "ar_place_marker") {
          const origin = clientTrackingOriginStore.T_odom_client;
          if (!origin) {
            return;
          }
          this.annotations!.apply(parsePlaceArMarkerArgs(message.args), origin);
          return;
        }
        if (message.name === "ar_remove_marker") {
          this.annotations!.remove(parseRemoveArMarkerArgs(message.args).id);
        }
      } catch (error) {
        print(`ARMarkerPresenter: ${error}`);
      }
    });

    let roomPresentationDirty = true;
    this.unsubscribeView = session.subscribeView(view => {
      const prevView = this.lastSessionView; this.lastSessionView = view;
      this.uiPresenter.onSessionView(view, prevView);
      if (view.connection !== "ready") { this.selection.clear(); this.speechController?.reset(); }
      roomPresentationDirty = true;
    });
    let lastOrigin: ClientTrackingOrigin | null = null;
    let previousSetup = false;
    const updateEvent = this.createEvent("UpdateEvent");
    updateEvent.bind(() => {
      if (this.suspended) return;
      const dt = Math.min(0.1, getDeltaTime());
      cameraSource.samplePose(); session.tick(); episode.tick(); this.maybeSendClientPose();
      this.uiPresenter.tick(dt);
      const view = session.view(), origin = clientTrackingOriginStore.T_odom_client;
      const setup = this.uiPresenter.isSetupCompleted();
      this.selection.setEligible(setup && !this.uiPresenter.isAlignmentReviewPending() && view.connection === "ready");
      const viewportHeight = (this.cameraObject.getComponent("Component.Camera") as Camera)?.renderTarget?.getHeight() ?? 1024;
      robotPresenter.setViewportHeight(viewportHeight); navigationController.setViewportHeight(viewportHeight);
      if (roomPresentationDirty || previousSetup !== setup || lastOrigin !== origin) {
        roomPresentationDirty = false; previousSetup = setup;
        this.uiPresenter.applyRoomPresentation(view);
        if (view.connection !== "ready") this.annotations?.clearAll();
        if (origin && origin !== lastOrigin) this.annotations?.recompose(origin);
        lastOrigin = origin;
      }
      robotPresenter.setSelected(this.selection.isSelected());
      const controls = setup && !this.uiPresenter.isAlignmentReviewPending() && this.uiPresenter.getOperatingMode() === "manual" && view.connection === "ready";
      navigationController.setInputEnabled(controls);
      if (!setup) navigationController.hide();
      else navigationController.applyView(view, origin);
      navigationController.setSelected(this.selection.isSelected());
      this.navigationInput?.tick(controls, setup && !this.uiPresenter.isAlignmentReviewPending() && view.connection === "ready");
      navigationController.tick(dt);
      const nav = navigationController.interaction.snapshot();
      robotPresenter.setNavigationFloor(!nav.attachedToRobot, navigationController.circleOpacity());
      if (setup && origin && view.hasTrackingOrigin) {
        const prefs = this.uiPresenter.getLidarPreferences();
        this.lidarPresenter.apply({ points: view.lidar?.points ?? null, origin, mode: this.uiPresenter.getLidarMode(),
          robot: view.pose?.position, orientation: view.pose?.orientation,
          baseHeightM: view.hello?.robot.base_height_m, bounds: view.hello?.robot.body_bounds_m,
          pointLimit: prefs.pointLimit, obstacleRangeM: prefs.obstacleRangeM,
          odomScaleCorrectionFactor: view.hello?.robot.odom_scale_correction_factor ?? 1, viewportHeight });
        const circles = { startCircle: robotPresenter.floorCircleBounds(), viewportHeight };
        navGoalPresenter.apply({ path: navigationController.activePath(), origin,
          pathVisible: navigationController.isArmed() && !nav.flash,
          floorY: robotPresenter.floorWorldY(), goalY: navigationController.currentPose()?.position.y,
          executing: nav.followingPath, endCircle: navigationController.circleBounds(), ...circles });
        this.previewRoute!.apply({ path: navigationController.previewPath(), origin,
          pathVisible: navigationController.isAiming(), preview: true,
          floorY: robotPresenter.floorWorldY(), goalY: navigationController.currentPose()?.position.y,
          endCircle: navigationController.draftCircleBounds(), ...circles });
      } else { this.lidarPresenter.hide(); navGoalPresenter.hide(); this.previewRoute?.hide(); }
      this.annotations?.update(this.cameraObject.getTransform().getWorldPosition(), dt);
      this.notifications?.tick(dt);
    });
    this.updateEvent = updateEvent;
  }

  emergencyStop(): void {
    if (this.session?.view().capabilities?.estop.available !== true) return;
    try {
      this.navigationInput?.reset(); this.speechController?.endRecording(true);
      if (this.navigationController?.interaction.snapshot().goalActive) this.navigationController.cancel();
      else this.session.requestEstop();
      this.notifications?.show({ text: "Emergency stop requested", tone: "danger", glyph: "stop", priority: 100 });
    } catch { this.notifications?.show({ text: "Stop request failed", tone: "danger", glyph: "stop", priority: 100 }); }
  }

  private maybeSendClientPose(): void { this.posePublisher?.tick(); }
}
