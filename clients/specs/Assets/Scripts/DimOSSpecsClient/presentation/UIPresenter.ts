import type { LocalizationCaptureEpisode } from "../../DimOSARClient/localization/localizationCaptureEpisode";
import type { ClientTrackingOriginStore } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { localizationCaptureStatus } from "../../DimOSARClient/localization/localizationCaptureStatus";
import {
  lidarModeFromSettings,
  LIDAR_PRESETS,
  nextLidarMode,
  requestLidarSettings,
} from "../../DimOSARClient/sensors/lidarSettings";
import type { ARModuleSession, ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  sessionLinkStatus,
  sessionLinkTransitionLog,
  type SessionLinkPhase,
} from "../../DimOSARClient/websocket/sessionLinkStatus";
import type { SpecsWebSocketTransport } from "../websocket/SpecsWebSocketTransport";
import { odomToClientTrackingPose } from "../../DimOSARClient/localization/clientTrackingTransforms";
import { clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
import { scaleIn, scaleOut } from "../utilities/AnimationUtilities";
import { findChildRecursive, getFrameComponent, isFrameInitialized } from "./UIKit";
import { UILogger } from "./UILogger";
import { WristMenuController } from "./WristMenuController";
import { MainMenuView, type OperatingMode } from "./MainMenuView";
import { SetupWizardController, type SetupWizardFinishResult } from "./SetupWizardController";
import { AppState, agentModeAccessible } from "./AppState";
import { deriveRobotMarkerApplyInput, type RobotPresenter } from "./RobotPresenter";
import { AgentSpeechController } from "../agent/AgentSpeechController";
import type { SpecsTextToSpeech } from "./SpecsTextToSpeech";

const EDITOR_MENU_SCALE = 1.0;
const SPECTACLES_MENU_SCALE = 0.6;
const EDITOR_MENU_ANIM_DURATION = 0.35;
const SPECTACLES_MENU_SCALE_IN_DURATION = 0.25;
const SPECTACLES_MENU_SCALE_OUT_DURATION = 0.2;

type SetUIStateOptions = {
  immediate?: boolean;
};

export interface UIPresenterDeps {
  session: ARModuleSession;
  episode: LocalizationCaptureEpisode;
  transport: SpecsWebSocketTransport;
  clientTrackingOriginStore: ClientTrackingOriginStore;
  robotPresenter: RobotPresenter;
  defaultWebsocketIp: string;
  setupWizardPanel: SceneObject;
  mainUIFrame: SceneObject;
  wristMenuRoot: SceneObject;
  script: ScriptComponent;
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

  private deps: UIPresenterDeps | null = null;
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

  public getUILogger(): UILogger {
    return this.uiLogger;
  }

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
      script: this,
      session: deps.session,
      episode: deps.episode,
      transport: deps.transport,
      clientTrackingOriginStore: deps.clientTrackingOriginStore,
      defaultWebsocketIp: deps.defaultWebsocketIp,
      hostStore: global.persistentStorageSystem.store,
      onFinished: (result) => this.finishWizard(result),
      onDismissToRuntime: () => this.finishWizard({ localized: this.appState.wizardLocalized }),
    });
    this.bindRuntimeHud();
    this.setupWizardController.start(false);
    this.mainUIFrame.enabled = false;
  }

  public tick(dt: number): void {
    this.setupWizardController?.tick();
    this.uiLogger.tick();
    this.deps?.speechController?.tick();
    this.wristMenuController?.tick(dt);
    if (!this.appState.wizardFinished) {
      this.ensureWizardLidarOff();
      return;
    }
    this.refreshHud();
    this.refreshRobotLabels();
    this.refreshCameraStatus();
  }

  public onSessionView(view: ARModuleSessionState, prevView: ARModuleSessionState | null): void {
    const prevPhase = prevView ? deriveSessionLinkPhase(prevView) : this.linkPhase;
    const nextPhase = deriveSessionLinkPhase(view);
    this.linkPhase = nextPhase;
    this.setupWizardController?.onSessionViewChanged();

    const transition = sessionLinkTransitionLog(prevPhase, nextPhase);
    if (transition && this.appState.wizardFinished) {
      this.uiLogger.show(
        transition.hudText,
        transition.hudColor,
        transition.hudDurationS ?? null,
      );
      this.uiLogger.logConsole(transition.consoleText, transition.consoleColor);
    }

    if (view.state?.lidar) {
      this.appState.setLidarMode(lidarModeFromSettings(view.state.lidar));
      this.mainMenuView?.setLidarModeDisplay(this.appState.lidarMode);
    }
  }

  public isWizardFinished(): boolean {
    return this.appState.wizardFinished;
  }

  public isWizardLocalized(): boolean {
    return this.appState.wizardLocalized;
  }

  public applyRoomPresentation(view: ARModuleSessionState): void {
    const deps = this.requireDeps();
    const origin = deps.clientTrackingOriginStore.T_odom_client;
    const input = deriveRobotMarkerApplyInput({
      appState: this.appState,
      view,
      origin,
    });
    if (input.mode === "unlocalizedBelowUi") {
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

  private mainUiFallbackScale(): number {
    return this.isEditorMode ? EDITOR_MENU_SCALE : SPECTACLES_MENU_SCALE;
  }

  private prepareMainUiPlacementAnchor(): void {
    const panel = this.mainUIFrame;
    const scale = this.mainUiFallbackScale();
    const visibleScale = new vec3(scale, scale, scale);
    if (this.isEditorMode) {
      panel.enabled = true;
      panel.getTransform().setLocalScale(visibleScale);
      return;
    }
    if (this.wristMenuRoot) {
      panel.getTransform().setWorldPosition(this.wristMenuRoot.getTransform().getWorldPosition());
    }
    panel.enabled = true;
    panel.getTransform().setLocalScale(visibleScale);
  }

  private finishWizard(result: SetupWizardFinishResult): void {
    this.appState.finishWizard(result.localized);
    this.postWizardLidarSent = false;
    if (!result.localized && this.isEditorMode) {
      this.setUIState(1, { immediate: true });
    }
    this.applyRoomPresentation(this.requireDeps().session.view());
    if (this.isEditorMode) {
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
    const panel = this.mainUIFrame;
    this.mainMenuView = new MainMenuView(panel, {
      onRestart: () => this.restartSetup(),
      onLidarModeCycle: () => this.cycleLidarMode(),
      onModeButtonPressed: (mode) => {
        const accessible = agentModeAccessible(
          this.requireDeps().session.view().capabilities?.agent.available === true,
          this.appState.debugModeEnabled,
        );
        const next = mode === "agent" && !accessible ? "manual" : mode;
        this.appState.setOperatingMode(next);
        this.mainMenuView?.setOperatingMode(next);
        this.deps?.speechController?.syncEnabled();
      },
      onEmergencyStop: () => {
        try {
          this.requireDeps().session.requestEstop();
        } catch (error) {
          print(`UIPresenter: estop failed — ${error}`);
        }
      },
      onDebugModeChanged: (enabled) => {
        this.appState.setDebugMode(enabled);
        this.mainMenuView?.setDebugModeToggle(enabled);
        this.refreshHud();
      },
      getLidarMode: () => this.appState.lidarMode,
      getOperatingMode: () => this.appState.operatingMode,
      getDebugModeValue: () => this.appState.debugModeEnabled,
    });

    const debugLogRoot = findChildRecursive(panel, "DebugLog");
    if (debugLogRoot) {
      this.uiLogger.bindConsoleOutput(debugLogRoot);
    }

    this.configureMenuMotion(panel);
    this.mainMenuView.setLidarModeDisplay(this.appState.lidarMode);
    this.mainMenuView.setOperatingMode(this.appState.operatingMode);
    this.mainMenuView.setDebugModeToggle(this.appState.debugModeEnabled);
    this.refreshHud();
  }

  private restartSetup(): void {
    this.appState.resetWizard();
    this.wizardLidarOffSent = false;
    this.postWizardLidarSent = false;
    this.unlocalizedUiPrepared = false;
    this.setUIState(0, { immediate: true });
    const deps = this.requireDeps();
    deps.session.stop();
    this.mainMenuView?.setOperatingMode(this.appState.operatingMode);
    this.refreshHud();
    deps.clientTrackingOriginStore.clear();
    deps.robotPresenter.reset();
    deps.episode.reset();
    const controller = this.setupWizardController;
    if (!controller) {
      throw new Error("UIPresenter: setup wizard controller missing");
    }
    controller.start(true);
  }

  private cycleLidarMode(): void {
    const deps = this.requireDeps();
    const available = deps.session.view().capabilities?.lidar.available ?? false;
    if (!available) {
      return;
    }
    this.appState.setLidarMode(nextLidarMode(this.appState.lidarMode));
    this.mainMenuView?.setLidarModeDisplay(this.appState.lidarMode);
    try {
      requestLidarSettings(deps.session, LIDAR_PRESETS[this.appState.lidarMode]);
    } catch (error) {
      print(`UIPresenter: lidar preset failed — ${error}`);
    }
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
    this.appState.setLidarMode("obstacles");
    this.mainMenuView?.setLidarModeDisplay(this.appState.lidarMode);
    try {
      requestLidarSettings(session, LIDAR_PRESETS[this.appState.lidarMode]);
      this.postWizardLidarSent = true;
    } catch {
      // retry on next refresh
    }
  }

  private refreshHud(): void {
    const deps = this.requireDeps();
    const view = deps.session.view();
    const status = sessionLinkStatus(view, view.hello?.robot.display_name);
    this.mainMenuView?.setStatus(status.text, status.color);
    const agentAvailable = view.capabilities?.agent.available === true;
    this.mainMenuView?.setLidarModeAvailability(
      view.capabilities?.lidar.available === true,
      this.appState.lidarMode,
    );
    this.mainMenuView?.setEmergencyStopAvailability(
      view.capabilities?.estop.available === true,
      view.capabilities?.estop.reason ?? null,
    );
    this.mainMenuView?.setAgentModeAvailability(
      agentModeAccessible(agentAvailable, this.appState.debugModeEnabled),
    );
    if (
      !agentModeAccessible(agentAvailable, this.appState.debugModeEnabled) &&
      this.appState.operatingMode === "agent"
    ) {
      this.appState.setOperatingMode("manual");
      this.mainMenuView?.setOperatingMode("manual");
    }
    this.deps?.speechController?.syncEnabled();
    this.sendPostWizardLidarDefault();
    if (this.appState.debugModeEnabled && view.pose && view.hasTrackingOrigin) {
      const origin = deps.clientTrackingOriginStore.T_odom_client;
      if (origin) {
        const specs = clientTrackingToSpecsPose(odomToClientTrackingPose(view.pose, origin));
        this.uiLogger.logConsole(
          `Pose ${specs.position.map((v) => v.toFixed(2)).join(", ")}`,
          new vec4(1, 1, 1, 1),
        );
      }
    }
  }

  private refreshRobotLabels(): void {
    const deps = this.requireDeps();
    deps.robotPresenter.refreshLabels(this.appState, deps.session.view(), {
      asrRunning: deps.speechController?.asrRunning ?? false,
      ttsPlaying: deps.tts?.isPlaying ?? false,
    });
  }

  private refreshCameraStatus(): void {
    const deps = this.requireDeps();
    const capture = localizationCaptureStatus(deps.session.view(), deps.episode.view());
    this.uiLogger.setCameraStatus(capture.text, capture.color);
  }

  private configureMenuMotion(panel: SceneObject): void {
    const deferEvent = this.createEvent("UpdateEvent");
    deferEvent.bind(() => {
      if (!isFrameInitialized(getFrameComponent(panel))) {
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
      onBeforeShow: () => {
        this.mainMenuView?.applySpectaclesFrameMotion();
        this.requestStateIfReady();
      },
      onMenuShow: () => this.setUIState(1),
      onMenuHide: (immediate) => this.setUIState(0, { immediate }),
    });
  }

  private setUIState(state: number, options?: SetUIStateOptions): void {
    const immediate = options?.immediate ?? false;
    if (!immediate && this.uiState === state) {
      return;
    }
    this.uiState = state;
    const panel = this.mainUIFrame;
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

  private requireDeps(): UIPresenterDeps {
    if (!this.deps) {
      throw new Error("UIPresenter.bind() must be called before use");
    }
    return this.deps;
  }
}
