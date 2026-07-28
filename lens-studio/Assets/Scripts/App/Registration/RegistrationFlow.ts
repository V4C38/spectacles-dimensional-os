// ================================================================
/**
 * Registration-step state machine; presentation via RegistrationPresentation.
 */
// ================================================================

import { RegistrationClient } from "../../ARBridge/Registration/RegistrationClient";
import { NO_ROBOT_CONNECTED_LABEL } from "../AppState";
import { ARBridgeCoordinator } from "../ARBridgeCoordinator";
import {
  RegistrationMode,
  RegistrationStatusMessage,
} from "../../ARBridge/Network/Protocol";
export type { RegistrationStatusMessage } from "../../ARBridge/Network/Protocol";
import {
  buildAprilTagDescription,
  createRegistrationSessionView,
  formatRegistrationProgressText,
  hasRegistrationCandidate,
  isCommitPending,
  isRegistrationComplete,
  isRegistrationFailed,
  mergeRegistrationStatus,
  NO_RESPONSE_STATUS_MSG,
  projectRegistrationPresentation,
  REGISTRATION_DESCRIPTION_MANUAL,
  REGISTRATION_STEP_DESCRIPTIONS as STEP_DESC_MAP,
  REGISTRATION_STEP_TITLES as STEP_TITLE_MAP,
  RegistrationPresentation,
  RegistrationSessionView,
  registrationProgressPercent,
  registrationStepTitle,
  type RegistrationStep as RegistrationStepKey,
} from "./RegistrationPresentation";

export enum RegistrationStep {
  StartRobot = 0,
  ConnectBridge = 1,
  RegisterRobot = 2,
}

export const LAST_REGISTRATION_STEP = RegistrationStep.RegisterRobot;

export {
  buildAprilTagDescription,
  createRegistrationSessionView,
  formatRegistrationProgressText,
  hasRegistrationCandidate,
  isCommitPending,
  isRegistrationComplete,
  isRegistrationFailed,
  mergeRegistrationStatus,
  projectRegistrationPresentation,
  REGISTRATION_DESCRIPTION_MANUAL,
  REGISTRATION_STATUS_MANUAL,
  registrationProgressPercent,
  registrationStepTitle,
  SCALE_LOCK_WALK_HINT,
  shouldShowScaleLockHint,
} from "./RegistrationPresentation";

export type {
  RegistrationPresentation,
  RegistrationSessionView,
} from "./RegistrationPresentation";

const REGISTRATION_STEP_KEYS: RegistrationStepKey[] = [
  "startRobot",
  "connectBridge",
  "registerRobot",
];

export const WIZARD_STEP_TITLES: string[] = [
  STEP_TITLE_MAP.startRobot,
  STEP_TITLE_MAP.connectBridge,
  STEP_TITLE_MAP.registerRobot,
];

export function registrationStepKey(step: RegistrationStep): RegistrationStepKey {
  return REGISTRATION_STEP_KEYS[step] ?? "startRobot";
}

export const WIZARD_STEP_DESCRIPTIONS: string[] = [
  STEP_DESC_MAP.startRobot,
  STEP_DESC_MAP.connectBridge,
  buildAprilTagDescription(NO_ROBOT_CONNECTED_LABEL),
];

export function registrationStepName(step: RegistrationStep): string {
  switch (step) {
    case RegistrationStep.StartRobot:
      return "start";
    case RegistrationStep.ConnectBridge:
      return "connect";
    case RegistrationStep.RegisterRobot:
      return "register";
    default:
      return "unknown";
  }
}

export function shouldShowBackOnStartStep(openedFromRuntime: boolean): boolean {
  return openedFromRuntime;
}

export function buildRegistrationPresentationForWizard(
  session: RegistrationSessionView,
  step: RegistrationStep,
  connected: boolean,
  canGoBackAtStart: boolean = false,
): RegistrationPresentation {
  return projectRegistrationPresentation(session, {
    step: registrationStepKey(step),
    connected,
    canGoBackAtStart,
  });
}

/**
 * Bridge manual_pose uses awaiting_commit when a pose candidate is ready.
 * Lens session state awaiting_commit is reserved for after the user presses Complete.
 */
export function reconcileManualRegistrationSessionState(
  session: RegistrationSessionView,
  msg: RegistrationStatusMessage,
  commitRequested: boolean,
): RegistrationSessionView {
  const merged = mergeRegistrationStatus(session, msg);
  if (merged.mode !== "manual_pose") {
    return merged;
  }
  if (commitRequested) {
    if (msg.state !== "succeeded" && msg.state !== "failed") {
      return { ...merged, state: "awaiting_commit" };
    }
    return merged;
  }
  if (msg.state === "awaiting_commit") {
    return { ...merged, state: "manual_placement" };
  }
  return merged;
}

const MANUAL_CANDIDATE_SYNC_INTERVAL_S = 0.35;

export interface RegistrationFlowCallbacks {
  beginManualRegistrationPlacementFromWizard: () => boolean;
  render: () => void;
  refreshFooter: () => void;
  refreshDescription: () => void;
  log: (message: string) => void;
  finishRegistration: () => void;
  scheduleFinishRegistration: (delaySecs: number) => void;
}

export class RegistrationFlow {
  private _session: RegistrationSessionView = createRegistrationSessionView();
  private _lastManualCandidateSyncTime = -1;
  private _lastLoggedRegistrationStatusKey = "";
  private _finishRegistrationDispatched = false;
  private _commitRequested = false;

  constructor(
    private readonly _coordinator: ARBridgeCoordinator | null,
    private readonly _callbacks: RegistrationFlowCallbacks,
  ) {}

  private get _registrationPreview() {
    return this._coordinator?.registrationPreview ?? null;
  }

  private get _registrationClient() {
    return this._coordinator?.registrationClient ?? null;
  }

  private get _bridgeRuntime() {
    return this._coordinator?.router ?? null;
  }

  private get _robotRuntime() {
    return this._coordinator?.robot ?? null;
  }

  private get _frameCapture() {
    return this._coordinator?.frameCaptureController ?? null;
  }

  public get session(): RegistrationSessionView {
    return this._session;
  }

  public setSession(session: RegistrationSessionView): void {
    this._session = session;
  }

  public get registrationClient(): RegistrationClient | null {
    return this._registrationClient;
  }

  public isComplete(): boolean {
    return isRegistrationComplete(this._session.state);
  }

  public enter(): void {
    this._finishRegistrationDispatched = false;
    this._commitRequested = false;
    this._beginAprilTag();
  }

  public leave(): void {
    this._finishRegistrationDispatched = false;
    this._commitRequested = false;
    this._lastManualCandidateSyncTime = -1;
    this._registrationClient?.stop({ notifyBridge: true });
    this._registrationClient?.cancelPlacement();
    this._registrationClient?.clearPose();
    this._robotRuntime?.applyInteractionFromState();
  }

  public toggleRegistrationMode(): void {
    if (this._session.mode === "manual_pose") {
      this._callbacks.log("manual registration disabled");
      this._beginAprilTag();
      return;
    }
    this._callbacks.log("manual registration enabled");
    this._beginManualPlacement();
  }

  public completeRegistration(): boolean {
    if (isRegistrationComplete(this._session.state)) {
      return true;
    }
    if (isCommitPending(this._session.state)) {
      return false;
    }
    if (this._session.mode === "manual_pose") {
      return this._completeManualStep();
    }
    if (hasRegistrationCandidate(this._session.state)) {
      if (this._registrationClient?.commit()) {
        this._commitRequested = true;
        this._session = {
          ...this._session,
          state: "awaiting_commit",
          statusDetail: "",
        };
        this._notify();
        this._callbacks.log("registration commit requested");
        return false;
      }
      this._callbacks.log(
        "auto registration: commit failed — registration client unavailable",
      );
      this._session = { ...this._session, statusDetail: "" };
      this._notify();
      return false;
    }
    this._registrationClient?.stop({ notifyBridge: true });
    this._callbacks.log("registration step skipped");
    return true;
  }

  public handleRegistrationStatus(msg: RegistrationStatusMessage): void {
    this._logRegistrationStatusIfChanged(msg);
    this._session = reconcileManualRegistrationSessionState(
      this._session,
      msg,
      this._commitRequested,
    );

    if (msg.state === "succeeded") {
      this._commitRequested = false;
      this._registrationPreview?.render(this._session);
      this._tryAutoFinishRegistration();
      this._notify();
      return;
    }

    if (msg.state === "failed") {
      this._commitRequested = false;
      this._finishRegistrationDispatched = false;
      this._callbacks.log(
        `registration failed on bridge: ${msg.message || "unknown reason"}`,
      );
      if (this._session.mode === "manual_pose") {
        this._robotRuntime?.applyInteractionFromState();
      }
      this._registrationPreview?.end();
    } else if (this._session.mode === "april_tag") {
      this._registrationPreview?.render(this._session);
    }
    this._notify();
  }

  public retryRegistration(): void {
    if (!isRegistrationFailed(this._session.state)) {
      return;
    }
    this._finishRegistrationDispatched = false;
    if (this._session.mode === "manual_pose") {
      this._callbacks.log("retry requested — restarting manual registration");
      this._beginManualPlacement();
      return;
    }
    this._callbacks.log("retry requested — restarting auto registration");
    this._beginAprilTag();
  }

  public handleBridgeConnectionChanged(connected: boolean): void {
    if (!connected && this._commitRequested) {
      this._commitRequested = false;
      this._callbacks.log("manual registration: bridge disconnected during commit");
      this._session = {
        ...this._session,
        state: "manual_placement",
        statusDetail: "",
      };
      this._notify();
    }
  }

  public tick(): void {
    if (
      this._registrationClient?.hasActiveIntent() &&
      this._registrationClient.isNoResponseTimeout() &&
      this._bridgeRuntime?.isBridgeSessionReady()
    ) {
      if (this._session.statusDetail !== NO_RESPONSE_STATUS_MSG) {
        this._session = { ...this._session, statusDetail: NO_RESPONSE_STATUS_MSG };
        this._callbacks.render();
      }
      return;
    }

    if (
      this._session.mode !== "manual_pose" ||
      isCommitPending(this._session.state) ||
      isRegistrationComplete(this._session.state) ||
      !this._bridgeRuntime?.isBridgeSessionReady()
    ) {
      this._lastManualCandidateSyncTime = -1;
      return;
    }

    const now = getTime();
    if (
      this._lastManualCandidateSyncTime >= 0 &&
      now - this._lastManualCandidateSyncTime < MANUAL_CANDIDATE_SYNC_INTERVAL_S
    ) {
      return;
    }
    this._lastManualCandidateSyncTime = now;
    this._registrationClient?.captureAndSubmitManualPose();
  }

  private _completeManualStep(): boolean {
    if (!this._bridgeRuntime?.isBridgeSessionReady()) {
      const finalized = this._registrationClient?.commitManualPlacementOffline() ?? false;
      if (!finalized) {
        this._callbacks.log(
          "manual registration: offline finalize failed — marker pose unavailable",
        );
        this._session = { ...this._session, statusDetail: "" };
        this._notify();
        return false;
      }
      this._registrationClient?.cancelPlacement();
      this._session = { ...this._session, state: "succeeded", statusDetail: "" };
      this._notify();
      this._callbacks.log("manual local-only registration accepted");
      return true;
    }

    const captured =
      this._registrationClient?.captureAndSubmitManualPose(true) ?? false;
    if (!captured) {
      this._callbacks.log(
        "manual registration: capture failed on Complete — marker pose unavailable",
      );
      this._session = { ...this._session, statusDetail: "" };
      this._notify();
      return false;
    }

    if (this._registrationClient?.commit()) {
      this._commitRequested = true;
      this._registrationClient?.freezePlacement();
      this._session = { ...this._session, state: "awaiting_commit", statusDetail: "" };
      this._notify();
      this._callbacks.log("manual registration commit requested");
      return false;
    }

    this._callbacks.log("manual registration: registration_command commit send failed");
    this._session = { ...this._session, statusDetail: "" };
    this._notify();
    return false;
  }

  private _beginAprilTag(): void {
    this._finishRegistrationDispatched = false;
    this._commitRequested = false;
    this._lastManualCandidateSyncTime = -1;
    this._session = createRegistrationSessionView("april_tag");
    this._registrationClient?.cancelPlacement();
    this._registrationClient?.stop({ notifyBridge: true });
    this._registrationClient?.clearPose();
    this._robotRuntime?.applyInteractionFromState();
    this._frameCapture?.setCaptureErrorHandler(() => {
      this._callbacks.log("auto registration: camera capture error");
      this._session = { ...this._session, statusDetail: "" };
      this._notify();
    });
    this._registrationPreview?.begin();
    this._registrationClient?.start("april_tag");
    this._notify(true);
  }

  private _beginManualPlacement(): void {
    this._finishRegistrationDispatched = false;
    this._commitRequested = false;
    this._lastManualCandidateSyncTime = -1;
    this._registrationClient?.stop({ notifyBridge: true });
    this._session = createRegistrationSessionView("manual_pose");
    this._callbacks.refreshDescription();

    if (!this._callbacks.beginManualRegistrationPlacementFromWizard()) {
      this._callbacks.log(
        "manual registration: could not begin placement from wizard panel",
      );
      this._session = {
        ...this._session,
        state: "manual_placement",
        statusDetail: "",
      };
      this._registrationClient?.cancelPlacement();
      this._registrationClient?.stop({ notifyBridge: true });
      this._registrationClient?.clearPose();
      this._notify();
      return;
    }

    this._registrationClient?.start("manual_pose");
    this._callbacks.log("manual registration placement started");
    this._notify();
  }

  private _logRegistrationStatusIfChanged(msg: RegistrationStatusMessage): void {
    const key = `${msg.state}|${msg.mode ?? "-"}|${msg.tag_visible ?? "-"}`;
    if (key === this._lastLoggedRegistrationStatusKey) {
      return;
    }
    this._lastLoggedRegistrationStatusKey = key;
    this._callbacks.log(
      `registration_status state=${msg.state} mode=${msg.mode ?? "-"} "${msg.message}"`,
    );
  }

  private _notify(refreshDescription: boolean = false): void {
    if (refreshDescription) {
      this._callbacks.refreshDescription();
    }
    this._callbacks.render();
    this._callbacks.refreshFooter();
  }

  private _tryAutoFinishRegistration(): void {
    if (!isRegistrationComplete(this._session.state)) {
      return;
    }
    if (this._finishRegistrationDispatched) {
      return;
    }
    this._finishRegistrationDispatched = true;
    if (this._session.mode === "manual_pose") {
      this._callbacks.finishRegistration();
      return;
    }
    this._callbacks.scheduleFinishRegistration(1.5);
  }
}
