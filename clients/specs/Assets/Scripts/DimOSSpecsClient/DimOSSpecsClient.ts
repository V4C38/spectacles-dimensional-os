import { SpecsRuntimeCoordinator } from "./SpecsRuntimeCoordinator";
import { isSelectionEligible } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";
import { ClientTrackingOriginStore } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";
import TargetProvider,{ type InteractableHitInfo } from "SpectaclesInteractionKit.lspkg/Providers/TargetProvider/TargetProvider";
import { LensConfig } from "SpectaclesInteractionKit.lspkg/Utils/LensConfig";
import type { DispatchedDelayedEvent,DispatchedUpdateEvent } from "SpectaclesInteractionKit.lspkg/Utils/UpdateDispatcher";
import { parsePlaceArMarkerArgs, parseRemoveArMarkerArgs } from "DimOSARClient.lspkg/Scripts/DimOSARClient/agent/MarkerSkills";
import { ClientPosePublisher } from "DimOSARClient.lspkg/Scripts/DimOSARClient/agent/AgentTransport";

import { LocalizationCaptureEpisode } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/LocalizationCaptureEpisode";
import { RobotSelection } from "DimOSARClient.lspkg/Scripts/DimOSARClient/robot/RobotPresentation";
import { ARModuleSession } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/ARModuleSession";
import { buildModuleWebSocketUrl, normalizeHost } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/ConnectionAddress";
import { AR_MODULE_CLIENT_CONFIG } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { AlignmentWarning } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/NotificationCenter";
import { SpecsAgentController } from "./agent/SpecsAgentController";
import { IpRelayClient } from "./websocket/IpRelayClient";
import { SpecsCameraSource } from "./localization/SpecsCameraSource";
import { SpecsCameraStream } from "./localization/SpecsCameraStream";
import { SpecsManipulationController } from "./manipulation/SpecsManipulationController";
import { SpecsNavigationController, SpecsNavigationInput } from "./navigation/SpecsNavigationController";
import { NavigationRouteRenderer } from "./navigation/SpecsNavigationRenderer";

import { ARMarkerPresenter } from "./presentation/ARMarkerPresenter";
import { RobotPresenter } from "./presentation/RobotPresenter";
import { readSikLaserPointers, CursorLaserPresenter } from "./presentation/CursorLaserPresenter";

import { SpecsTargetPriority } from "./presentation/SpecsTargetPriority";
import { SpecsTextToSpeech } from "./agent/SpecsSpeechAdapters";
import { UIPresenter } from "./presentation/UIPresenter";
import { ViewerNotificationPresenter } from "./presentation/ViewerNotificationPresenter";
import { PointCloudRenderer } from "./sensors/PointCloudRenderer";
import { SpecsWebSocketTransport } from "./websocket/SpecsWebSocketTransport";

@component
export class DimOSSpecsClient extends BaseScriptComponent {
  private readonly alignmentWarning = new AlignmentWarning();
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
  private manipulation: SpecsManipulationController | null = null;
  private navigationInput: SpecsNavigationInput | null = null;
  private targetPriority: SpecsTargetPriority<InteractableHitInfo> | null = null;
  private previewRoute: NavigationRouteRenderer | null = null;
  private notifications: ViewerNotificationPresenter | null = null;
  private lasers: CursorLaserPresenter | null = null;
  private laserUpdate: DispatchedUpdateEvent | null = null;
  private laserStart: DispatchedDelayedEvent | null = null;
  private suspended = false;
  private cameraSource: SpecsCameraSource | null = null;
  private transport: SpecsWebSocketTransport | null = null;
  private clientTrackingOriginStore: ClientTrackingOriginStore | null = null;
  private session: ARModuleSession | null = null;
  private episode: LocalizationCaptureEpisode | null = null;
  private activeRouteRenderer: NavigationRouteRenderer | null = null;
  private navigationController: SpecsNavigationController | null = null;
  private unsubscribeSelection: (() => void) | null = null;
  private destroyed = false;
  private unsubscribeView: (() => void) | null = null;
  private updateEvent: SceneEvent | null = null;
  private runtime: SpecsRuntimeCoordinator | null = null;
  private lastSessionView: ReturnType<ARModuleSession["view"]> | null = null;
  private speechController: SpecsAgentController | null = null;
  private tts: SpecsTextToSpeech | null = null;
  private annotations: ARMarkerPresenter | null = null;
  private unsubscribeOutbound: (() => void) | null = null;
  private posePublisher: ClientPosePublisher | null = null;

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
      runtimeCapture: { retryDelaysS: [2, 5, 10, 30], stopWhileAwaitingResult: true },
      trace: event => { if (event.stage === "batch-sent" || event.stage === "result-received" || event.stage === "failed") print(`Localization: ${JSON.stringify(event)}`); },
    });
    this.episode = episode;

    const parent = this.getSceneObject();
    this.manipulation = new SpecsManipulationController(session, () => clientTrackingOriginStore.T_odom_client,
      parent, this.cameraObject, () => this.selection.toggle(), () => this.emergencyStop(), () => this.uiPresenter?.realign());
    this.lasers = new CursorLaserPresenter(parent, readSikLaserPointers);
    const activeRouteRenderer = new NavigationRouteRenderer(parent);
    const navigationController = new SpecsNavigationController({
      session,
      deviceTracking,
      robotPresenter: this.robotPresenter,
      cameraObject: this.cameraObject,
      parent,
      navGoalMarkerPrefab: this.navGoalMarkerPrefab,
    });
    this.activeRouteRenderer = activeRouteRenderer;
    this.previewRoute = new NavigationRouteRenderer(parent);
    this.navigationInput = new SpecsNavigationInput(navigationController, this.robotPresenter);
    this.targetPriority = new SpecsTargetPriority(TargetProvider);
    this.targetPriority.addPolicy(
      object => this.manipulation?.renderer.ownsMesh(object) === true,
      object => this.manipulation?.renderer.ownsHandle(object) === true);
    this.targetPriority.addPolicy(
      object => this.robotPresenter.ownsTarget(object), object => navigationController.ownsPriorityTarget(object));
    this.notifications = new ViewerNotificationPresenter(this.cameraObject);
    this.createEvent("OnPauseEvent").bind(() => {
      this.uiPresenter.invalidateSetupBaseline();
      this.manipulation?.suspend();
      this.suspended = true; this.selection.clear(); this.navigationInput?.reset();
      this.lasers?.reset();
      this.speechController?.endRecording(true); this.episode?.suspend();
    });
    this.createEvent("OnResumeEvent").bind(() => {
      this.suspended = false;
      this.episode?.resume();
      if (this.uiPresenter.isSetupCompleted()) this.uiPresenter.requestAlignmentReview("Headset resumed");
    });
    this.createEvent("WorldTrackingResetEvent").bind(() => {
      this.manipulation?.suspend();
      this.lasers?.reset();
      this.uiPresenter.invalidateSetupBaseline();
      if (!this.uiPresenter.isSetupCompleted()) return;
      this.selection.clear(); this.navigationInput?.reset(); this.speechController?.reset();
      this.episode?.reset(); this.session?.restartPreservingTrackingOrigin();
      this.uiPresenter.requestAlignmentReview("Tracking origin reset");
    });
    this.navigationController = navigationController;

    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("OnDestroyEvent").bind(() => {
      if (this.destroyed) return;
      this.destroyed = true;
      this.uiPresenter.dispose();
      this.unsubscribeSelection?.(); this.unsubscribeSelection = null;
      this.targetPriority?.dispose(); this.targetPriority = null;
      this.manipulation?.dispose(); this.manipulation = null;
      const dispatcher = LensConfig.getInstance().updateDispatcher;
      if (this.laserStart) dispatcher.removeEvent(this.laserStart);
      if (this.laserUpdate) dispatcher.removeEvent(this.laserUpdate);
      this.lasers?.dispose();
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
      this.navigationController?.dispose();
      this.robotPresenter!.dispose();
      this.lidarPresenter.hide();
      this.activeRouteRenderer?.destroy();
      this.previewRoute?.destroy(); this.notifications?.dispose();
      this.episode?.dispose();
      if (this.updateEvent) this.updateEvent.enabled = false;
      this.runtime = null;
      this.session?.stop();
    });
  }

  private onStart(): void {
    // SIK creates cursor view-model late updates during OnStart. Register afterward
    // at the same priority so the beam samples this frame's rendered cursor position.
    const dispatcher = LensConfig.getInstance().updateDispatcher;
    this.laserStart = dispatcher.nextFrame("SpecsLaserStart", () => {
      this.laserStart = null;
      this.laserUpdate = dispatcher.createLateUpdateEvent("SpecsLaserUpdate", () => {
        if (!this.suspended && this.enabled && this.getSceneObject().isEnabledInHierarchy) this.lasers?.tick();
        else this.lasers?.reset();
      });
    });
    const session = this.session!;
    const episode = this.episode!;
    const cameraSource = this.cameraSource!;
    const clientTrackingOriginStore = this.clientTrackingOriginStore!;
    const activeRouteRenderer = this.activeRouteRenderer!;
    const navigationController = this.navigationController!;
    const robotPresenter = this.robotPresenter;

    this.robotPresenter.bindSelection(() => this.selection.toggle(), this.cameraObject,
      sourceId => !this.navigationController?.ownsDraft(sourceId));
    this.unsubscribeSelection = this.selection.subscribe(selected => {
      this.manipulation?.setSelected(selected);
      this.robotPresenter.setSelected(selected);
      navigationController.setSelected(selected);
      if (!selected) this.speechController?.endRecording(true);
    });

    this.lidarPresenter.hide();
    activeRouteRenderer.hide();
    navigationController.hide();


    this.uiPresenter.bind({
      session,
      episode,
      transport: this.transport!,
      clientTrackingOriginStore,
      robotPresenter,
      defaultWebsocketIp: this.defaultWebsocketIp,
      ipRelayClient: new IpRelayClient(this.internetModule),
      previewTexture: () => SpecsCameraStream.getInstance().previewTexture(),
      cameraObject: this.cameraObject,
      selection: this.selection,
      emergencyStop: () => this.emergencyStop(),
      manipulationDiagnostics: () => JSON.stringify({ capture: this.manipulation?.core.interaction.captureEvents ?? [], advisory: this.manipulation?.core.interaction.diagnostics() }),
      manipulationSpeed: () => this.manipulation?.core.interaction.speedScale ?? 0.5,
      setManipulationSpeed: value => this.manipulation?.core.interaction.setSpeedScale(value),
      manipulationEnabled: () => this.manipulation?.core.interaction.snapshot().canManipulate ?? false,
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
    const speechController = new SpecsAgentController({
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
      this.alignmentWarning.observe(message);
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

    this.runtime = new SpecsRuntimeCoordinator({
      suspended: () => this.suspended,
      syncSelectionEligibility: () => this.syncSelectionEligibility(),
      publishPose: () => this.maybeSendClientPose(),
      streamDiagnostics: () => SpecsCameraStream.getInstance().diagnostics(),
      cameraSource, session, episode, clientTrackingOriginStore, activeRouteRenderer,
      navigationController, robotPresenter, uiPresenter: this.uiPresenter,
      cameraObject: this.cameraObject, selection: this.selection,
      lidarPresenter: this.lidarPresenter, manipulation: this.manipulation!,
      navigationInput: this.navigationInput!, previewRoute: this.previewRoute!,
      annotations: this.annotations!, notifications: this.notifications!,
      alignmentWarning: this.alignmentWarning,
    });
    this.unsubscribeView = session.subscribeView(view => {
      const prevView = this.lastSessionView;
      this.lastSessionView = view;
      this.uiPresenter.onSessionView(view, prevView);
      if (view.connection !== "ready" && !this.manipulation?.core.interaction.retainingFeedback) {
        this.selection.clear();
        this.speechController?.reset();
      }
      this.runtime?.invalidateRoom();
    });
    const updateEvent = this.createEvent("UpdateEvent");
    updateEvent.bind(() => this.runtime?.tick());
    this.updateEvent = updateEvent;
  }

  emergencyStop(): void {
    this.manipulation?.suspend();
    if (this.session?.view().capabilities?.estop.available !== true) return;
    try {
      this.navigationInput?.reset(); this.speechController?.endRecording(true);
      if (this.navigationController?.interaction.snapshot().goalActive) {
        if (!this.navigationController.cancel()) throw new Error("Stop request could not be sent");
      }
      else this.session.requestEstop();
      this.notifications?.show({ text: "Emergency stop requested", tone: "danger", glyph: "stop", priority: 100 });
    } catch { this.notifications?.show({ text: "Stop request failed", tone: "danger", glyph: "stop", priority: 100 }); }
  }

  private syncSelectionEligibility(): void {
    this.selection.setEligible(isSelectionEligible(this.session!.view(), this.uiPresenter.isSetupCompleted(),
      this.uiPresenter.isAlignmentReviewPending(), this.manipulation?.core.interaction.retainingFeedback ?? false));
  }

  private maybeSendClientPose(): void { this.posePublisher?.tick(); }
}
