import { SETUP_PANEL_SCALE } from "./PanelLayout";
import { availableFeatures, localizationGuidance, localizationProviderLabel } from "../../DimOSARClient/presentation/ControlPanelPresentation";
import { SetupFlow } from "../../DimOSARClient/presentation/SetupFlow";
require("LensStudio:TextInputModule");

import type { LocalizationCaptureEpisode } from "../../DimOSARClient/localization/localizationCaptureEpisode";
import type { ClientTrackingOrigin, ClientTrackingOriginStore } from "../../DimOSARClient/localization/clientTrackingOrigin";
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
import {
  routeConnectionField,
  toggleConnectionMethod,
  type ConnectionMethod,
  type IpRelayClient,
} from "../IpRelayClient";
import { scaleIn, nextAnimationVersion, DEFAULT_SCALE_ANIMATION_VERSION_KEY } from "../utilities/AnimationUtilities";
import { placePanelInFront, setPanelFollowing, getFrameComponent, COLOR_ERROR, COLOR_WARN, statusToneColor } from "./UIKit";
import { SetupWizardStep, SetupWizardView } from "./SetupWizardView";

const WIZARD_STEP_TITLES = {
  [SetupWizardStep.Connect]: "Connect",
  [SetupWizardStep.Localization]: "Localization",
} as const;

const WIZARD_STEP_DESCRIPTIONS = {
  [SetupWizardStep.Connect]: "Start the launcher on your Mac.",
  [SetupWizardStep.Localization]: "Look at the robot while the headset captures views for localization.",
} as const;

function localizationStepDescription(displayName: string): string {
  return `Look at ${displayName}'s marker or mapped surroundings.\nHold steady. Setup finishes automatically when localized.`;
}

function connectionModeLabel(method: ConnectionMethod): string {
  return method === "pin" ? "Mode: PIN" : "Mode: IP";
}

function connectStepStatus(input: {
  view: ARModuleSessionState;
  linkPhase: SessionLinkPhase;
  isConnecting: boolean;
  socketOpen: boolean;
  displayName?: string;
}): StatusText {
  if (input.isConnecting && !input.socketOpen) {
    return { text: "Waiting for the launcher…", color: "warn" };
  }
  if (input.isConnecting && input.socketOpen && input.view.connection === "awaiting_hello") {
    return { text: "Waiting for handshake…", color: "warn" };
  }
  if (input.isConnecting && input.linkPhase === "disconnected") {
    return { text: "Waiting for the launcher…", color: "warn" };
  }
  if (input.view.connection === "ready") return { text: "Connected to dimOS ARModule", color: "success" };
  return sessionLinkStatus(input.view, input.displayName ?? input.view.hello?.robot.display_name ?? NO_ROBOT_CONNECTED_LABEL);
}

const NAV_DEBOUNCE_S = 0.35;
const CONNECT_RETRY_S = 2.0;
const CONNECT_RETRY_LOG_INTERVAL_S = 10.0;
const CONNECT_POLL_INTERVAL_S = 0.1;
const MODULE_PIN_STORAGE_KEY = "dimos_ar_module_pin";

export interface SetupWizardControllerDeps {
  panel: SceneObject;
  cameraObject?: SceneObject;
  script: ScriptComponent;
  session: ARModuleSession;
  episode: LocalizationCaptureEpisode;
  transport: SpecsWebSocketTransport;
  clientTrackingOriginStore: ClientTrackingOriginStore;
  defaultWebsocketIp: string;
  hostStore: ModuleHostStore;
  ipRelayClient: IpRelayClient;
  flow?: SetupFlow;
  previewTexture?: () => Texture | null;
  onFinished: () => void;
  onDismissToRuntime: () => void;
}

export class SetupWizardController {
  private readonly deps: SetupWizardControllerDeps;
  readonly flow: SetupFlow;
  private readonly view: SetupWizardView;
  private readonly retryEvent: DelayedCallbackEvent;
  private readonly pollEvent: DelayedCallbackEvent;
  private get _currentStep(): SetupWizardStep { return this.flow.step === "localization" ? SetupWizardStep.Localization : SetupWizardStep.Connect; }
  private _connectStepCompleted = false;
  private _isConnecting = false;
  private resolvingPin = false;
  private _lastNavigationTime = -1;
  private _autoconnectOpId = 0;
  private _retryOpId = 0;
  private _pollOpId = 0;
  private _lastConnectRetryLogTime = -1;
  private _calibratedScale = new vec3(1, 1, 1);
  private _hostValidationError: string | null = null;
  private _connectionMethod: ConnectionMethod = "pin";
  private _sessionStarted = false;
  private _visible = false;
  private successAt: number | null = null;
  private baseline: { origin: ClientTrackingOrigin; hello: ARModuleSessionState["hello"] } | null = null;

  public invalidateBaseline(): void { this.baseline = null; }

  private retainBaseline(): void {
    const origin = this.deps.clientTrackingOriginStore.T_odom_client;
    this.baseline = origin && !this.flow.alignmentReview?.pending
      ? { origin, hello: this.deps.session.view().hello } : null;
  }

  private restoreBaseline(): void {
    const baseline = this.baseline;
    this.baseline = null;
    if (!baseline) return;
    const view = this.deps.session.view();
    const oldRef = baseline.hello?.odom_reference_id, currentRef = view.hello?.odom_reference_id;
    if (view.connection === "ready" && (oldRef ? oldRef === currentRef : view.hello === baseline.hello)) {
      this.deps.clientTrackingOriginStore.restore(baseline.origin);
    }
  }

  constructor(deps: SetupWizardControllerDeps) {
    this.deps = deps;
    this.flow = deps.flow ?? new SetupFlow(deps.session, deps.episode);
    this.view = new SetupWizardView(deps.panel);
    this._calibratedScale = new vec3(SETUP_PANEL_SCALE, SETUP_PANEL_SCALE, SETUP_PANEL_SCALE);
    deps.panel.getTransform().setLocalScale(this._calibratedScale);
    if (deps.cameraObject) {
      getFrameComponent(deps.panel)?.onTranslationStart.add(() => setPanelFollowing(deps.panel, false, SETUP_PANEL_SCALE));
    }

    const retryEv = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    retryEv.bind(() => this.onRetryFired());
    this.retryEvent = retryEv;

    const pollEv = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    pollEv.bind(() => this.onPollFired());
    this.pollEvent = pollEv;

    this.view.bindHandlers(
      () => this.onNext(), () => this.onPrevious(), () => this.startAutoconnect(), () => this.onConnectionToggle(),
      () => { this.deps.episode.reset(); this.beginLocalizationCapture(); },
      () => {
        this.cancelAutoconnect("connection input edited", false);
        this._isConnecting = false;
        this._hostValidationError = null;
        if (this._connectionMethod === "pin") this.view.clearInput();
        this.showConnectStatus();
      },
    );
  }

  public start(fromRuntime: boolean): void {
    if (fromRuntime) this.retainBaseline(); else this.invalidateBaseline();
    this.successAt = null;
    this.flow.restart(fromRuntime);
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
    this.view.setVisible?.(false);
    this.setStep(SetupWizardStep.Connect);
    this.show();
  }

  public realign(): void {
    this.retainBaseline();
    this.deps.clientTrackingOriginStore.clear();
    this.successAt = null;
    this.flow.restart(true);
    this.invalidatePending();
    this.view.setVisible?.(false);
    this.setStep(SetupWizardStep.Localization);
    this.show();
  }

  public tick(deltaS = 0): void {
    this.view.tick?.(deltaS);
    if (!this._visible || this._currentStep !== SetupWizardStep.Localization) {
      return;
    }
    const view = this.deps.session.view();
    if (view.connection === "ready" && view.hasTrackingOrigin) {
      // Transition on UpdateEvent, outside WebSocket and button callbacks.
      if (this.successAt === null) this.successAt = getTime();
      const elapsed = getTime() - this.successAt;
      this.view.celebrate?.(Math.min(1, elapsed / 0.65), view.hello?.robot.display_name ?? "Robot");
      if (elapsed >= 1.5) this.finishWizard();
      return;
    }
    this.successAt = null;
    this.view.setCameraPreview?.(this.deps.previewTexture?.() ?? null);
    this.renderLocalizationStatus();
  }

  public onSessionViewChanged(): void {
    const hello = this.deps.session.view().hello;
    if (hello && this.baseline && hello !== this.baseline.hello &&
      (!this.baseline.hello?.odom_reference_id || hello.odom_reference_id !== this.baseline.hello.odom_reference_id)) this.invalidateBaseline();
    if (!this._visible) {
      return;
    }
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
    if (this.deps.cameraObject) placePanelInFront(this.deps.panel, this.deps.cameraObject, 5);
    this.view.placed?.();
    this.view.setVisible?.(true);
    getFrameComponent(this.deps.panel)?.showVisual();
    setPanelFollowing(this.deps.panel, true, SETUP_PANEL_SCALE);
    const panel = this.deps.panel;
    panel.enabled = false;
    scaleIn(panel, 0.5, this._calibratedScale);
  }

  private hide(): void {
    this._visible = false;
    this.view.setVisible?.(false);
    nextAnimationVersion(this.deps.panel, DEFAULT_SCALE_ANIMATION_VERSION_KEY);
    setPanelFollowing(this.deps.panel, false, SETUP_PANEL_SCALE);
    this.deps.panel.enabled = false;
  }

  private setStep(step: SetupWizardStep): void {
    if (this._currentStep === SetupWizardStep.Localization && step !== this._currentStep) {
      this.flow.previous();
    }
    this.invalidatePending();
    this.flow.step = step === SetupWizardStep.Localization ? "localization" : "connect";
    this.view.setStepContent(WIZARD_STEP_TITLES[step], this.stepDescription(step));
    this.view.applyStepLayout(step);

    switch (step) {
      case SetupWizardStep.Connect:
        this.view.setInputEnabled(true);
        this.view.setConnectionToggleVisible(true);
        this.prepareConnectStep();
        this.refreshFooterButtons();
        break;
      case SetupWizardStep.Localization:
        this.view.setInputEnabled(false);
        this.view.setConnectionToggleVisible(false);
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

  private prepareConnectStep(): void {
    this._connectionMethod = "pin";
    this._hostValidationError = null;
    this.view.setConnectionToggleLabel(connectionModeLabel(this._connectionMethod));
    const savedPin = this.loadStoredPin();
    this.fillConnectField(savedPin);
    if (this.isConnected()) {
      this._connectStepCompleted = true;
      this.showConnectStatus();
      return;
    }
    if (savedPin) this.startAutoconnect();
    else this.showConnectStatus();
  }

  private fillConnectField(text: string): void {
    const placeholder = this._connectionMethod === "pin" ? "6 Digit PIN code" : "IP Address";
    this.view.initializeInput(text, placeholder);
  }

  private loadStoredPin(): string {
    const store = this.deps.hostStore;
    if (!store.has(MODULE_PIN_STORAGE_KEY)) return "";
    const routed = routeConnectionField("pin", store.getString(MODULE_PIN_STORAGE_KEY));
    return routed?.kind === "pin" ? routed.pin : "";
  }

  private onConnectionToggle(): void {
    if (this._currentStep !== SetupWizardStep.Connect) {
      return;
    }
    this.cancelAutoconnect("connection method changed", true);
    this._isConnecting = false;
    this._hostValidationError = null;
    this._connectionMethod = toggleConnectionMethod(this._connectionMethod);
    this.view.setConnectionToggleLabel(connectionModeLabel(this._connectionMethod));
    if (this._connectionMethod === "pin") {
      const savedPin = this.loadStoredPin();
      this.fillConnectField(savedPin);
      if (savedPin) this.startAutoconnect();
      else this.showConnectStatus();
      return;
    }
    const stored = loadStoredModuleHost(this.deps.hostStore);
    const initial = stored !== null && isValidHost(stored) ? stored : this.deps.defaultWebsocketIp.trim();
    this.fillConnectField(initial);
    this.startAutoconnect();
  }

  private onNext(): void {
    if (!this._visible || !this.canNavigate()) {
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
        print("SetupWizardController: finish localization=skipped");
      }
      this.finishWizard();
    }
  }

  private onPrevious(): void {
    if (!this._visible || (!this.flow.openedFromRuntime && !this._connectStepCompleted && !this.isConnected()) || !this.canNavigate()) {
      return;
    }
    if (this._currentStep === SetupWizardStep.Connect) {
      if (this.flow.openedFromRuntime) {
        this.invalidatePending(); this.deps.episode.pause(); this.restoreBaseline();
        this.flow.finish(); this.dismissToRuntime();
      }
      return;
    }
    this.setStep(SetupWizardStep.Connect);
  }

  private finishWizard(): void {
    if (!this._visible) {
      return;
    }
    this.invalidatePending();
    this.invalidateBaseline();
    // Success stops the camera but keeps future gated capture requests enabled.
    this.flow.finish();
    this.hide();
    this.deps.onFinished();
  }

  private beginLocalizationCapture(): void {
    if (!this.isConnected() || this.deps.session.view().hasTrackingOrigin) {
      return;
    }
    try {
      this.flow.startLocalization();
    } catch (error) {
      print(`SetupWizardController: requestStart failed — ${error}`);
    }
  }

  private dismissToRuntime(): void {
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

    const routed = routeConnectionField(this._connectionMethod, this.view.getInputText());
    if (routed === null) {
      this._hostValidationError = this._connectionMethod === "pin"
        ? "Enter a 6-digit PIN"
        : "Enter a valid IP address";
      this.showConnectStatus();
      this._isConnecting = false;
      this.refreshFooterButtons();
      return;
    }
    if (routed.kind === "pin") {
      this.deps.hostStore.putString(MODULE_PIN_STORAGE_KEY, routed.pin);
      this._hostValidationError = null;
      this._isConnecting = true;
      this.resolvingPin = true;
      this.showConnectStatus();
      void this.resolvePin(routed.pin, opId);
      return;
    }
    if (!isValidHost(routed.host)) {
      this._hostValidationError = "Enter a valid IP address";
      this.showConnectStatus();
      this._isConnecting = false;
      this.refreshFooterButtons();
      return;
    }
    this._hostValidationError = null;
    saveModuleHost(this.deps.hostStore, routed.host);
    this._isConnecting = true;
    this.showConnectStatus();
    this.logConnectAttempt(routed.host);
    void this.tryConnect(routed.host, opId);
  }

  private async resolvePin(pin: string, opId: number): Promise<void> {
    const found = await this.deps.ipRelayClient.resolve(pin);
    if (opId !== this._autoconnectOpId) {
      return;
    }
    this.resolvingPin = false;
    if (found === null) {
      this._isConnecting = false;
      this._hostValidationError = "PIN did not resolve";
      this.showConnectStatus();
      this.scheduleAutoconnectRetry(opId);
      return;
    }
    this._hostValidationError = null;
    saveModuleHost(this.deps.hostStore, found.ip);
    this.logConnectAttempt(found.ip);
    void this.tryConnect(found.ip, opId, found.port);
  }

  private async tryConnect(
    ip: string,
    opId: number,
    port: number = AR_MODULE_CLIENT_CONFIG.port,
  ): Promise<void> {
    const url = buildModuleWebSocketUrl(ip, port);
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
      // ARModuleSession reconnects from tick(). stop()+start() here stacks another
      // socket and drops the handshake already in progress.
      this.showConnectStatus();
      this.pollEvent.reset(CONNECT_POLL_INTERVAL_S);
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
    this.resolvingPin = false;
    this._autoconnectOpId += 1;
    this._pollOpId = -1;
    this._retryOpId = -1;
    this.retryEvent.cancel();
    this.pollEvent.cancel();
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
    if (this._currentStep !== SetupWizardStep.Connect) return;
    this.refreshRobotBadge();
    const view = this.deps.session.view();
    const status = connectStepStatus({
      view,
      linkPhase: deriveSessionLinkPhase(view),
      isConnecting: this._isConnecting,
      socketOpen: view.connection === "awaiting_hello" || view.connection === "ready",
      displayName: view.hello?.robot.display_name,
    });
    const error = this._hostValidationError ?? (view.connection === "failed" ? status.text : null);
    const connected = view.connection === "ready";
    this.view.setConnectionState?.({
      text: error ?? (connected ? status.text : this.resolvingPin ? "Resolving PIN…" : this._isConnecting ? status.text : this._connectionMethod === "pin" ? "Enter a 6-digit PIN" : "Enter an IP address"),
      color: error ? COLOR_ERROR : connected ? statusToneColor("success") : COLOR_WARN,
      phase: error ? "error" : connected ? "connected" : "entry",
      details: connected ? `Robot: ${view.hello?.robot.display_name ?? "Unavailable"}\n${availableFeatures(view.capabilities)}` : undefined,
    });
  }

  private refreshRobotBadge(): void {
    const view = this.deps.session.view();
    const phase = deriveSessionLinkPhase(view);
    this.view.setRobotBadge?.(view.hello?.robot.display_name ?? "Robot",
      { disconnected: "Disconnected", connecting: "Connecting…", robotOffline: "Robot offline", connected: "Connected" }[phase],
      view.nav?.state === "following_path" ? "Following Path" : view.state?.agent.idle === false ? "Thinking" : "Idle");
  }

  private renderLocalizationStatus(): void {
    // Session packets must not repack the capture page during its success animation.
    if (this.successAt !== null) return;
    this.refreshRobotBadge();
    const sessionView = this.deps.session.view();
    const episodeView = this.deps.episode.view();
    const policy = episodeView.capturePolicy;
    const kind = sessionView.capabilities?.localization.available !== true ? "unavailable" :
      policy === "any_angle" ? "vps" : policy === "robot_los_required" ? "marker" : policy === "robot_los_preferred" ? "mixed" : "unknown";
    this.view.setCaptureLayout?.(kind !== "unavailable" && !episodeView.lastError);
    this.view.setLocalizationProvider?.(localizationProviderLabel(kind));
    this.view.setMarkerGuide?.(kind === "marker" || kind === "mixed");
    this.view.setLocalizationGuidance?.(localizationGuidance(kind));
    this.view.setRetryVisible?.(episodeView.lastError !== null);
    const capture = localizationCaptureStatus(sessionView, episodeView, getTime());
    this.view.setStatus(capture.text, statusToneColor(capture.color));
  }

  private refreshFooterButtons(): void {
    const connected = this.isConnected();
    const connectionCompleted = this._connectStepCompleted || connected;
    let footerNextLabel = "Skip";
    const footerShowPrev = this.flow.openedFromRuntime || connectionCompleted && this._currentStep === SetupWizardStep.Localization;

    if (this._currentStep === SetupWizardStep.Connect && connected) {
      footerNextLabel = "Continue";
    }

    this.view.applyFooterState(this._currentStep, {
      footerNextLabel,
      footerNextEnabled: true,
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
