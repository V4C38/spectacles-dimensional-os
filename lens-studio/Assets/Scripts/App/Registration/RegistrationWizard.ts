require("LensStudio:TextInputModule");

import { ARBridgeCoordinator } from "../ARBridgeCoordinator";
import { BridgeLinkState, bridgeLinkPresentation, isRuntimePhase, NO_ROBOT_CONNECTED_LABEL } from "../AppState";

import {
  buildRegistrationDisplay,
  buildRegistrationDescriptionAuto,
  buildRegistrationStepTitle,
  RegistrationFlow,
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
} from "./RegistrationFlow";
import { scaleIn } from "../Utilities/AnimationUtilities";
import { COLOR_ERROR, COLOR_WARN, COLOR_WHITE } from "../UI/kit/UIKit";
import {
  BRIDGE_RETRY_BACKOFF_FACTOR,
  BRIDGE_RETRY_BASE_S,
  BRIDGE_RETRY_MAX_S,
} from "../../ARBridge/Network/WebSocketTransport";
import { RegistrationWizardView } from "./RegistrationWizardView";

const NAV_DEBOUNCE_S = 0.35;
const CONNECT_FAIL_STREAK_BEFORE_FALLBACK = 2;
const CONNECT_RETRY_LOG_INTERVAL_S = 10.0;

/** Three-step registration component (start → connect → register) that gates entry into runtime. */
@component
export class RegistrationWizard extends BaseScriptComponent {
  @input
  arBridgeCoordinator: ARBridgeCoordinator;

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
  private _view: RegistrationWizardView | null = null;
  private _registrationFlow: RegistrationFlow | null = null;
  private _lastConnectRetryLogTime = -1;
  private _connectRetryBackoffS = BRIDGE_RETRY_BASE_S;
  private _connectFailStreak = 0;
  private _connectCandidateIndex = 0;
  private _connectCandidates: string[] = [];
  private _authoredLocalScale: vec3 = new vec3(1, 1, 1);

  onAwake() {
    const panel = this.getSceneObject();
    if (panel) {
      this._authoredLocalScale = panel.getTransform().getLocalScale();
    }
    this._view = new RegistrationWizardView(this.getSceneObject());
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
        this._finishRegistration();
      });
      this._finishEvent = finishEv;

      this._registrationFlow = new RegistrationFlow(this.arBridgeCoordinator, {
        beginManualRegistrationPlacementFromWizard: () =>
          this._beginManualRegistrationPlacementFromWizard(),
        render: () => this._renderRegistrationState(),
        refreshFooter: () => this._refreshFooterButtons(),
        refreshDescription: () => this._refreshRegistrationDescription(),
        log: (message) => this._log(message),
        finishRegistration: () => this._finishRegistration(),
        scheduleFinishRegistration: (delaySecs) => this._scheduleFinishRegistration(delaySecs),
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
      this.startRegistrationWizard();
    });
  }

  public startRegistrationWizard(): void {
    this._log("start");
    this._finishPending = false;
    this._connectCompleted = false;
    this._isConnecting = false;
    this._lastNavigationTime = -1;
    this._registrationFlow?.leave();
    this._registrationFlow?.setState(createRegistrationViewState());
    this._invalidatePending();
    const inRuntime =
      this.arBridgeCoordinator !== null &&
      isRuntimePhase(this.arBridgeCoordinator.appState);
    if (!inRuntime) {
      this.arBridgeCoordinator?.enterRegistration();
    }
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = false;
      scaleIn(panel, 0.5, this._authoredLocalScale);
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
      this.arBridgeCoordinator?.registrationClient.stop({ notifyBridge: true });
      this._registrationFlow?.leave();
      this.arBridgeCoordinator?.registrationPreview.end();
    }

    switch (clamped) {
      case WizardStep.Start:
        this._view?.setInputEnabled(false);
        this._view?.setStatus("", COLOR_WHITE);
        this._refreshFooterButtons();
        break;

      case WizardStep.Connect: {
        this._view?.setInputEnabled(true);
        this._resetConnectCandidates();

        const ip = this._currentConnectIp();

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
      if (
        this.arBridgeCoordinator &&
        isRuntimePhase(this.arBridgeCoordinator.appState)
      ) {
        this.arBridgeCoordinator.enterRegistration({ preserveBridge: true });
      }
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
    if (regState.phase === "failed") {
      this._registrationFlow?.redo();
      return;
    }
    if (regState.phase === "succeeded") {
      this._finishRegistration();
      return;
    }
    if (this._registrationFlow?.completeStep()) {
      this._finishRegistration();
    }
  }

  private _onPrevious(): void {
    if (!this._canNavigate()) {
      return;
    }
    if (this._currentStep === WizardStep.Start) {
      if (
        this.arBridgeCoordinator &&
        isRuntimePhase(this.arBridgeCoordinator.appState)
      ) {
        this._dismissWizardToRuntime();
      }
      return;
    }
    if (this._currentStep === WizardStep.Register) {
      this.arBridgeCoordinator?.registrationClient.stop({ notifyBridge: true });
      this.arBridgeCoordinator?.registrationPreview.end();
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
    if (this._isConnecting) {
      return;
    }
    const raw = this._view.inputField.text.trim();
    const ip = raw
      ? (this.arBridgeCoordinator?.normalizeBridgeIp(raw) ?? "")
      : this._currentConnectIp();
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
    this._logConnectAttempt(ip);
    this.arBridgeCoordinator?.tryConnectBridge(ip).then((ok) => {
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
    this._isConnecting = true;
    this._showBridgeConnectionStatus();
    this.arBridgeCoordinator?.tryConnectBridge(this._retryIp).then((ok) => {
      this._handleConnectionResult(this._retryOpId, this._retryIp, ok);
    });
  }

  private _handleConnectionResult(opId: number, ip: string, ok: boolean): void {
    if (opId !== this._autoconnectOpId || this._currentStep !== WizardStep.Connect) {
      return;
    }
    if (ok) {
      this.arBridgeCoordinator?.saveIp(ip);
      this._connectCompleted = true;
      this._isConnecting = false;
      this._connectFailStreak = 0;
      this._connectRetryBackoffS = BRIDGE_RETRY_BASE_S;
      this._autoconnectOpId += 1;
      this._showBridgeConnectionStatus();
      this._refreshFooterButtons();
      this._log("connect succeeded");
      return;
    }
    this._isConnecting = false;
    this._showBridgeConnectionStatus();
    this._logConnectRetry();
    this._connectFailStreak += 1;
    if (this._connectFailStreak >= CONNECT_FAIL_STREAK_BEFORE_FALLBACK) {
      this._advanceConnectCandidate();
    }
    this._retryOpId = opId;
    this._retryIp = this._currentConnectIp() || ip;
    this._retryEvent?.reset(this._connectRetryBackoffS);
    this._connectRetryBackoffS = Math.min(
      this._connectRetryBackoffS * BRIDGE_RETRY_BACKOFF_FACTOR,
      BRIDGE_RETRY_MAX_S,
    );
  }

  private _invalidatePending(): void {
    this._autoconnectOpId += 1;
  }

  private _cancelAutoconnect(reason: string, disconnect: boolean = false): void {
    this._invalidatePending();
    if (disconnect) {
      this.arBridgeCoordinator?.disconnect();
    }
    this._log(reason);
  }

  private _isConnected(): boolean {
    return this.arBridgeCoordinator?.hasBridgeConnection() ?? false;
  }

  private _bindRegistrationHandlers(): void {
    if (this._registrationHandlersBound || !this.arBridgeCoordinator) {
      return;
    }
    this._registrationHandlersBound = true;
    this.arBridgeCoordinator.registrationClient.onRegistrationStatus.add((msg) =>
      this._onRegistrationStatus(msg),
    );
  }

  private _bindBridgeHandlers(): void {
    if (this._bridgeHandlersBound || !this.arBridgeCoordinator) {
      return;
    }
    this._bridgeHandlersBound = true;
    this.arBridgeCoordinator.onBridgeReady.add(() => {
      if (this._currentStep === WizardStep.Connect) {
        this._connectCompleted = true;
        this._isConnecting = false;
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
      if (this._currentStep === WizardStep.Register) {
        this._refreshRegistrationDescription();
        if (this.arBridgeCoordinator!.registrationClient.ensureSession()) {
          this._renderRegistrationState();
        }
      }
    });
    this.arBridgeCoordinator.onBridgeConnectionChanged.add((connected) => {
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
    this.arBridgeCoordinator.onBridgeStatusChanged.add((msg) => {
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
    if (this._clockSyncHandlerBound || !this.arBridgeCoordinator?.onBridgeClockSyncStateChanged) {
      return;
    }
    this._clockSyncHandlerBound = true;
    this.arBridgeCoordinator.onBridgeClockSyncStateChanged.add(() => {
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
      }
    });
  }

  private _bridgeStatusForConnect(
    linkState: BridgeLinkState,
    isConnecting: boolean,
  ): { text: string; color: vec4 } {
    if (isConnecting && !this.arBridgeCoordinator?.isBridgeSocketOpen()) {
      return { text: "Connecting to bridge…", color: COLOR_ERROR };
    }
    if (
      isConnecting &&
      (this.arBridgeCoordinator?.isBridgeSocketOpen() ?? false) &&
      !this._isConnected()
    ) {
      return { text: "Waiting for handshake…", color: COLOR_ERROR };
    }
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
    const linkState = this.arBridgeCoordinator?.bridgeLinkState ?? "disconnected";
    const presentation = this._bridgeStatusForConnect(linkState, this._isConnecting);
    const detail = this._bridgeConnectDetailStatus(
      linkState,
      this.arBridgeCoordinator?.bridgeClockSyncState ?? "idle",
    );
    const statusText = detail
      ? `${presentation.text}\n${detail}`.trim()
      : presentation.text;
    this._view?.setStatus(statusText, presentation.color);
    if (this.arBridgeCoordinator?.hasBridgeConnection()) {
      this.arBridgeCoordinator.requestBridgeStatus();
    }
  }

  private _renderRegistrationState(): void {
    if (this._currentStep !== WizardStep.Register) {
      return;
    }
    const display = buildRegistrationDisplay(
      this._registrationFlow?.state ?? createRegistrationViewState(),
      this.arBridgeCoordinator?.hasBridgeConnection() ?? false,
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
      this.arBridgeCoordinator
        ? isRuntimePhase(this.arBridgeCoordinator.appState)
        : false,
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
    if (!this.arBridgeCoordinator?.hasBridgeConnection()) {
      this._view?.setStepContent(title, NO_ROBOT_CONNECTED_LABEL, COLOR_WARN);
      return;
    }
    const displayName =
      this.arBridgeCoordinator.appState.robotRuntime.displayName ?? NO_ROBOT_CONNECTED_LABEL;
    this._view?.setStepContent(title, buildRegistrationDescriptionAuto(displayName));
  }

  private _toggleManualRegistration(): void {
    if (this._currentStep !== WizardStep.Register) {
      return;
    }
    this.arBridgeCoordinator?.registrationPreview.end();
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
    this.arBridgeCoordinator?.beginManualRegistrationPlacementAt(
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

  private _scheduleFinishRegistration(delaySecs: number): void {
    this._finishPending = true;
    this._finishEvent?.reset(delaySecs);
  }

  private _finishRegistration(): void {
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
    this.arBridgeCoordinator?.registrationPreview.end();
    this.arBridgeCoordinator?.registrationClient.stop();
    this.arBridgeCoordinator?.enterRuntime();
  }

  private _dismissWizardToRuntime(): void {
    this._finishPending = false;
    this._log("dismiss to runtime");
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = false;
    }
    this.arBridgeCoordinator?.registrationPreview.end();
    this.arBridgeCoordinator?.registrationClient.stop();
    this.arBridgeCoordinator?.enterRuntime();
  }

  private _logConnectAttempt(ip: string): void {
    const now = getTime();
    if (this._lastConnectRetryLogTime < 0 || now - this._lastConnectRetryLogTime >= CONNECT_RETRY_LOG_INTERVAL_S) {
      this._lastConnectRetryLogTime = now;
      this._log(`connect attempt ${ip}`);
    }
  }

  private _logConnectRetry(): void {
    const now = getTime();
    if (this._lastConnectRetryLogTime < 0 || now - this._lastConnectRetryLogTime >= CONNECT_RETRY_LOG_INTERVAL_S) {
      this._lastConnectRetryLogTime = now;
      this._log("connect failed, retrying");
    }
  }

  private _log(message: string): void {
    print(`RegistrationWizard: ${message}`);
  }

  private _buildConnectCandidates(): string[] {
    const saved = this.arBridgeCoordinator?.loadIp() ?? null;
    const rawFallback =
      this.arBridgeCoordinator?.getDefaultBridgeIp() || this.arBridgeCoordinator?.getBaseUrl() || "";
    const fallback = this.arBridgeCoordinator?.normalizeBridgeIp(rawFallback) ?? "";
    const base = this.arBridgeCoordinator?.normalizeBridgeIp(this.arBridgeCoordinator?.getBaseUrl() ?? "") ?? "";
    const candidates: string[] = [];
    for (const raw of [saved, fallback, base]) {
      const ip = raw ? (this.arBridgeCoordinator?.normalizeBridgeIp(raw) ?? "") : "";
      if (ip && candidates.indexOf(ip) < 0) {
        candidates.push(ip);
      }
    }
    return candidates;
  }

  private _resetConnectCandidates(): void {
    this._connectCandidates = this._buildConnectCandidates();
    this._connectCandidateIndex = 0;
    this._connectFailStreak = 0;
    this._connectRetryBackoffS = BRIDGE_RETRY_BASE_S;
  }

  private _currentConnectIp(): string {
    if (this._connectCandidates.length === 0) {
      this._connectCandidates = this._buildConnectCandidates();
    }
    return this._connectCandidates[this._connectCandidateIndex] ?? "";
  }

  private _advanceConnectCandidate(): void {
    if (this._connectCandidateIndex >= this._connectCandidates.length - 1) {
      return;
    }
    const abandoned = this._connectCandidates[this._connectCandidateIndex];
    const defaultIp =
      this.arBridgeCoordinator?.normalizeBridgeIp(this.arBridgeCoordinator?.getDefaultBridgeIp() ?? "") ?? "";
    if (abandoned && defaultIp && abandoned !== defaultIp) {
      this.arBridgeCoordinator?.clearBridgeIp();
    }
    this._connectCandidateIndex += 1;
    this._connectFailStreak = 0;
    const next = this._currentConnectIp();
    if (next && this._view?.inputField) {
      this._view.inputField.text = next;
      this._view.setInputText(next);
    }
    this._log(`trying fallback IP ${next}`);
  }
}
