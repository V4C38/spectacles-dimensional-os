require("LensStudio:TextInputModule");

import type { LocalizationCaptureEpisode } from "../../DimOSARClient/localization/localizationCaptureEpisode";
import type { ClientTrackingOriginStore } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { AR_MODULE_CLIENT_CONFIG } from "../../DimOSARClient/websocket/hostPorts";
import {
  buildModuleWebSocketUrl,
  isValidHost,
  loadStoredModuleHost,
  type ModuleHostStore,
  saveModuleHost,
} from "../../DimOSARClient/websocket/hostNormalization";
import type { ARModuleSession } from "../../DimOSARClient/websocket/arModuleSession";
import type { SpecsWebSocketTransport } from "../websocket/SpecsWebSocketTransport";
import { localizationCaptureStatus } from "../../DimOSARClient/localization/localizationCaptureStatus";
import type { ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  NO_ROBOT_CONNECTED_LABEL,
  sessionLinkStatus,
  type SessionLinkPhase,
  type StatusText,
} from "../../DimOSARClient/websocket/sessionLinkStatus";
import { scaleIn } from "../utilities/AnimationUtilities";
import { COLOR_ERROR, COLOR_WHITE, statusToneColor } from "./UIKit";
import { SetupWizardStep, SetupWizardView } from "./SetupWizardView";

const WIZARD_STEP_TITLES = [
  "Start Robot & ARModule",
  "Connect",
  "Localization",
] as const;

const WIZARD_STEP_DESCRIPTIONS = [
  "Power on your robot.\nRun ./launcher/scripts/start.sh on your Mac.",
  "Enter your Mac's IP.\nUse same Wi‑Fi for robot, Mac, and Spectacles.",
  "Look at the robot while the headset captures views for localization.",
] as const;

function localizationStepDescription(displayName: string): string {
  return `Point your Spectacles at ${displayName}.\nHold steady while views are captured.`;
}

function connectStepStatus(input: {
  view: ARModuleSessionState;
  linkPhase: SessionLinkPhase;
  isConnecting: boolean;
  socketOpen: boolean;
  displayName?: string;
}): StatusText {
  if (input.isConnecting && !input.socketOpen) {
    return { text: "Connecting…", color: "error" };
  }
  if (input.isConnecting && input.socketOpen && input.view.connection === "awaiting_hello") {
    return { text: "Waiting for handshake…", color: "error" };
  }
  if (input.isConnecting && input.linkPhase === "disconnected") {
    return { text: "Connecting...", color: "error" };
  }
  return sessionLinkStatus(
    input.view,
    input.displayName ?? input.view.hello?.robot.display_name ?? NO_ROBOT_CONNECTED_LABEL,
  );
}

const NAV_DEBOUNCE_S = 0.35;
const CONNECT_RETRY_S = 2.0;
const CONNECT_RETRY_LOG_INTERVAL_S = 10.0;
const CONNECT_POLL_INTERVAL_S = 0.1;
const CONNECT_ATTEMPT_TIMEOUT_S = AR_MODULE_CLIENT_CONFIG.session.helloTimeoutS + 2;

export interface SetupWizardControllerDeps {
  panel: SceneObject;
  script: ScriptComponent;
  session: ARModuleSession;
  episode: LocalizationCaptureEpisode;
  transport: SpecsWebSocketTransport;
  clientTrackingOriginStore: ClientTrackingOriginStore;
  defaultWebsocketIp: string;
  hostStore: ModuleHostStore;
  onFinished: () => void;
  onDismissToRuntime: () => void;
}

export class SetupWizardController {
  private readonly deps: SetupWizardControllerDeps;
  private readonly view: SetupWizardView;
  private readonly retryEvent: DelayedCallbackEvent;
  private readonly pollEvent: DelayedCallbackEvent;
  private _currentStep = SetupWizardStep.StartRobot;
  private _connectStepCompleted = false;
  private _isConnecting = false;
  private _lastNavigationTime = -1;
  private _autoconnectOpId = 0;
  private _retryOpId = 0;
  private _pollOpId = 0;
  private _lastConnectRetryLogTime = -1;
  private _authoredLocalScale = new vec3(1, 1, 1);
  private _openedFromRuntime = false;
  private _hostValidationError: string | null = null;
  private _sessionStarted = false;
  private _visible = false;

  constructor(deps: SetupWizardControllerDeps) {
    this.deps = deps;
    this.view = new SetupWizardView(deps.panel);
    this._authoredLocalScale = deps.panel.getTransform().getLocalScale();

    const retryEv = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    retryEv.bind(() => this.onRetryFired());
    this.retryEvent = retryEv;

    const pollEv = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    pollEv.bind(() => this.onPollFired());
    this.pollEvent = pollEv;

    this.view.bindHandlers(
      () => this.onNext(),
      () => this.onPrevious(),
      () => this.startAutoconnect(),
    );
  }

  public start(fromRuntime: boolean): void {
    this._openedFromRuntime = fromRuntime;
    this._connectStepCompleted = false;
    this._isConnecting = false;
    this._lastNavigationTime = -1;
    this._hostValidationError = null;
    this._sessionStarted = false;
    this.invalidatePending();
    if (fromRuntime) {
      this.deps.episode.reset();
      this.deps.clientTrackingOriginStore.clear();
    } else {
      this.deps.clientTrackingOriginStore.clear();
    }
    this.show();
    this.setStep(SetupWizardStep.StartRobot);
  }

  public tick(): void {
    if (!this._visible || this._currentStep !== SetupWizardStep.Localization) {
      return;
    }
    this.renderLocalizationStatus();
  }

  public onSessionViewChanged(): void {
    if (this._currentStep === SetupWizardStep.Connect) {
      this.showConnectStatus();
      this.refreshFooterButtons();
      if (this.isConnected()) {
        this._connectStepCompleted = true;
        this._isConnecting = false;
        this.invalidatePending();
      }
    }
    if (this._currentStep === SetupWizardStep.Localization) {
      this.renderLocalizationStatus();
      this.refreshFooterButtons();
    }
  }

  public isVisible(): boolean {
    return this._visible;
  }

  private show(): void {
    this._visible = true;
    const panel = this.deps.panel;
    panel.enabled = false;
    scaleIn(panel, 0.5, this._authoredLocalScale);
  }

  private hide(): void {
    this._visible = false;
    this.deps.panel.enabled = false;
  }

  private setStep(step: SetupWizardStep): void {
    this.invalidatePending();
    this._currentStep = step;
    this.view.setStepContent(WIZARD_STEP_TITLES[step], this.stepDescription(step));
    this.view.applyStepLayout(step);

    switch (step) {
      case SetupWizardStep.StartRobot:
        this.view.setInputEnabled(false);
        this.view.setStatus("", COLOR_WHITE);
        this.refreshFooterButtons();
        break;
      case SetupWizardStep.Connect:
        this.view.setInputEnabled(true);
        this.initializeConnectInput();
        this.refreshFooterButtons();
        if (this.isConnected()) {
          this.showConnectStatus();
        } else {
          this.view.setStatus(
            this._hostValidationError ?? "Websocket disconnected",
            COLOR_ERROR,
          );
          this.startAutoconnect();
        }
        break;
      case SetupWizardStep.Localization:
        this.view.setInputEnabled(false);
        this.beginLocalizationCapture();
        this.renderLocalizationStatus();
        this.refreshFooterButtons();
        break;
    }
  }

  private stepDescription(step: SetupWizardStep): string {
    if (step !== SetupWizardStep.Localization) {
      return WIZARD_STEP_DESCRIPTIONS[step];
    }
    const displayName = this.deps.session.view().hello?.robot.display_name ?? "the robot";
    return localizationStepDescription(displayName);
  }

  private initializeConnectInput(): void {
    const stored = loadStoredModuleHost(this.deps.hostStore);
    if (stored !== null && !isValidHost(stored)) {
      this._hostValidationError = "Stored IP is invalid — enter a new IP";
      this.view.initializeInput(stored);
      return;
    }
    const initial = stored ?? this.deps.defaultWebsocketIp.trim();
    this.view.initializeInput(initial);
  }

  private onNext(): void {
    if (!this.canNavigate()) {
      return;
    }
    if (this._currentStep === SetupWizardStep.StartRobot) {
      if (this._openedFromRuntime) {
        this.deps.clientTrackingOriginStore.clear();
      }
      this.setStep(SetupWizardStep.Connect);
      return;
    }
    if (this._currentStep === SetupWizardStep.Connect) {
      if (!this.isConnected()) {
        this.cancelAutoconnect("connect step skipped", false);
        print("SetupWizardController: finish connect=skipped localization=skipped");
        this.finishWizard();
        if (this._sessionStarted) {
          this.deps.session.stop();
          this._sessionStarted = false;
        }
        return;
      }
      this.setStep(SetupWizardStep.Localization);
      return;
    }
    if (this._currentStep === SetupWizardStep.Localization) {
      if (!this.deps.session.view().hasTrackingOrigin) {
        return;
      }
      this.finishWizard();
    }
  }

  private onPrevious(): void {
    if (!this.canNavigate()) {
      return;
    }
    if (this._currentStep === SetupWizardStep.StartRobot) {
      if (this._openedFromRuntime) {
        this.dismissToRuntime();
      }
      return;
    }
    this.setStep((this._currentStep - 1) as SetupWizardStep);
  }

  private finishWizard(): void {
    this._openedFromRuntime = false;
    this.hide();
    this.deps.onFinished();
  }

  private beginLocalizationCapture(): void {
    if (!this.isConnected()) {
      return;
    }
    try {
      this.deps.episode.requestStart();
    } catch (error) {
      print(`SetupWizardController: requestStart failed — ${error}`);
    }
  }

  private dismissToRuntime(): void {
    this._openedFromRuntime = false;
    this.hide();
    this.deps.onDismissToRuntime();
  }

  private canNavigate(): boolean {
    const now = getTime();
    if (this._lastNavigationTime >= 0 && now - this._lastNavigationTime < NAV_DEBOUNCE_S) {
      return false;
    }
    this._lastNavigationTime = now;
    return true;
  }

  private startAutoconnect(): void {
    this._autoconnectOpId += 1;
    const opId = this._autoconnectOpId;
    if (this._currentStep !== SetupWizardStep.Connect) {
      return;
    }

    const ip = this.view.getInputText();
    if (!isValidHost(ip)) {
      this._hostValidationError = "Enter a valid IP address";
      this.view.setStatus(this._hostValidationError, COLOR_ERROR);
      this._isConnecting = false;
      this.refreshFooterButtons();
      return;
    }
    this._hostValidationError = null;
    saveModuleHost(this.deps.hostStore, ip);
    this._isConnecting = true;
    this.showConnectStatus();
    this.logConnectAttempt(ip);
    void this.tryConnect(ip, opId);
  }

  private async tryConnect(ip: string, opId: number): Promise<void> {
    const url = buildModuleWebSocketUrl(ip, AR_MODULE_CLIENT_CONFIG.port);
    try {
      if (this._sessionStarted) {
        this.deps.session.stop();
      }
      this.deps.transport.setUrl(url);
      this.deps.session.start();
      this._sessionStarted = true;
    } catch (error) {
      if (opId !== this._autoconnectOpId) {
        return;
      }
      this._isConnecting = false;
      this.showConnectStatus();
      this.scheduleAutoconnectRetry(opId);
      return;
    }

    this._pollOpId = opId;
    this.pollEvent.reset(CONNECT_POLL_INTERVAL_S);
  }

  private onPollFired(): void {
    if (this._pollOpId !== this._autoconnectOpId) {
      return;
    }
    const view = this.deps.session.view();
    if (view.connection === "ready") {
      this._isConnecting = false;
      this.showConnectStatus();
      this.refreshFooterButtons();
      return;
    }
    if (view.connection === "failed") {
      this._isConnecting = false;
      this.showConnectStatus();
      this.scheduleAutoconnectRetry(this._pollOpId);
      return;
    }
    this.pollEvent.reset(CONNECT_POLL_INTERVAL_S);
  }

  private scheduleAutoconnectRetry(opId: number): void {
    this.logConnectRetry();
    this._retryOpId = opId;
    this.retryEvent.reset(CONNECT_RETRY_S);
  }

  private onRetryFired(): void {
    if (
      this._retryOpId !== this._autoconnectOpId
      || this._currentStep !== SetupWizardStep.Connect
    ) {
      return;
    }
    this.startAutoconnect();
  }

  private invalidatePending(): void {
    this._autoconnectOpId += 1;
    this._pollOpId = this._autoconnectOpId;
    this.retryEvent.reset(0);
    this.pollEvent.reset(0);
  }

  private cancelAutoconnect(reason: string, disconnect: boolean): void {
    this.invalidatePending();
    if (disconnect) {
      this.deps.session.stop();
      this._sessionStarted = false;
    }
    print(`SetupWizardController: ${reason}`);
  }

  private isConnected(): boolean {
    return this.deps.session.view().connection === "ready";
  }

  private showConnectStatus(): void {
    const view = this.deps.session.view();
    const status = connectStepStatus({
      view,
      linkPhase: deriveSessionLinkPhase(view),
      isConnecting: this._isConnecting,
      socketOpen: view.connection === "awaiting_hello" || view.connection === "ready",
      displayName: view.hello?.robot.display_name,
    });
    this.view.setStatus(this._hostValidationError ?? status.text, statusToneColor(status.color));
  }

  private renderLocalizationStatus(): void {
    const sessionView = this.deps.session.view();
    const episodeView = this.deps.episode.view();
    const capture = localizationCaptureStatus(sessionView, episodeView);
    this.view.setStatus(capture.text, statusToneColor(capture.color));
  }

  private refreshFooterButtons(): void {
    const connected = this.isConnected();
    let footerNextLabel = "Skip";
    let footerNextEnabled = true;
    let footerShowPrev = this._currentStep !== SetupWizardStep.StartRobot;

    if (this._currentStep === SetupWizardStep.StartRobot) {
      footerNextLabel = "Complete";
      footerShowPrev = this._openedFromRuntime;
    } else if (this._currentStep === SetupWizardStep.Connect && connected) {
      footerNextLabel = "Complete";
    } else if (this._currentStep === SetupWizardStep.Localization) {
      footerNextLabel = "Complete";
      footerNextEnabled = this.deps.session.view().hasTrackingOrigin;
    }

    this.view.applyFooterState(this._currentStep, {
      footerNextLabel,
      footerNextEnabled,
      footerShowPrev,
    });
  }

  private logConnectAttempt(ip: string): void {
    const now = getTime();
    if (
      this._lastConnectRetryLogTime < 0
      || now - this._lastConnectRetryLogTime >= CONNECT_RETRY_LOG_INTERVAL_S
    ) {
      this._lastConnectRetryLogTime = now;
      print(`SetupWizardController: connect attempt ${ip}`);
    }
  }

  private logConnectRetry(): void {
    const now = getTime();
    if (
      this._lastConnectRetryLogTime < 0
      || now - this._lastConnectRetryLogTime >= CONNECT_RETRY_LOG_INTERVAL_S
    ) {
      this._lastConnectRetryLogTime = now;
      print("SetupWizardController: connect failed, retrying");
    }
  }
}
