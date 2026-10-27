import { ClientPosePublisher } from "@dimos-ar-client/agent/ClientPosePublisher";
import { ViewerNotificationPresenter } from "./presentation/ViewerNotificationPresenter";
import { reportDiagnostic } from "./diagnostics/BrowserDiagnostics";
import { AgentDraftSession } from "@dimos-ar-client/agent/AgentDraftSession";
import { RobotSelection } from "@dimos-ar-client/robot/RobotSelection";
import type { RecognitionPort, SynthesisPort } from "@dimos-ar-client/agent/AgentDraftSession";
import type { ClientClock } from "@dimos-ar-client/websocket/hostPorts";
import {
  ClientTrackingOriginStore,
  type ClientTrackingOrigin,
} from "@dimos-ar-client/localization/clientTrackingOrigin";
import { LocalizationCaptureEpisode } from "@dimos-ar-client/localization/localizationCaptureEpisode";
import {
  rotateVecByQuat,
} from "@dimos-ar-client/localization/clientTrackingTransforms";
import { parsePlaceArMarkerArgs, parseRemoveArMarkerArgs } from "@dimos-ar-client/agent/agentSkills";
import { ARModuleSession } from "@dimos-ar-client/websocket/arModuleSession";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import type { HmdCameraSource } from "./localization/HmdCameraSource";
import { WebXRJoystickController, type JoystickAxes } from "./navigation/WebXRJoystickController";
import {
  robotDeadzoneRadiusM,
  WebXRNavigationController,
} from "./navigation/WebXRNavigationController";
import {
  navigationSurfaceHits,
  type FloorPlane,
  type RobotGroundDeadzone,
} from "./navigation/WebXRGroundPlacement";
import { WebXRARMarkerPresenter } from "./presentation/WebXRARMarkerPresenter";
import { WebXRLidarRenderer } from "./sensors/WebXRLidarRenderer";
import { WebXRRobotPresenter } from "./presentation/WebXRRobotPresenter";
import { WebXRRouteRenderer } from "./navigation/WebXRRouteRenderer";
import { WebXRUIPresenter } from "./presentation/WebXRUIPresenter";
import type { BindableWebSocketTransport } from "@dimos-ar-client/websocket/hostPorts";
type WebXRCameraPort = Pick<HmdCameraSource, "samplePose" | "cameraOptical" | "start" | "stop" | "capture" | "clearTracking" | "availabilityError" | "previewFrame" | "dispose">;

export interface DimOSWebXRClientDeps {
  transport: BindableWebSocketTransport;
  clock: ClientClock;
  camera: WebXRCameraPort;
  recognition?: RecognitionPort | null;
  synthesis?: SynthesisPort | null;
}

export class DimOSWebXRClient {
  readonly notifications = new ViewerNotificationPresenter();
  private stopFeedbackRemaining = 0;
  readonly speech: AgentDraftSession;
  readonly session: ARModuleSession;
  readonly episode: LocalizationCaptureEpisode;
  readonly originStore: ClientTrackingOriginStore;
  readonly ui: WebXRUIPresenter;
  readonly robot: WebXRRobotPresenter;
  readonly lidar: WebXRLidarRenderer;
  readonly route: WebXRRouteRenderer;
  readonly previewRoute: WebXRRouteRenderer;
  readonly markers: WebXRARMarkerPresenter;
  readonly navigation: WebXRNavigationController;
  readonly joystick: WebXRJoystickController;

  private readonly transport: BindableWebSocketTransport;
  private readonly clock: ClientClock;
  private readonly camera: WebXRCameraPort;
  private unsubscribeView: (() => void) | null = null;
  private unsubscribeOutbound: (() => void) | null = null;
  private lastView: ReturnType<ARModuleSession["view"]> | null = null;
  private readonly posePublisher: ClientPosePublisher;
  private lastMarkerOrigin: ClientTrackingOrigin | null = null;
  private lastTickAt: number | null = null;
  private lastCamera: { position: Vec3; orientation: Quat } | null = null;
  private disposed = false;
  readonly selection = new RobotSelection();
  private readonly unsubscribeSelection: () => void;

  constructor(deps: DimOSWebXRClientDeps) {
    this.transport = deps.transport;
    this.clock = deps.clock;
    this.camera = deps.camera;
    this.originStore = new ClientTrackingOriginStore();
    this.session = new ARModuleSession({
      transport: deps.transport,
      clock: deps.clock,
      clientTrackingOriginStore: this.originStore,
    });
    this.transport.bind({
      onTransportOpen: () => this.session.onTransportOpen(),
      onTransportClose: () => this.session.onTransportClose(),
      onTransportText: (chunk) => this.session.onTransportText(chunk),
      onTransportBinary: (data) => this.session.onTransportBinary(data),
    });
    this.episode = new LocalizationCaptureEpisode({
      session: this.session,
      clientTrackingOriginStore: this.originStore,
      clock: deps.clock,
      tracking: deps.camera,
      capture: deps.camera,
      initiallyPaused: true,
      trace: event => reportDiagnostic("localization-stage", { ...event, timing: this.episode?.timing() }),
    });
    this.posePublisher = new ClientPosePublisher(this.session, this.originStore, deps.camera, deps.clock);
    this.ui = new WebXRUIPresenter(this.session, this.episode, () => this.camera.availabilityError(),
      () => this.selection.snapshot(), () => {
        const status = this.speech?.snapshot().status;
        return { ttsPlaying: status === "Responding", asrRunning: status === "Listening" };
      });
    this.speech = new AgentDraftSession({
      recognition: deps.recognition ?? null, synthesis: deps.synthesis ?? null,
      send: text => this.ui.sendAgentText(text), estop: () => this.emergencyStop(),
      isSelected: () => this.isRobotSelected(), select: () => this.setRobotSelected(true),
    });
    this.robot = new WebXRRobotPresenter();
    this.lidar = new WebXRLidarRenderer();
    this.route = new WebXRRouteRenderer();
    this.previewRoute = new WebXRRouteRenderer();
    this.markers = new WebXRARMarkerPresenter();
    this.navigation = new WebXRNavigationController(this.session);
    this.joystick = new WebXRJoystickController(this.session);
    this.unsubscribeSelection = this.selection.subscribe(selected => {
      this.robot.setSelected(selected);
      this.navigation.setSelected(selected);
      if (!selected) { this.navigation.cancelDrag(); this.speech.endRecording(true); }
    });
  }

  start(): void {
    if (this.unsubscribeView || this.disposed) return;
    this.unsubscribeView = this.session.subscribeView((view) => {
      const prev = this.lastView;
      this.lastView = view;
      if (view.connection !== prev?.connection || view.lastError !== prev?.lastError) {
        reportDiagnostic("connection", { phase: view.connection, error: view.lastError });
      }
      this.ui.onSessionView(view, prev, this.clock.now());
      if (view.connection === "ready" && view.alignmentRequired && !view.hasTrackingOrigin && this.ui.setupCompleted) {
        this.ui.requestAlignmentReview("Robot connection changed; re-localize to continue");
      }
      if (view.connection !== "ready") {
        this.loseInput();
        this.setRobotSelected(false);
        this.speech.reset();
        this.markers.clearAll();
        this.lastMarkerOrigin = null;
      }
      this.applyView();
    });
    this.unsubscribeOutbound = this.session.subscribeOutbound((message) => {
      if (message.type === "localization_result") {
        reportDiagnostic("localization-result", { confidence: message.confidence, origin: this.originStore.hasTrackingOrigin });
      }
      if (message.type !== "agent_skill") {
        return;
      }
      try {
        if (message.name === "ar_place_marker") {
          const origin = this.originStore.T_odom_client;
          if (!origin) {
            return;
          }
          this.markers.apply(parsePlaceArMarkerArgs(message.args), origin);
          return;
        }
        if (message.name === "ar_remove_marker") {
          this.markers.remove(parseRemoveArMarkerArgs(message.args).id);
        }
      } catch (error) {
        console.error(error);
      }
    });
  }

  tick(cameraPose: { position: Vec3; orientation: Quat }, joystick: JoystickAxes | null): void {
    if (this.disposed) {
      return;
    }
    this.lastCamera = cameraPose;
    this.camera.samplePose(cameraPose.position, cameraPose.orientation);
    this.session.tick();
    this.episode.tick();
    const now = this.clock.now();
    this.ui.tick(now);
    const view = this.session.view();
    if (!this.ui.menuOpen || !this.isRobotSelected()) this.speech.endRecording(true);
    this.speech.tick(now, this.ui.setupCompleted && this.ui.operatingMode === "agent" &&
      view.connection === "ready" && view.capabilities?.agent.available === true,
      view.agentMessage, view.state?.agent.idle ?? true, view.agentMessageRevision);
    const visibleDeltaS = this.lastTickAt === null ? 0 : Math.min(0.1, Math.max(0, now - this.lastTickAt));
    this.stopFeedbackRemaining = Math.max(0, this.stopFeedbackRemaining - visibleDeltaS);
    this.ui.estopPressed = this.stopFeedbackRemaining > 0;
    this.navigation.tick(now, visibleDeltaS);
    this.joystick.tick(now, this.controlsEnabled() ? joystick : null);
    if (!this.controlsEnabled()) this.navigation.cancelDrag();
    const deltaS = this.lastTickAt === null ? 0 : Math.min(0.1, Math.max(0, now - this.lastTickAt));
    this.lastTickAt = now;
    this.applyView(deltaS);
    this.markers.update(cameraPose.position, deltaS);
    const feedback = this.speech.snapshot();
    this.ui.cameraStatus = this.camera.previewFrame() ? "Capturing · " + this.camera.previewFrame()!.width + " × " + this.camera.previewFrame()!.height : "Not capturing";
    const ui = this.ui.snapshot();
    this.robot.setDebug(this.ui.debugEnabled);
    this.robot.feedback({
      tone: ui.connectionTone,
      aligned: view.hasTrackingOrigin,
      activity: ui.activity,
      message: feedback.response || view.agentMessage || feedback.prompt || null,
    });
    this.maybeSendClientPose();
  }

  /** Direct marker drags stream goals; floor gestures preview first, then confirm. */
  holdNavigation(rayFrom: Vec3, rayDir: Vec3, planes: readonly FloorPlane[], fromMarker = true, sourceId = "default"): void {
    if (!this.controlsEnabled() || !this.originStore.hasTrackingOrigin) {
      return;
    }
    const origin = this.originStore.T_odom_client;
    if (!origin) {
      return;
    }
    const hits = navigationSurfaceHits(rayFrom, rayDir, planes, this.robot.floorWorldY() ?? 0);
    this.navigation.hold(
      this.clock.now(),
      rayFrom,
      rayDir,
      hits,
      this.deadzone(),
      this.robot.floorWorldY() ?? 0,
      fromMarker,
      sourceId,
    );
  }

  releaseNavigation(rayFrom: Vec3, rayDir: Vec3, planes: readonly FloorPlane[], sourceId = "default"): void {
    if (!this.controlsEnabled() || !this.originStore.hasTrackingOrigin) {
      return;
    }
    const hits = navigationSurfaceHits(rayFrom, rayDir, planes, this.robot.floorWorldY() ?? 0);
    this.navigation.release(
      this.clock.now(),
      rayFrom,
      rayDir,
      hits,
      this.deadzone(),
      this.robot.floorWorldY() ?? 0,
      sourceId,
    );
  }

  cameraPreview(): ReturnType<HmdCameraSource["previewFrame"]> { return this.camera.previewFrame(); }

  isRobotSelected(): boolean { return this.selection.isSelected(); }

  setRobotSelected(selected: boolean): void {
    this.syncSelectionEligibility();
    this.selection.setSelected(selected);

  }

  toggleRobotSelection(): void { this.setRobotSelected(!this.selection.isSelected()); }

  aimNavigation(rayFrom: Vec3, rayDir: Vec3, planes: readonly FloorPlane[], sourceId = "default"): void {
    if (!this.controlsEnabled() || !this.originStore.hasTrackingOrigin) { this.navigation.clearAim(); return; }
    const floorY = this.robot.floorWorldY() ?? 0;
    this.navigation.aim(this.clock.now(), rayFrom, rayDir,
      navigationSurfaceHits(rayFrom, rayDir, planes, floorY), this.deadzone(), floorY, sourceId);
  }

  emergencyStop(): void {
    if (this.session.view().capabilities?.estop.available !== true) return;
    try {
      if (this.navigation.interaction.snapshot().goalActive) {
        if (!this.navigation.interaction.cancel(this.clock.now())) throw new Error("Stop request could not be sent");
      } else this.session.requestEstop();
      this.stopFeedbackRemaining = 0.35; this.ui.estopPressed = true;
      this.notifications.show({ text: "Emergency stop requested", tone: "danger", glyph: "stop", priority: 100 });
    } catch {
      this.notifications.show({ text: "Stop request failed", tone: "danger", glyph: "stop", priority: 100 });
    }
  }

  cancelNavigation(): void {
    this.navigation.cancel(this.clock.now());
  }

  controlsEnabled(): boolean {
    return this.ui.setupCompleted && !this.ui.alignmentReview?.pending && !this.ui.snapshot().setupCelebrating && this.ui.operatingMode === "manual" &&
      this.session.view().connection === "ready";
  }

  loseInput(completeDictation = false): void {
    this.speech.endRecording(!completeDictation);
    if (!completeDictation) this.navigation.cancelDrag();
    this.joystick.loseInput();
  }

  suspend(): void {
    this.lastTickAt = null;
    this.speech.stop();
    this.loseInput();
    this.episode.suspend();
    this.camera.clearTracking();
    this.setRobotSelected(false);
    this.robot.setHovered(false);
  }

  resumeTracking(): void {
    this.episode.resume();
    if (this.session.view().connection === "disconnected") this.session.start();
  }

  recoverUnknownTrackingReset(): void {
    this.suspend();
    this.episode.reset();
    this.session.restartPreservingTrackingOrigin();
  }

  invalidateTracking(): void {
    const step = this.ui.setupCompleted ? "localization" : this.ui.wizardStep;
    this.suspend();
    // Retire the socket so a result from the old reference space cannot restore alignment.
    this.session.stop();
    this.lastCamera = null;
    this.originStore.clear();
    this.episode.reset();
    this.navigation.reset();
    this.markers.object.visible = false;
    this.lidar.hide();
    this.route.hide();
    this.robot.reset();
    this.ui.restartSetup();
    this.ui.flow.showStep(step);
  }

  restartSetup(): void {
    this.setRobotSelected(false);
    this.speech.stop();
    this.loseInput();
    this.ui.restartSetup();
    this.originStore.clear();
    this.episode.reset();
    this.navigation.reset();
    this.markers.clearAll();
    this.lastMarkerOrigin = null;
    this.lidar.hide();
    this.route.hide();
    this.robot.reset();
  }

  /** Drops the current alignment and reruns the wizard's localization step. */
  realign(): void {
    this.restartSetup();
    this.ui.flow.showStep("localization");
    this.ui.restartLocalization();
  }

  deadzone(): RobotGroundDeadzone | null {
    const robot = this.session.view().hello?.robot;
    if (!robot) {
      return null;
    }
    return {
      radiusM: robotDeadzoneRadiusM(robot.footprint_m),
      getRobotWorldPosition: () => this.robot.worldPosition(),
      getRobotFloorWorldY: () => this.robot.floorWorldY(),
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeSelection();
    this.speech.stop();
    this.unsubscribeView?.();
    this.unsubscribeView = null;
    this.unsubscribeOutbound?.();
    this.unsubscribeOutbound = null;
    this.joystick.loseInput();
    this.navigation.dispose();
    this.notifications.dispose();
    this.markers.dispose();
    this.route.dispose(); this.previewRoute.dispose();
    this.lidar.dispose();
    this.robot.dispose();
    this.episode.dispose();
    this.session.stop();
    this.camera.dispose();
    this.transport.close();
  }

  private applyView(deltaS = 0): void {
    const view = this.session.view();
    const origin = this.originStore.T_odom_client;
    const now = this.clock.now();
    this.robot.apply(view, origin, this.ui.setupCompleted, this.unlocalizedFallback());
    this.syncSelectionEligibility();
    this.robot.setSelected(this.selection.isSelected());
    this.robot.setFloorVisible(this.navigation.marker.object.visible && this.navigation.interaction.snapshot().attachedToRobot === false);
    this.robot.setConnectorFloorY(this.navigation.interaction.snapshot().attachedToRobot ? this.navigation.marker.circleBounds().center[1] : null);
    this.robot.setCircleOpacity(this.navigation.marker.circleOpacity());
    this.robot.tick(deltaS);
    if (!this.ui.setupCompleted || !view.hasTrackingOrigin || !origin) {
      this.lidar.hide();
      this.route.hide(); this.previewRoute.hide();
      this.navigation.applyView(view, null, null, now);
      return;
    }
    this.lidar.apply(view.lidar?.points ?? null, origin, this.ui.lidarMode, view.pose?.position ?? null, view.hello?.robot.base_height_m ?? 0, view.pose?.orientation, view.hello?.robot.body_bounds_m, this.ui.lidarPreferences.pointLimit, this.ui.lidarPreferences.obstacleRangeM, view.hello?.robot.odom_scale_correction_factor ?? 1);
    this.navigation.setSelected(this.selection.isSelected());
    this.navigation.applyView(view, origin, this.robot.floorPose(), now);
    const goalY = this.navigation.marker.object.visible ? this.navigation.marker.pose().position[1] : null;
    this.route.apply(
      this.navigation.activePath(),
      origin,
      this.navigation.isRouteVisible(),
      this.robot.floorWorldY(),
      goalY,
      { executing: view.nav?.state === "following_path", startCircle: this.robot.floorCircleBounds(), endCircle: this.navigation.marker.circleBounds() },
    );
    this.previewRoute.apply(this.navigation.previewPath(), origin, this.navigation.isAiming(), this.robot.floorWorldY(), this.navigation.draftMarker.pose().position[1],
      { preview: true, startCircle: this.robot.floorCircleBounds(), endCircle: this.navigation.draftMarker.circleBounds() });
    if (origin !== this.lastMarkerOrigin) {
      this.markers.object.visible = true;
      this.lastMarkerOrigin = origin;
      this.markers.recompose(origin);
    }
  }

  private unlocalizedFallback(): Vec3 | null {
    if (!this.lastCamera) {
      return null;
    }
    const forward = rotateVecByQuat(this.lastCamera.orientation, [0, 0, -1]);
    return [
      this.lastCamera.position[0] + forward[0] * 1.4,
      0,
      this.lastCamera.position[2] + forward[2] * 1.4,
    ];
  }

  private maybeSendClientPose(): void { this.posePublisher.tick(); }

  private syncSelectionEligibility(): void {
    this.selection.setEligible(this.ui.setupCompleted && !this.ui.alignmentReview?.pending &&
      this.session.view().connection === "ready");
  }
}
