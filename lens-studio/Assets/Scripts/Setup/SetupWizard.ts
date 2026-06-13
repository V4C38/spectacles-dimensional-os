require("LensStudio:TextInputModule");

import { AlignmentSession } from "../Alignment/AlignmentSession";
import { DimosManager } from "../Core/DimosManager";
import { UIManager } from "../UI/UIManager";
import { AlignStatusMessage } from "../Bridge/Protocol";
import { scaleIn } from "../UI/kit/UIAnimations";
import { COLOR_ERROR, COLOR_WHITE, getFrameComponent } from "../UI/kit/UIKit";
import { WizardView } from "./WizardView";
import { getBridgeStatusPresentationForConnect } from "../UI/BridgeStatusPresentation";
import { BridgeClient } from "../Bridge/BridgeClient";
import {
  buildCalibrationDisplay,
  CalibrationFlow,
  CALIBRATE_DESCRIPTION_AUTO,
  CALIBRATE_DESCRIPTION_MANUAL,
  createCalibrationViewState,
  getWizardFooterState,
  LAST_WIZARD_STEP,
  WIZARD_STEP_DESCRIPTIONS,
  WIZARD_STEP_TITLES,
  WizardStep,
  wizardStepName,
} from "./CalibrationFlow";

const NAV_DEBOUNCE_S = 0.35;
const AUTOCONNECT_RETRY_S = 2.0;

/** Three-step setup component (start → connect → calibrate) that gates entry into runtime. */
@component
export class SetupWizard extends BaseScriptComponent {
  @input
  dimosManager: DimosManager;

  @input
  uiManager: UIManager;

  @input
  alignmentSession: AlignmentSession;

  @input
  assistClearanceDisc: SceneObject;

  @input
  camera: SceneObject;

  private _currentStep = WizardStep.Start;
  /** World position where the panel was last anchored (for re-snap threshold). */
  private _lastAnchorPos: vec3 | null = null;
  /** Whether the Frame follow was enabled before we disabled it for anchoring. */
  private _savedFollowing: boolean | null = null;
  private _connectCompleted = false;
  private _isConnecting = false;
  private _alignmentHandlersBound = false;
  private _bridgeHandlersBound = false;
  private _lastNavigationTime = -1;
  private _autoconnectOpId = 0;
  private _retryEvent: DelayedCallbackEvent | null = null;
  private _retryOpId = 0;
  private _retryIp = "";
  private _view: WizardView | null = null;
  private _calibrationFlow: CalibrationFlow | null = null;

  onAwake() {
    this._view = new WizardView(this.getSceneObject());
    this.createEvent("OnStartEvent").bind(() => {
      // Cache retry event (re-armed per retry; never recreated).
      const retryEv = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      retryEv.bind(() => this._onRetryFired());
      this._retryEvent = retryEv;

      this._calibrationFlow = new CalibrationFlow(
        this.dimosManager,
        this.alignmentSession,
        {
          beginManualAlignmentPlacementFromWizard: () =>
            this._beginManualAlignmentPlacementFromWizard(),
          render: () => this._renderCalibrationState(),
          refreshFooter: () => this._refreshFooterButtons(),
          refreshDescription: () => this._refreshCalibrationDescription(),
          log: (message) => this._log(message),
          finishSetup: () => this._finishSetup(),
        },
      );

      this._view?.bindHandlers(
        () => this._onNext(),
        () => this._onPrevious(),
        () => this._toggleManualAlignment(),
        () => this._startAutoconnect(),
      );

      this.createEvent("UpdateEvent").bind(() => this._calibrationFlow?.tick());
      this._bindAlignmentHandlers();
      this._bindBridgeHandlers();
      this.startSetupWizard();
    });
  }

  public startSetupWizard(): void {
    this._log("start");
    this._connectCompleted = false;
    this._isConnecting = false;
    this._lastNavigationTime = -1;
    this._calibrationFlow?.leave();
    this._calibrationFlow?.setState(createCalibrationViewState());
    this._invalidatePending();
    if (this.alignmentSession) {
      this.alignmentSession.stop();
    }
    this.dimosManager?.enterSetup();
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = true;
      scaleIn(panel, 0.5);
    }
    this._setStep(WizardStep.Start);
  }

  // ── Step machine (inlined from WizardStepController) ──────────

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

    if (clamped !== WizardStep.Calibrate) {
      this.alignmentSession?.stop();
      this._calibrationFlow?.leave();
      this._resetWizardAnchor();
    }

    switch (clamped) {
      case WizardStep.Start:
        this._view?.setInputEnabled(false);
        this._view?.setStatus("", COLOR_WHITE);
        this._view?.clearDetailStatus();
        this._refreshFooterButtons();
        break;

      case WizardStep.Connect: {
        this._view?.clearDetailStatus();
        this._view?.setInputEnabled(true);

        const saved = this.dimosManager?.loadIp() ?? null;
        const rawFallback =
          this.dimosManager?.getDefaultBridgeIp() || this.dimosManager?.getBaseUrl() || "";
        const fallback = BridgeClient.normalizeIp(rawFallback);
        const ip = saved || fallback;

        if (this._view) {
          this._view.initializeInput(ip);
        }
        if (!saved && this.dimosManager && ip) {
          this.dimosManager.setBaseUrl(ip);
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

      case WizardStep.Calibrate:
        this._view?.setInputEnabled(false);
        this._view?.clearDetailStatus();
        this._calibrationFlow?.enter();
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
      const raw = this._view?.getInputText() ?? "";
      if (!this._isConnected() && raw && this.dimosManager) {
        this.dimosManager.setBaseUrl(BridgeClient.normalizeIp(raw));
      }
      if (!this._isConnected()) {
        this._cancelAutoconnect("connect step skipped", true);
      } else {
        this._log("connect step completed");
      }
      this._setStep(WizardStep.Calibrate);
      return;
    }

    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }

    const calState = this._calibrationFlow?.state ?? createCalibrationViewState();
    if (calState.assistStage === "awaiting_confirm") {
      this.alignmentSession?.confirmAssist();
      return;
    }
    if (calState.phase === "complete") {
      this._finishSetup();
      return;
    }
    if (calState.phase === "pendingCommit") {
      return;
    }
    if (this._calibrationFlow?.completeStep()) {
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

  // ── Autoconnect (inlined from WizardConnectionController) ─────

  private _startAutoconnect(): void {
    if (this._currentStep !== WizardStep.Connect || !this._view?.inputField) {
      return;
    }
    const raw = this._view.inputField.text.trim();
    if (!raw) {
      return;
    }
    const ip = BridgeClient.normalizeIp(raw);
    if (ip !== raw) {
      this._view.inputField.text = ip;
    }
    this._invalidatePending();
    const opId = this._autoconnectOpId;
    this.dimosManager?.setBaseUrl(ip);
    this._isConnecting = true;
    this._view?.setInputText(ip);
    this._showBridgeConnectionStatus();
    this._log(`connect attempt ${ip}`);
    this.dimosManager?.checkConnection().then((ok) => {
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
    this.dimosManager?.setBaseUrl(this._retryIp);
    this.dimosManager?.checkConnection().then((ok) => {
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
    return (this.dimosManager?.bridgeLinkState ?? "disconnected") !== "disconnected";
  }

  // ── Bridge handlers ────────────────────────────────────────────

  private _bindAlignmentHandlers(): void {
    if (this._alignmentHandlersBound || !this.alignmentSession) {
      return;
    }
    this._alignmentHandlersBound = true;
    this.alignmentSession.onAlignStatus.add((msg) => this._onAlignStatus(msg));
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
      // B1 fix: unconditionally call ensureSession when on Calibrate step.
      if (this._currentStep === WizardStep.Calibrate && this.alignmentSession) {
        if (this.alignmentSession.ensureSession()) {
          this._renderCalibrationState();
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
      if (this._currentStep === WizardStep.Calibrate) {
        this._calibrationFlow?.handleBridgeConnectionChanged(connected);
      }
    });
    this.dimosManager.onBridgeStatusChanged.add((msg) => {
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
      }
      if (this._currentStep === WizardStep.Calibrate) {
        this._calibrationFlow?.handleBridgeStatus(msg);
      }
    });
  }

  // ── Rendering helpers ──────────────────────────────────────────

  private _showBridgeConnectionStatus(): void {
    const presentation = getBridgeStatusPresentationForConnect(
      this.dimosManager?.bridgeLinkState ?? "disconnected",
      this._isConnecting,
    );
    this._view?.setStatus(presentation.text, presentation.color);
    if (this.dimosManager?.hasBridgeConnection()) {
      this.dimosManager.requestBridgeStatus();
    }
  }

  private _renderCalibrationState(): void {
    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }
    const display = buildCalibrationDisplay(
      this._calibrationFlow?.state ?? createCalibrationViewState(),
      this.dimosManager?.hasBridgeConnection() ?? false,
    );
    if (display.statusText) {
      this._view?.setStatus(display.statusText, display.statusColor);
    } else {
      this._view?.setStatus("", COLOR_WHITE);
    }
    if (display.detailText) {
      this._view?.setDetailStatus(display.detailText, display.detailColor);
    } else {
      this._view?.clearDetailStatus();
    }
  }

  private _refreshFooterButtons(): void {
    const footerState = getWizardFooterState(
      this._currentStep,
      this._isConnected(),
      this._calibrationFlow?.state ?? createCalibrationViewState(),
    );
    if (this._currentStep === WizardStep.Calibrate && this._calibrationFlow?.isManualOnly()) {
      footerState.showManual = false;
    }
    this._view?.applyFooterState(this._currentStep, footerState);
  }

  private _refreshCalibrationDescription(): void {
    const description =
      this._calibrationFlow?.state.mode === "manual"
        ? CALIBRATE_DESCRIPTION_MANUAL
        : CALIBRATE_DESCRIPTION_AUTO;
    this._view?.setStepContent(WIZARD_STEP_TITLES[WizardStep.Calibrate], description);
  }

  private _toggleManualAlignment(): void {
    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }
    this._resetWizardAnchor();
    this._calibrationFlow?.toggleMode();
  }

  private _beginManualAlignmentPlacementFromWizard(): boolean {
    const panel = this.getSceneObject();
    if (!panel) {
      return false;
    }
    const transform = panel.getTransform();
    const position = transform.getWorldPosition();
    const rotation = transform.getWorldRotation();
    this.dimosManager?.beginManualAlignmentPlacementAt(
      new vec3(position.x, position.y, position.z),
      rotation,
    );
    return true;
  }

  private _onAlignStatus(msg: AlignStatusMessage): void {
    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }
    this._calibrationFlow?.handleAlignStatus(msg);
    // Detecting/ready updates arrive ~3-4/s; CalibrationFlow already logs those
    // (throttled + deduped). Only surface the terminal transitions here.
    if (msg.state === "aligned") {
      this._log(`alignment succeeded (progress=${msg.progress}%)`);
      this._resetWizardAnchor();
    } else if (msg.state === "failed") {
      this._log(`alignment failed: ${msg.message || "unknown"}`);
    }

    // Panel anchoring: snap to robot when assist_stage is active and robot pose is known.
    if (msg.assist_stage && msg.assist_stage !== "done" && msg.robot_world_pose) {
      const rp = msg.robot_world_pose;
      const robotPos = new vec3(rp.position[0], rp.position[1], rp.position[2]);
      const prev = this._lastAnchorPos;
      const RESNAP_THRESHOLD_CM = 8.0;
      const needsSnap =
        prev === null ||
        Math.sqrt(
          Math.pow(robotPos.x - prev.x, 2) +
          Math.pow(robotPos.y - prev.y, 2) +
          Math.pow(robotPos.z - prev.z, 2),
        ) > RESNAP_THRESHOLD_CM;
      if (needsSnap) {
        this._anchorWizardAtRobot(robotPos);
      }
    } else if (!msg.assist_stage || msg.assist_stage === "done") {
      if (this._lastAnchorPos !== null) {
        this._resetWizardAnchor();
      }
    }
  }

  /**
   * Relocate the wizard panel to hover above the robot world position.
   * Disables Frame follow so the panel stays fixed in world space.
   * Call only while on the Calibrate step with a valid robot pose.
   */
  private _anchorWizardAtRobot(robotWorldPos: vec3): void {
    const panel = this.getSceneObject();
    if (!panel) {
      return;
    }
    const frame = getFrameComponent(panel);
    if (frame && this._savedFollowing === null) {
      this._savedFollowing = frame.following;
      if (frame.following) {
        frame.setFollowing(false);
      }
    }
    // Position the panel ~35 cm above robot, ~25 cm toward the camera.
    const cam = this.camera ?? null;
    const PANEL_HEIGHT_ABOVE_CM = 35.0;
    const PANEL_TOWARD_CAM_CM = 25.0;
    let towardCam = new vec3(0, 0, -1);
    if (cam) {
      const camPos = cam.getTransform().getWorldPosition();
      const diff = new vec3(camPos.x - robotWorldPos.x, 0, camPos.z - robotWorldPos.z);
      const len = Math.sqrt(diff.x * diff.x + diff.z * diff.z);
      if (len > 0.01) {
        towardCam = new vec3(diff.x / len, 0, diff.z / len);
      }
    }
    const panelPos = new vec3(
      robotWorldPos.x + towardCam.x * PANEL_TOWARD_CAM_CM,
      robotWorldPos.y + PANEL_HEIGHT_ABOVE_CM,
      robotWorldPos.z + towardCam.z * PANEL_TOWARD_CAM_CM,
    );
    panel.getTransform().setWorldPosition(panelPos);
    this._lastAnchorPos = new vec3(robotWorldPos.x, robotWorldPos.y, robotWorldPos.z);

    if (this.assistClearanceDisc) {
      this.assistClearanceDisc.enabled = true;
      const discTransform = this.assistClearanceDisc.getTransform();
      discTransform.setWorldPosition(new vec3(robotWorldPos.x, robotWorldPos.y, robotWorldPos.z));
    }
  }

  /** Restore follow behaviour and hide the clearance disc. Idempotent. */
  private _resetWizardAnchor(): void {
    this._lastAnchorPos = null;
    if (this.assistClearanceDisc) {
      this.assistClearanceDisc.enabled = false;
    }
    if (this._savedFollowing === null) {
      return;
    }
    const panel = this.getSceneObject();
    if (!panel) {
      this._savedFollowing = null;
      return;
    }
    const frame = getFrameComponent(panel);
    if (frame && this._savedFollowing) {
      frame.setFollowing(true);
    }
    this._savedFollowing = null;
  }

  private _finishSetup(): void {
    this._log(
      `finish connect=${this._connectCompleted ? "done" : "skipped"} calibration=${
        this._calibrationFlow?.isComplete() ? "done" : "skipped"
      }`,
    );
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = false;
    }
    if (this.alignmentSession) {
      this.alignmentSession.stop();
    }
    this.dimosManager?.enterRuntime();
  }

  private _log(message: string): void {
    print(`SetupWizard: ${message}`);
  }
}
