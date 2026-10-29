import type { RobotSelection } from "../../DimOSARClient/robot/RobotSelection";
import { getRobotActivityState } from "../../DimOSARClient/robot/RobotMarkerState";
import { RUNTIME_PANEL_SCALE } from "./PanelLayout";
import { SpecsCameraStream } from "../localization/SpecsCameraStream";
import { SetupFlow } from "../../DimOSARClient/presentation/SetupFlow";
import type { SpecsUISnapshot } from "./SpecsUISnapshot";
import { LidarDisplayController } from "../../DimOSARClient/sensors/LidarDisplayController";
import type { LocalizationCaptureEpisode } from "../../DimOSARClient/localization/localizationCaptureEpisode";
import type { ClientTrackingOriginStore } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { localizationCaptureStatus } from "../../DimOSARClient/localization/localizationCaptureStatus";
import {
  LIDAR_PRESETS,
  requestLidarSettings,
} from "../../DimOSARClient/sensors/lidarSettings";
import type { ARModuleSession, ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  sessionLinkTransitionLog,
  type SessionLinkPhase,
} from "../../DimOSARClient/websocket/sessionLinkStatus";
import type { SpecsWebSocketTransport } from "../websocket/SpecsWebSocketTransport";
import { DEFAULT_SCALE_ANIMATION_VERSION_KEY, nextAnimationVersion, scaleIn, scaleOut } from "../utilities/AnimationUtilities";
import { placePanelInFront, getFrameComponent, isFrameInitialized, statusToneColor } from "./UIKit";
import { UILogger } from "./UILogger";
import { WristMenuController } from "./WristMenuController";
import { MainMenuView } from "./MainMenuView";
import type { IpRelayClient } from "../IpRelayClient";
import { SetupWizardController } from "./SetupWizardController";
import {
  AppState,
  agentModeAccessible,
  deriveRobotMarkerApplyInput,
  type OperatingMode,
} from "./AppState";
import type { RobotPresenter } from "./RobotPresenter";
import { AgentSpeechController } from "../agent/AgentSpeechController";
import type { SpecsTextToSpeech } from "./SpecsTextToSpeech";

const EDITOR_MENU_SCALE = RUNTIME_PANEL_SCALE;
const SPECTACLES_MENU_SCALE = RUNTIME_PANEL_SCALE;
const EDITOR_MENU_ANIM_DURATION = 0.35;
const SPECTACLES_MENU_SCALE_IN_DURATION = 0.25;
const SPECTACLES_MENU_SCALE_OUT_DURATION = 0.2;

type SetUIStateOptions = {
  immediate?: boolean;
};

export interface UIPresenterDeps {
  session: Pick<ARModuleSession, "view" | "start" | "stop" | "sendText" | "requestState">;
  episode: LocalizationCaptureEpisode;
  transport: SpecsWebSocketTransport;
  clientTrackingOriginStore: ClientTrackingOriginStore;
  robotPresenter: RobotPresenter;
  cameraObject: SceneObject;
  defaultWebsocketIp: string;
  ipRelayClient: IpRelayClient;
  setupWizardPanel: SceneObject;
  mainUIFrame: SceneObject;
  wristMenuRoot: SceneObject;
  script: ScriptComponent;
  selection: Pick<RobotSelection, "snapshot" | "toggle">;
  emergencyStop: () => void;
  onModeChanged: () => void;
  speechController?: AgentSpeechController | null;
  tts?: SpecsTextToSpeech | null;
}

@component
export class UIPresenter extends BaseScriptComponent {
  @input
  setupWizardPanel: SceneObject;

  @input
  mainUIFrame: SceneObject;

  @input
  wristMenuRoot: SceneObject;

  private disposed = false;
  private menuMotionEvent: SceneEvent | null = null;
  private deps: UIPresenterDeps | null = null;
  private lidarDisplay: LidarDisplayController | null = null;
  private readonly appState = new AppState();
  private setupWizardController: SetupWizardController | null = null;
  private mainMenuView: MainMenuView | null = null;
  private uiLogger = new UILogger();
  private wristMenuController: WristMenuController | null = null;
  private uiState = -1;
  private isEditorMode = false;
  private linkPhase: SessionLinkPhase = "disconnected";
  private wizardLidarOffSent = false;
  private postWizardLidarSent = false;
  private unlocalizedUiPrepared = false;
  private setupFlow: SetupFlow | null = null;
  private get setupCompleted(): boolean { return this.setupFlow?.completed ?? false; }
  private stopPressedUntil = 0;
  private setupRestartPending = false;

  public getOperatingMode(): OperatingMode {
    return this.appState.operatingMode;
  }

  public getDebugMode(): boolean {
    return this.appState.debugModeEnabled;
  }

  public attachVoice(speechController: AgentSpeechController, tts: SpecsTextToSpeech): void {
    const deps = this.requireDeps();
    deps.speechController = speechController;
    deps.tts = tts;
  }

  public bind(deps: Omit<UIPresenterDeps, "setupWizardPanel" | "mainUIFrame" | "wristMenuRoot">): void {
    this.setupFlow = new SetupFlow(deps.session, deps.episode);
    const store = global.persistentStorageSystem.store;
    this.lidarDisplay = new LidarDisplayController(deps.session, {
      read: () => {
        try {
          const saved = store.getString("dimos.sensors.v1");
          return saved ? JSON.parse(saved) : { pointLimit: 1500, obstacleRangeM: 0.6, fullRangeM: 5 };
        } catch { return { pointLimit: 1500, obstacleRangeM: 0.6, fullRangeM: 5 }; }
      },
      write: preferences => store.putString("dimos.sensors.v1", JSON.stringify(preferences)),
    });
    this.deps = {
      ...deps,
      setupWizardPanel: this.setupWizardPanel,
      mainUIFrame: this.mainUIFrame,
      wristMenuRoot: this.wristMenuRoot,
    };
  }

  public start(): void {
    const deps = this.requireDeps();
    this.isEditorMode = global.deviceInfoSystem.isEditor();
    this.setupWizardController = new SetupWizardController({
      panel: this.setupWizardPanel,
      cameraObject: deps.cameraObject,
      previewTexture: () => SpecsCameraStream.getInstance().previewTexture(),
      flow: this.setupFlow!,
      script: this,
      session: deps.session,
      episode: deps.episode,
      transport: deps.transport,
      clientTrackingOriginStore: deps.clientTrackingOriginStore,
      defaultWebsocketIp: deps.defaultWebsocketIp,
      hostStore: global.persistentStorageSystem.store,
      ipRelayClient: deps.ipRelayClient,
      onFinished: () => this.finishWizard(),
      onDismissToRuntime: () => this.finishWizard(),
    });
    this.bindRuntimeHud();
    this.mainMenuView?.setVisible(false);
    this.setupWizardController.start(false);
    if (this.isEditorMode) {
      this.mainUIFrame.enabled = false;
      return;
    }
    // Stay enabled at scale 0 so Frame.OnStart runs during the wizard. Disabling
    // here skips that start, and the first palm-up then initializes the frame
    // while reading followButton, which crashes the lens.
    this.mainUIFrame.getTransform().setLocalScale(new vec3(0, 0, 0));
  }

  public tick(dt: number): void {
    if (this.disposed) return;
    if (this.setupRestartPending) {
      this.setupRestartPending = false;
      this.performSetupRestart();
    }
    this.setupWizardController?.tick(dt);
    this.uiLogger.tick();
    this.deps?.speechController?.tick();
    if (!this.setupCompleted) {
      this.ensureWizardLidarOff();
      return;
    }
    this.wristMenuController?.tick(dt);
    this.refreshHud();
    this.refreshRobotLabels();
    this.refreshLocalizationCaptureStatus();
    this.mainMenuView?.apply(this.snapshot());
    this.mainMenuView?.tick(dt);
  }

  public onSessionView(view: ARModuleSessionState, prevView: ARModuleSessionState | null): void {
    if (this.disposed) return;
    const prevPhase = prevView ? deriveSessionLinkPhase(prevView) : this.linkPhase;
    const nextPhase = deriveSessionLinkPhase(view);
    this.linkPhase = nextPhase;
    this.setupWizardController?.onSessionViewChanged();
    if (this.setupCompleted && view.connection === "ready" && view.alignmentRequired && !view.hasTrackingOrigin && !this.isAlignmentReviewPending()) {
      this.requestAlignmentReview("Robot odometry reference changed");
    }

    const transition = sessionLinkTransitionLog(prevPhase, nextPhase);
    if (transition && this.setupCompleted) {
      this.uiLogger.show(
        transition.hudText,
        statusToneColor(transition.hudColor),
        transition.hudDurationS ?? null,
      );
      this.uiLogger.logConsole(transition.consoleText, statusToneColor(transition.consoleColor));
    }

    if (view.state?.lidar) {
      this.lidarDisplay?.observe(view);
    }
  }

  public invalidateSetupBaseline(): void { this.setupWizardController?.invalidateBaseline(); }

  public isAlignmentReviewPending(): boolean { return this.setupFlow?.alignmentReview?.pending === true; }

  public isSetupCompleted(): boolean {
    return this.setupCompleted;
  }

  public applyRoomPresentation(view: ARModuleSessionState): void {
    const deps = this.requireDeps();
    const origin = deps.clientTrackingOriginStore.T_odom_client;
    const input = deriveRobotMarkerApplyInput({
      setupCompleted: this.setupCompleted,
      view,
      origin,
    });
    if (input.mode === "unlocalizedFallbackPosition") {
      if (!this.unlocalizedUiPrepared) {
        this.prepareMainUiPlacementAnchor();
        this.unlocalizedUiPrepared = true;
      }
    } else {
      this.unlocalizedUiPrepared = false;
    }
    deps.robotPresenter.apply(input, {
      mainUi: this.mainUIFrame,
      fallbackUniformScale: this.mainUiFallbackScale(),
      appState: this.appState,
    });
  }

  getLidarMode() { return this.lidarDisplay?.mode ?? "off"; }
  getLidarPreferences() { return this.lidarDisplay?.preferences ?? { pointLimit: 1500, obstacleRangeM: 0.6, fullRangeM: 5 }; }
  snapshot(): SpecsUISnapshot {
    const deps = this.requireDeps(), view = deps.session.view();
    const capture = localizationCaptureStatus(view, deps.episode.view(), getTime());
    const preview = SpecsCameraStream.getInstance().previewTexture();
    const phase = deriveSessionLinkPhase(view);
    const selection = deps.selection.snapshot();
    return {
      robotConnectionText: { disconnected: "Disconnected", connecting: "Connecting…", robotOffline: "Robot offline", connected: "Connected" }[phase],
      activity: getRobotActivityState(view, { asrRunning: deps.speechController?.asrRunning ?? false, ttsPlaying: deps.tts?.isPlaying ?? false }),
      hudText: this.uiLogger.snapshot?.text ?? "",
      hasTrackingOrigin: view.hasTrackingOrigin,
      cameraStatus: preview ? `Capturing · ${preview.getWidth()} × ${preview.getHeight()}` : "Not capturing",
      trackingStatus: "Tracking", surfaceCount: "—",
      robotName: view.hello?.robot.display_name ?? "Robot",
      robotSelected: selection.selected,
      robotSelectable: selection.eligible,
      operatingMode: this.getOperatingMode(), agentAvailable: view.capabilities?.agent.available === true,
      speech: deps.speechController?.snapshot() ?? null,
      lidarAvailable: view.capabilities?.lidar.available === true, lidarMode: this.getLidarMode(),
      lidarPreferences: { ...this.getLidarPreferences() }, lidarReceived: view.lidar?.points.length ?? 0,
      debugEnabled: this.getDebugMode(),
      debugText: `Localization timings: ${JSON.stringify(deps.episode.timing())}\nConnection: ${view.connection}\nLocalized: ${view.hasTrackingOrigin ? "Yes" : "No"}\nCapture: ${capture.text}\n${deps.episode.view().lastError ?? ""}`,
      estopAvailable: view.capabilities?.estop.available === true,
      estopPressed: getTime() < this.stopPressedUntil,
      alignmentReview: this.setupFlow?.alignmentReview?.pending === true,
    };
  }
  requestEmergencyStop(): void {
    this.requireDeps().emergencyStop();
    this.stopPressedUntil = getTime() + 0.35;
  }
  closeMenu(): void { this.deps?.speechController?.endRecording(true); this.wristMenuController?.closeImmediate(); this.setUIState(0); }
  requestAlignmentReview(reason: string): void {
    this.setupFlow?.requestAlignmentReview(reason);
    placePanelInFront(this.mainUIFrame, this.requireDeps().cameraObject);
    this.mainMenuView?.placed();
    this.mainMenuView?.setFrameFollowEnabled(true);
    this.wristMenuController?.pin();
    this.setUIState(1);
  }
  dismissAlignmentReview(): void {
    this.setupFlow?.dismissAlignmentReview();
    this.mainMenuView?.setFrameFollowEnabled(false);
    this.closeMenu();
  }
  realign(): void {
    const deps = this.requireDeps();
    if (this.setupCompleted && !this.isAlignmentReviewPending() &&
        deps.session.view().connection === "ready" && deps.session.view().hasTrackingOrigin &&
        deps.clientTrackingOriginStore.mapAlignment) {
      deps.episode.requestCorrection();
      this.closeMenu();
      return;
    }
    deps.speechController?.reset();
    deps.onModeChanged();
    deps.episode.reset();
    deps.robotPresenter.reset();
    this.wizardLidarOffSent = false;
    this.postWizardLidarSent = false;
    this.closeMenu();
    this.setupWizardController?.realign();
  }

  private mainUiFallbackScale(): number {
    return this.isEditorMode ? EDITOR_MENU_SCALE : SPECTACLES_MENU_SCALE;
  }

  private prepareMainUiPlacementAnchor(): void {
    const panel = this.mainUIFrame;
    const scale = this.mainUiFallbackScale();
    const visibleScale = new vec3(scale, scale, scale);
    if (this.isEditorMode) {
      placePanelInFront(panel, this.requireDeps().cameraObject, -18);
      panel.enabled = true;
      panel.getTransform().setLocalScale(visibleScale);
      this.mainMenuView?.placed();
      return;
    }
    if (this.wristMenuRoot) {
      panel.getTransform().setWorldPosition(this.wristMenuRoot.getTransform().getWorldPosition());
    }
  }

  private finishWizard(): void {
    this.mainMenuView?.showPage("main");
    this.postWizardLidarSent = false;
    const view = this.requireDeps().session.view();
    if (!view.hasTrackingOrigin && this.isEditorMode) {
      this.setUIState(1, { immediate: true });
    }
    this.applyRoomPresentation(view);
    print("UIPresenter: setup complete, robot presentation applied");
    if (this.isEditorMode) {
      this.prepareMainUiPlacementAnchor();
      this.setUIState(1);
    }
    this.sendPostWizardLidarDefault();
    this.requestStateIfReady();
    this.refreshHud();
  }

  private requestStateIfReady(): void {
    const session = this.requireDeps().session;
    if (session.view().connection !== "ready") {
      return;
    }
    try {
      session.requestState();
    } catch (error) {
      print(`UIPresenter: requestState failed — ${error}`);
    }
  }

  private bindRuntimeHud(): void {
    const deps = this.requireDeps();
    const panel = this.mainUIFrame;
    this.mainMenuView = new MainMenuView(panel, {
      onRestart: () => this.restartSetup(),
      onModeButtonPressed: (mode) => {
        const accessible = agentModeAccessible(
          this.requireDeps().session.view().capabilities?.agent.available === true,
          this.appState.debugModeEnabled,
        );
        const next = mode === "agent" && !accessible ? "manual" : mode;
        this.appState.setOperatingMode(next);
        this.deps?.speechController?.syncEnabled();
        this.deps?.onModeChanged();
      },
      onEmergencyStop: () => this.requestEmergencyStop(),
      onRobot: () => deps.selection.toggle(),
      onClose: () => this.closeMenu(),
      onPin: () => { this.wristMenuController?.pin(); this.mainMenuView?.setFrameFollowEnabled(false); },
      onLidarMode: mode => this.lidarDisplay?.setMode(mode),
      onLidarRange: direction => this.lidarDisplay?.adjustRange(direction),
      onLidarPoints: direction => this.lidarDisplay?.adjustPoints(direction),
      onRealign: () => this.realign(),
      onDismissAlignment: () => this.dismissAlignmentReview(),
      onRecord: () => { this.deps?.speechController?.beginRecording(); },
      onRecordEnd: cancel => this.deps?.speechController?.endRecording(cancel),
      onSend: () => { this.deps?.speechController?.submit(); },
      onClear: () => this.deps?.speechController?.setDraft(""),
      onDebugModeChanged: (enabled) => {
        this.appState.setDebugMode(enabled);
        this.refreshHud();
      },
    });

    this.configureMenuMotion(panel);
    this.refreshHud();
  }

  private restartSetup(): void {
    // Leave the native button's trigger dispatch before disabling its hierarchy.
    this.setupRestartPending = true;
  }

  private performSetupRestart(): void {
    const controller = this.setupWizardController;
    if (!controller) {
      throw new Error("UIPresenter: setup wizard controller missing");
    }
    nextAnimationVersion(this.setupWizardPanel, DEFAULT_SCALE_ANIMATION_VERSION_KEY);
    this.appState.setOperatingMode("manual");
    this.wizardLidarOffSent = false;
    this.postWizardLidarSent = false;
    this.unlocalizedUiPrepared = false;
    this.wristMenuController?.closeImmediate();
    this.setUIState(0, { immediate: true });
    const deps = this.requireDeps();
    deps.speechController?.reset();
    deps.onModeChanged();
    this.refreshHud();
    deps.robotPresenter.reset();
    controller.start(true);
  }

  private ensureWizardLidarOff(): void {
    if (this.wizardLidarOffSent) {
      return;
    }
    const session = this.requireDeps().session;
    if (session.view().connection !== "ready") {
      return;
    }
    try {
      requestLidarSettings(session, LIDAR_PRESETS.off);
      this.wizardLidarOffSent = true;
    } catch {
      // retry on next tick
    }
  }

  private sendPostWizardLidarDefault(): void {
    if (this.postWizardLidarSent) {
      return;
    }
    const session = this.requireDeps().session;
    if (session.view().connection !== "ready") {
      return;
    }

    try {
      this.lidarDisplay?.setMode("obstacles");
      this.postWizardLidarSent = true;
    } catch {
      // retry on next refresh
    }
  }

  private refreshHud(): void {
    const deps = this.requireDeps();
    const view = deps.session.view();
    const agentAvailable = view.capabilities?.agent.available === true;
    if (
      !agentModeAccessible(agentAvailable, this.appState.debugModeEnabled) &&
      this.appState.operatingMode === "agent"
    ) {
      this.appState.setOperatingMode("manual");
    }
    this.deps?.speechController?.syncEnabled();
    this.sendPostWizardLidarDefault();
  }

  private refreshRobotLabels(): void {
    const deps = this.requireDeps();
    deps.robotPresenter.refreshLabels(this.appState, deps.session.view(), {
      asrRunning: deps.speechController?.asrRunning ?? false,
      ttsPlaying: deps.tts?.isPlaying ?? false,
      status: deps.speechController?.snapshot().status,
    });
  }

  private refreshLocalizationCaptureStatus(): void {
    const deps = this.requireDeps();
    const capture = localizationCaptureStatus(deps.session.view(), deps.episode.view(), getTime());
    this.uiLogger.setLocalizationCaptureStatus(capture.text, statusToneColor(capture.color));
  }

  private configureMenuMotion(panel: SceneObject): void {
    const deferEvent = this.createEvent("UpdateEvent");
    this.menuMotionEvent = deferEvent;
    deferEvent.bind(() => {
      if (this.disposed || !isFrameInitialized(getFrameComponent(panel))) {
        return;
      }
      deferEvent.enabled = false;
      if (this.isEditorMode) {
        this.mainMenuView?.applyEditorFrameMotion();
        panel.getTransform().setLocalScale(
          new vec3(EDITOR_MENU_SCALE, EDITOR_MENU_SCALE, EDITOR_MENU_SCALE),
        );
        return;
      }
      this.mainMenuView?.applySpectaclesFrameMotion();
      this.ensureWristMenuController(panel);
    });
  }

  private ensureWristMenuController(panel: SceneObject): void {
    if (this.isEditorMode || this.wristMenuController || !this.wristMenuRoot) {
      return;
    }
    this.wristMenuController = new WristMenuController({
      panel,
      anchorRoot: this.wristMenuRoot,
      handType: "left",
      cameraObject: this.requireDeps().cameraObject,
      centerOffsetCm: () => (76 - (getFrameComponent(panel)?.totalSize.y ?? 76)) * SPECTACLES_MENU_SCALE / 2,
      onBeforeShow: () => {
        this.mainMenuView?.applySpectaclesFrameMotion();
        this.requestStateIfReady();
      },
      onMenuShow: () => { this.mainMenuView?.placed(); this.setUIState(1); },
      onMenuHide: (immediate) => { this.mainMenuView?.setFrameFollowEnabled(false); this.setUIState(0, { immediate }); },
      onPin: () => this.mainMenuView?.setFrameFollowEnabled(false),
    });
  }

  private setUIState(state: number, options?: SetUIStateOptions): void {
    const immediate = options?.immediate ?? false;
    if (!immediate && this.uiState === state) {
      return;
    }
    this.uiState = state;
    const panel = this.mainUIFrame;
    this.mainMenuView?.setVisible(state !== 0);
    if (immediate) nextAnimationVersion(panel, DEFAULT_SCALE_ANIMATION_VERSION_KEY);
    const menuScale = this.isEditorMode ? EDITOR_MENU_SCALE : SPECTACLES_MENU_SCALE;
    const visibleScale = new vec3(menuScale, menuScale, menuScale);
    if (state === 0) {
      if (immediate) {
        panel.enabled = false;
        panel.getTransform().setLocalScale(new vec3(0, 0, 0));
        return;
      }
      scaleOut(
        panel,
        this.isEditorMode ? EDITOR_MENU_ANIM_DURATION : SPECTACLES_MENU_SCALE_OUT_DURATION,
      );
      return;
    }
    if (immediate) {
      panel.enabled = true;
      panel.getTransform().setLocalScale(visibleScale);
    } else {
      scaleIn(
        panel,
        this.isEditorMode ? EDITOR_MENU_ANIM_DURATION : SPECTACLES_MENU_SCALE_IN_DURATION,
        visibleScale,
      );
    }
    this.requestStateIfReady();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.setupRestartPending = false;
    if (this.menuMotionEvent) { this.menuMotionEvent.enabled = false; this.removeEvent(this.menuMotionEvent); this.menuMotionEvent = null; }
    nextAnimationVersion(this.setupWizardPanel, DEFAULT_SCALE_ANIMATION_VERSION_KEY);
    nextAnimationVersion(this.mainUIFrame, DEFAULT_SCALE_ANIMATION_VERSION_KEY);
    this.setupWizardController?.dispose();
    this.mainMenuView?.dispose();
    this.setupWizardController = null; this.mainMenuView = null; this.wristMenuController = null;
    this.deps = null;
  }

  private requireDeps(): UIPresenterDeps {
    if (!this.deps) {
      throw new Error("UIPresenter.bind() must be called before use");
    }
    return this.deps;
  }
}
