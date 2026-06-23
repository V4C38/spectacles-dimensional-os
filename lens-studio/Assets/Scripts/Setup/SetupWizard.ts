require("LensStudio:TextInputModule");

import { DimosManager } from "../Core/DimosManager";
import { BridgeLinkState, bridgeLinkPresentation, NO_ROBOT_CONNECTED_LABEL } from "../Core/AppState";

import {
  buildRegistrationDisplay,
  buildRegistrationDescriptionAuto,
  buildRegistrationStepTitle,
  SetupRegistrationFlow,
  REGISTRATION_DESCRIPTION_MANUAL,
  createRegistrationViewState,
  getWizardFooterState,
  isRegistrationFailed,
  LAST_WIZARD_STEP,
  WIZARD_STEP_DESCRIPTIONS,
  WIZARD_STEP_TITLES,
  WizardStep,
  wizardStepName,
  RegistrationStatusMessage,
} from "./SetupRegistrationFlow";
import { scaleIn } from "../UI/kit/UIAnimations";
import { COLOR_ERROR, COLOR_WARN, COLOR_WHITE } from "../UI/kit/UIKit";
import { SetupWizardView } from "./SetupWizardView";

const NAV_DEBOUNCE_S = 0.35;
const AUTOCONNECT_RETRY_S = 2.0;

/** Three-step setup component (start → connect → register) that gates entry into runtime. */
@component
export class SetupWizard extends BaseScriptComponent {
  @input
  dimosManager: DimosManager;

  private _currentStep = WizardStep.Start;
  private _connectCompleted = false;
  private _isConnecting = false;
  private _registrationHandlersBound = false;
  private _bridgeHandlersBound = false;
  private _clockSyncHandlerBound = false;
  private _lastNavigationTime = -1;
  private _autoconnectOpId = 0;
  private _retryEvent: DelayedCallbackEvent | null = null;
  private _retryOpId = 0;
  private _retryIp = "";
  private _finishEvent: DelayedCallbackEvent | null = null;
  private _finishPending = false;
  private _view: SetupWizardView | null = null;
  private _registrationFlow: SetupRegistrationFlow | null = null;

  onAwake() {
    this._view = new SetupWizardView(this.getSceneObject());
    this.createEvent("OnStartEvent").bind(() => {
      const retryEv = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      retryEv.bind(() => this._onRetryFired());
      this._retryEvent = retryEv;

      const finishEv = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      finishEv.bind(() => {
        if (!this._finishPending) {
          return;
        }
        this._finishPending = false;
        this._finishSetup();
      });
      this._finishEvent = finishEv;

      this._registrationFlow = new SetupRegistrationFlow(this.dimosManager, {
        beginManualRegistrationPlacementFromWizard: () =>
          this._beginManualRegistrationPlacementFromWizard(),
        render: () => this._renderRegistrationState(),
        refreshFooter: () => this._refreshFooterButtons(),
        refreshDescription: () => this._refreshRegistrationDescription(),
        log: (message) => this._log(message),
        finishSetup: () => this._finishSetup(),
        scheduleFinishSetup: (delaySecs) => this._scheduleFinishSetup(delaySecs),
      });

      this._view?.bindHandlers(
        () => this._onNext(),
        () => this._onPrevious(),
        () => this._toggleManualRegistration(),
        () => this._startAutoconnect(),
      );

      this.createEvent("UpdateEvent").bind(() => this._registrationFlow?.tick());
      this._bindRegistrationHandlers();
      this._bindBridgeHandlers();
      this.startSetupWizard();
    });
  }

  public startSetupWizard(): void {
    this._log("start");
    this._finishPending = false;
    this._connectCompleted = false;
    this._isConnecting = false;
    this._lastNavigationTime = -1;
    this._registrationFlow?.leave();
    this._registrationFlow?.setState(createRegistrationViewState());
    this._invalidatePending();
    this.dimosManager?.enterSetup();
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = true;
      scaleIn(panel, 0.5);
    }
    this._setStep(WizardStep.Start);
  }

  private _setStep(step: WizardStep): void {
    const previousStep = this._currentStep;
    const clamped = Math.max(WizardStep.Start, Math.min(step, LAST_WIZARD_STEP)) as WizardStep;
    this._invalidatePending();
    this._currentStep = clamped;

    if (previousStep !== clamped) {
      this._log(`step ${wizardStepName(previousStep)} -> ${wizardStepName(clamped)}`);
    }

    this._view?.setStepContent(WIZARD_STEP_TITLES[clamped], WIZARD_STEP_DESCRIPTIONS[clamped]);
    this._view?.applyStepLayout(clamped);

    if (clamped !== WizardStep.Register) {
      this.dimosManager?.registrationClient.stop({ notifyBridge: true });
      this._registrationFlow?.leave();
      this.dimosManager?.setupRegistrationPreview.end();
    }

    switch (clamped) {
      case WizardStep.Start:
        this._view?.setInputEnabled(false);
        this._view?.setStatus("", COLOR_WHITE);
        this._refreshFooterButtons();
        break;

      case WizardStep.Connect: {
        this._view?.setInputEnabled(true);

        const saved = this.dimosManager?.loadIp() ?? null;
        const rawFallback =
          this.dimosManager?.getDefaultBridgeIp() || this.dimosManager?.getBaseUrl() || "";
        const fallback = this.dimosManager?.normalizeBridgeIp(rawFallback) ?? "";
        const ip = saved || fallback;

        if (this._view) {
          this._view.initializeInput(ip);
        }

        this._refreshFooterButtons();
        if (this._isConnected()) {
          this._showBridgeConnectionStatus();
        } else {
          this._view?.setStatus("Bridge disconnected", COLOR_ERROR);
          this._startAutoconnect();
        }
        break;
      }

      case WizardStep.Register:
        this._view?.setInputEnabled(false);
        this._registrationFlow?.enter();
        break;
    }
  }

  private _onNext(): void {
    if (!this._canNavigate()) {
      return;
    }

    if (this._currentStep === WizardStep.Start) {
      this._log("startup step completed");
      this._setStep(WizardStep.Connect);
      return;
    }

    if (this._currentStep === WizardStep.Connect) {
      if (!this._isConnected()) {
        this._cancelAutoconnect("connect step skipped", true);
      } else {
        this._log("connect step completed");
      }
      this._setStep(WizardStep.Register);
      return;
    }

    if (this._currentStep !== WizardStep.Register) {
      return;
    }

    const regState = this._registrationFlow?.state ?? createRegistrationViewState();
    if (regState.phase === "awaiting_motion") {
      if (this.dimosManager?.registrationClient.requestMotionAuthorization()) {
        this._refreshFooterButtons();
        this._renderRegistrationState();
      }
      return;
    }
    if (regState.phase === "failed") {
      this._registrationFlow?.redo();
      return;
    }
    if (regState.phase === "succeeded") {
      this._finishSetup();
      return;
    }
    if (this._registrationFlow?.completeStep()) {
      this._finishSetup();
    }
  }

  private _onPrevious(): void {
    if (!this._canNavigate()) {
      return;
    }
    if (this._currentStep <= WizardStep.Start) {
      return;
    }
    if (this._currentStep === WizardStep.Register) {
      this.dimosManager?.registrationClient.stop({ notifyBridge: true });
      this.dimosManager?.setupRegistrationPreview.end();
    }
    this._setStep((this._currentStep - 1) as WizardStep);
  }

  private _canNavigate(): boolean {
    const now = getTime();
    if (this._lastNavigationTime >= 0 && now - this._lastNavigationTime < NAV_DEBOUNCE_S) {
      return false;
    }
    this._lastNavigationTime = now;
    return true;
  }

  private _startAutoconnect(): void {
    if (this._currentStep !== WizardStep.Connect || !this._view?.inputField) {
      return;
    }
    const raw = this._view.inputField.text.trim();
    if (!raw) {
      return;
    }
    const ip = this.dimosManager?.normalizeBridgeIp(raw) ?? "";
    if (!ip) {
      return;
    }
    if (ip !== raw) {
      this._view.inputField.text = ip;
    }
    this._invalidatePending();
    const opId = this._autoconnectOpId;
    this._isConnecting = true;
    this._view?.setInputText(ip);
    this._showBridgeConnectionStatus();
    this._log(`connect attempt ${ip}`);
    this.dimosManager?.tryConnectBridge(ip).then((ok) => {
      this._handleConnectionResult(opId, ip, ok);
    });
  }

  private _onRetryFired(): void {
    if (
      this._retryOpId !== this._autoconnectOpId ||
      this._currentStep !== WizardStep.Connect
    ) {
      return;
    }
    this.dimosManager?.tryConnectBridge(this._retryIp).then((ok) => {
      this._handleConnectionResult(this._retryOpId, this._retryIp, ok);
    });
  }

  private _handleConnectionResult(opId: number, ip: string, ok: boolean): void {
    if (opId !== this._autoconnectOpId || this._currentStep !== WizardStep.Connect) {
      return;
    }
    if (ok) {
      this.dimosManager?.saveIp(ip);
      this._connectCompleted = true;
      this._isConnecting = false;
      this._showBridgeConnectionStatus();
      this._refreshFooterButtons();
      this._log("connect succeeded");
      return;
    }
    this._isConnecting = false;
    this._showBridgeConnectionStatus();
    this._log("connect failed, retrying");
    this._retryOpId = opId;
    this._retryIp = ip;
    this._retryEvent?.reset(AUTOCONNECT_RETRY_S);
  }

  private _invalidatePending(): void {
    this._autoconnectOpId += 1;
  }

  private _cancelAutoconnect(reason: string, disconnect: boolean = false): void {
    this._invalidatePending();
    if (disconnect) {
      this.dimosManager?.disconnect();
    }
    this._log(reason);
  }

  private _isConnected(): boolean {
    return this.dimosManager?.hasBridgeConnection() ?? false;
  }

  private _bindRegistrationHandlers(): void {
    if (this._registrationHandlersBound || !this.dimosManager) {
      return;
    }
    this._registrationHandlersBound = true;
    this.dimosManager.registrationClient.onRegistrationStatus.add((msg) =>
      this._onRegistrationStatus(msg),
    );
  }

  private _bindBridgeHandlers(): void {
    if (this._bridgeHandlersBound || !this.dimosManager) {
      return;
    }
    this._bridgeHandlersBound = true;
    this.dimosManager.onBridgeReady.add(() => {
      if (this._currentStep === WizardStep.Connect) {
        this._connectCompleted = true;
        this._isConnecting = false;
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
      if (this._currentStep === WizardStep.Register) {
        this._refreshRegistrationDescription();
        if (this.dimosManager!.registrationClient.ensureSession()) {
          this._renderRegistrationState();
        }
      }
    });
    this.dimosManager.onBridgeConnectionChanged.add((connected) => {
      if (!connected) {
        this._isConnecting = false;
      }
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
      if (this._currentStep === WizardStep.Register) {
        this._registrationFlow?.handleBridgeConnectionChanged(connected);
        this._refreshRegistrationDescription();
        this._renderRegistrationState();
      }
    });
    this.dimosManager.onBridgeStatusChanged.add((msg) => {
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
      }
      if (this._currentStep === WizardStep.Register) {
        this._registrationFlow?.handleBridgeStatus(msg);
      }
    });
    this._bindClockSyncHandler();
  }

  private _bindClockSyncHandler(): void {
    if (this._clockSyncHandlerBound || !this.dimosManager?.onBridgeClockSyncStateChanged) {
      return;
    }
    this._clockSyncHandlerBound = true;
    this.dimosManager.onBridgeClockSyncStateChanged.add(() => {
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
      }
    });
  }

  private _bridgeStatusForConnect(
    linkState: BridgeLinkState,
    isConnecting: boolean,
  ): { text: string; color: vec4 } {
    if (isConnecting && linkState === "disconnected") {
      return { text: "Connecting...", color: COLOR_ERROR };
    }
    return bridgeLinkPresentation(linkState);
  }

  private _bridgeConnectDetailStatus(
    linkState: BridgeLinkState,
    clockSyncState: "idle" | "pending" | "ready" | "failed",
  ): string | null {
    if (linkState === "disconnected" || linkState === "connectedNoRobot") {
      return null;
    }
    if (clockSyncState === "pending") {
      return "Syncing clock…";
    }
    if (clockSyncState === "failed") {
      return "Clock sync failed — reconnect or continue without registration frames";
    }
    return null;
  }

  private _showBridgeConnectionStatus(): void {
    const linkState = this.dimosManager?.bridgeLinkState ?? "disconnected";
    const presentation = this._bridgeStatusForConnect(linkState, this._isConnecting);
    this._view?.setStatus(presentation.text, presentation.color);
    this._bridgeConnectDetailStatus(
      linkState,
      this.dimosManager?.bridgeClockSyncState ?? "idle",
    );
    if (this.dimosManager?.hasBridgeConnection()) {
      this.dimosManager.requestBridgeStatus();
    }
  }

  private _renderRegistrationState(): void {
    if (this._currentStep !== WizardStep.Register) {
      return;
    }
    const display = buildRegistrationDisplay(
      this._registrationFlow?.state ?? createRegistrationViewState(),
      this.dimosManager?.hasBridgeConnection() ?? false,
      this._registrationFlow?.commitInFlight ?? false,
    );
    const detailText = display.detailText;
    if (display.statusText || detailText) {
      const statusText = detailText
        ? `${display.statusText}\n${detailText}`.trim()
        : display.statusText;
      this._view?.setStatus(statusText, display.statusColor);
    } else {
      this._view?.setStatus("", COLOR_WHITE);
    }
  }

  private _refreshFooterButtons(): void {
    const footerState = getWizardFooterState(
      this._currentStep,
      this._isConnected(),
      this._registrationFlow?.state ?? createRegistrationViewState(),
      this._registrationFlow?.commitInFlight ?? false,
      this.dimosManager?.registrationClient.motionAuthorizePending ?? false,
    );
    if (this._currentStep === WizardStep.Register && this._registrationFlow?.isManualOnly()) {
      footerState.showManual = false;
    }
    this._view?.applyFooterState(this._currentStep, footerState);
  }

  private _refreshRegistrationDescription(): void {
    const mode = this._registrationFlow?.state.mode ?? "auto";
    const title = buildRegistrationStepTitle(mode);
    if (mode === "manual") {
      this._view?.setStepContent(title, REGISTRATION_DESCRIPTION_MANUAL);
      return;
    }
    if (!this.dimosManager?.hasBridgeConnection()) {
      this._view?.setStepContent(title, NO_ROBOT_CONNECTED_LABEL, COLOR_WARN);
      return;
    }
    const displayName =
      this.dimosManager.appState.robotRuntime.displayName ?? NO_ROBOT_CONNECTED_LABEL;
    this._view?.setStepContent(title, buildRegistrationDescriptionAuto(displayName));
  }

  private _toggleManualRegistration(): void {
    if (this._currentStep !== WizardStep.Register) {
      return;
    }
    this.dimosManager?.setupRegistrationPreview.end();
    this._registrationFlow?.toggleMode();
  }

  private _beginManualRegistrationPlacementFromWizard(): boolean {
    const panel = this.getSceneObject();
    if (!panel) {
      return false;
    }
    const transform = panel.getTransform();
    const position = transform.getWorldPosition();
    const rotation = transform.getWorldRotation();
    this.dimosManager?.beginManualRegistrationPlacementAt(
      new vec3(position.x, position.y, position.z),
      rotation,
    );
    return true;
  }

  private _onRegistrationStatus(msg: RegistrationStatusMessage): void {
    if (this._currentStep !== WizardStep.Register) {
      return;
    }
    this._registrationFlow?.handleRegistrationStatus(msg);
    if (msg.phase === "succeeded") {
      this._log("registration succeeded");
    } else if (msg.phase === "failed") {
      this._log(`registration failed: ${msg.message || "unknown"}`);
    }
  }

  private _scheduleFinishSetup(delaySecs: number): void {
    this._finishPending = true;
    this._finishEvent?.reset(delaySecs);
  }

  private _finishSetup(): void {
    this._finishPending = false;
    this._log(
      `finish connect=${this._connectCompleted ? "done" : "skipped"} registration=${
        this._registrationFlow?.isComplete() ? "done" : "skipped"
      }`,
    );
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = false;
    }
    this.dimosManager?.setupRegistrationPreview.end();
    this.dimosManager?.registrationClient.stop();
    this.dimosManager?.enterRuntime();
  }

  private _log(message: string): void {
    print(`SetupWizard: ${message}`);
  }
}
