// ================================================================
/**
 * Registration-step state machine + display builders for the registration wizard.
 */
// ================================================================

import { RegistrationClient } from "../../ARBridge/Registration/RegistrationClient";
import { NO_ROBOT_CONNECTED_LABEL } from "../AppState";
import { ARBridgeCoordinator } from "../ARBridgeCoordinator";
import {
  BridgeStatusMessage,
  RegistrationMotion,
  RegistrationPhase,
  RegistrationStatusMessage,
} from "../../ARBridge/Network/Protocol";
export type { RegistrationStatusMessage } from "../../ARBridge/Network/Protocol";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WHITE, SnapOS2Styles } from "../UI/kit/UIKit";
import { isRegistrationPreviewPhase } from "./RegistrationPreview";

export enum WizardStep {
  Start = 0,
  Connect = 1,
  Register = 2,
}

export const LAST_WIZARD_STEP = WizardStep.Register;

export type RegistrationUiMode = "auto" | "manual";

export interface RegistrationViewState {
  mode: RegistrationUiMode;
  phase: RegistrationPhase;
  message: string;
  tagVisible: boolean;
  motion?: RegistrationStatusMessage["motion"];
  previewPose?: RegistrationStatusMessage["preview_pose"];
}

export interface WizardFooterState {
  nextLabel: string;
  nextStyle: string;
  nextInactive: boolean;
  showPrev: boolean;
  showManual: boolean;
  manualLabel: string;
  manualStyle: string;
  centerNext: boolean;
  widePrevOffset: boolean;
}

export interface RegistrationDisplayModel {
  statusText: string;
  statusColor: vec4;
  detailText: string;
  detailColor: vec4;
}

export const WIZARD_STEP_TITLES: string[] = [
  "Start Robot & Bridge",
  "Connect",
  "Registration",
];

export function buildRegistrationDescriptionAuto(displayName: string): string {
  return `Look at the tag on the ${displayName}.`;
}

export function buildRegistrationStepTitle(mode: RegistrationUiMode): string {
  return mode === "manual" ? "Registration - Manual" : "Registration - April Tag";
}

export const REGISTRATION_DESCRIPTION_MANUAL =
  "Manually place the marker at the robot center.";

export const REGISTRATION_STATUS_MANUAL = "Complete to confirm manual Registration";

export const WIZARD_STEP_DESCRIPTIONS: string[] = [
  "Power on your robot.\nRun ./start.sh in dimos-ar on your Mac.",
  "Enter your Mac's IP.\nWait for ./start.sh to print \"Bridge ready\".\nUse same Wi‑Fi for robot, Mac, and Spectacles.",
  buildRegistrationDescriptionAuto(NO_ROBOT_CONNECTED_LABEL),
];

export function wizardStepName(step: WizardStep): string {
  switch (step) {
    case WizardStep.Start: return "start";
    case WizardStep.Connect: return "connect";
    case WizardStep.Register: return "register";
    default: return "unknown";
  }
}

export function createRegistrationViewState(): RegistrationViewState {
  return {
    mode: "auto",
    phase: "scanning",
    message: "",
    tagVisible: false,
  };
}

export function createManualRegistrationState(
  phase: RegistrationPhase = "editing",
): RegistrationViewState {
  return { mode: "manual", phase, message: "", tagVisible: false };
}

export function hasRegistrationCandidate(state: RegistrationViewState): boolean {
  return state.phase === "awaiting_commit" || state.phase === "succeeded";
}

export function isRegistrationPendingCommit(
  _state: RegistrationViewState,
  commitInFlight: boolean,
): boolean {
  return commitInFlight;
}

export function isRegistrationComplete(state: RegistrationViewState): boolean {
  return state.phase === "succeeded";
}

export function isRegistrationFailed(state: RegistrationViewState): boolean {
  return state.phase === "failed";
}

const MANUAL_CANDIDATE_SYNC_INTERVAL_S = 0.35;
const NO_RESPONSE_STATUS_MSG = "Bridge not responding";

export function buildRegistrationCheckpointTitle(motion: RegistrationMotion): string {
  const checkpoint = motion.waypoint_index - 1;
  return `checkpoint ${checkpoint}/${motion.waypoint_total} reached\n\n- Checkpoint reached -`;
}

export function buildRegistrationDetailText(state: RegistrationViewState): string {
  const parts: string[] = [];
  if (state.message) {
    parts.push(state.message);
  }
  if (state.motion) {
    parts.push(buildRegistrationCheckpointTitle(state.motion));
  }
  return parts.join("\n");
}

export function applyRegistrationStatusToViewState(
  state: RegistrationViewState,
  msg: RegistrationStatusMessage,
): RegistrationViewState {
  if (state.mode === "auto" && msg.mode === "manual_pose") {
    return state;
  }
  if (state.mode === "manual" && msg.mode === "april_odom_baseline") {
    return state;
  }
  return {
    ...state,
    phase: msg.phase,
    message: msg.message || state.message,
    tagVisible: msg.tag_visible ?? state.tagVisible,
    motion: msg.motion ?? state.motion,
    previewPose: msg.preview_pose ?? state.previewPose,
  };
}

export function buildRegistrationDisplay(
  state: RegistrationViewState,
  _hasBridgeConnection: boolean,
  commitInFlight = false,
): RegistrationDisplayModel {
  if (state.mode === "auto") {
    if (state.phase === "succeeded") {
      return {
        statusText: "Registration completed",
        statusColor: COLOR_SUCCESS,
        detailText: "",
        detailColor: COLOR_WHITE,
      };
    }
    if (state.phase === "failed") {
      return {
        statusText: state.message || "Registration failed",
        statusColor: COLOR_ERROR,
        detailText: "Tap Redo to retry",
        detailColor: COLOR_WHITE,
      };
    }
    if (state.message === NO_RESPONSE_STATUS_MSG) {
      return {
        statusText: NO_RESPONSE_STATUS_MSG,
        statusColor: COLOR_ERROR,
        detailText: "Check that ./start.sh is running, then retry or switch to Manual pose",
        detailColor: COLOR_WHITE,
      };
    }
    const tagStatus = state.tagVisible
      ? { text: "✅  Tag visible", color: COLOR_SUCCESS }
      : { text: "❌  Tag not visible", color: COLOR_ERROR };
    const detailText = buildRegistrationDetailText(state);
    if (isRegistrationPreviewPhase(state.phase)) {
      return {
        statusText: tagStatus.text,
        statusColor: tagStatus.color,
        detailText,
        detailColor: COLOR_WHITE,
      };
    }
    return {
      statusText: tagStatus.text,
      statusColor: tagStatus.color,
      detailText,
      detailColor: COLOR_WHITE,
    };
  }

  if (state.phase === "failed") {
    return {
      statusText: state.message || "Registration failed",
      statusColor: COLOR_ERROR,
      detailText: "",
      detailColor: COLOR_WHITE,
    };
  }
  return {
    statusText: REGISTRATION_STATUS_MANUAL,
    statusColor: COLOR_SUCCESS,
    detailText: "",
    detailColor: COLOR_WHITE,
  };
}

export function getWizardFooterState(
  step: WizardStep,
  connected: boolean,
  registrationState: RegistrationViewState,
  commitInFlight: boolean,
  motionAuthorizePending: boolean = false,
  canGoBackAtStart: boolean = false,
): WizardFooterState {
  let nextLabel = "Skip";
  let nextStyle = SnapOS2Styles.PrimaryNeutral;
  let nextInactive = false;

  if (step === WizardStep.Start) {
    nextLabel = "Complete";
    nextStyle = SnapOS2Styles.Primary;
  } else if (step === WizardStep.Connect && connected) {
    nextLabel = "Complete";
    nextStyle = SnapOS2Styles.Primary;
  } else if (step === WizardStep.Register) {
    if (isRegistrationFailed(registrationState)) {
      nextLabel = "Redo";
      nextStyle = SnapOS2Styles.PrimaryNeutral;
    } else if (isRegistrationPendingCommit(registrationState, commitInFlight)) {
      nextLabel = "Completing...";
      nextInactive = true;
    } else if (isRegistrationComplete(registrationState)) {
      if (registrationState.mode === "manual") {
        nextLabel = "Finishing...";
        nextInactive = true;
      } else {
        nextLabel = "Complete";
        nextStyle = SnapOS2Styles.Primary;
      }
    } else if (registrationState.phase === "awaiting_motion") {
      if (motionAuthorizePending) {
        nextLabel = "Continuing...";
        nextInactive = true;
      } else {
        nextLabel = "Continue";
        nextStyle = SnapOS2Styles.PrimaryNeutral;
      }
    } else if (hasRegistrationCandidate(registrationState)) {
      nextLabel = "Complete";
      nextStyle = SnapOS2Styles.Primary;
    } else if (registrationState.mode === "manual") {
      nextLabel = "Complete";
      nextStyle = SnapOS2Styles.Primary;
    }
  }

  return {
    nextLabel,
    nextStyle,
    nextInactive,
    showPrev: step !== WizardStep.Start || canGoBackAtStart,
    showManual:
      step === WizardStep.Register &&
      !isRegistrationPendingCommit(registrationState, commitInFlight),
    manualLabel:
      registrationState.mode === "manual" ? "AprilTag" : "Manual Placement",
    manualStyle: SnapOS2Styles.PrimaryNeutral,
    centerNext:
      (step === WizardStep.Start && !canGoBackAtStart) || step === WizardStep.Register,
    widePrevOffset: step === WizardStep.Register,
  };
}

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
  private _state: RegistrationViewState = createRegistrationViewState();
  private _lastManualCandidateSyncTime = -1;
  private _lastLoggedRegistrationStatusKey = "";
  private _commitInFlight = false;
  private _finishRegistrationDispatched = false;

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

  public get state(): RegistrationViewState {
    return this._state;
  }

  public setState(state: RegistrationViewState): void {
    this._state = state;
  }

  public get registrationClient(): RegistrationClient | null {
    return this._registrationClient;
  }

  public isComplete(): boolean {
    return isRegistrationComplete(this._state);
  }

  public isManualOnly(): boolean {
    return this._registrationClient?.preferredMode() === "manualOnly";
  }

  public get commitInFlight(): boolean {
    return this._commitInFlight;
  }

  public enter(): void {
    this._finishRegistrationDispatched = false;
    const preferredMode = this._registrationClient?.preferredMode() ?? "auto";
    if (preferredMode === "manualOnly" || !this._bridgeRuntime?.hasConnection()) {
      this._beginManualMode();
      return;
    }
    this._beginAutoMode();
  }

  public leave(): void {
    this._commitInFlight = false;
    this._finishRegistrationDispatched = false;
    this._lastManualCandidateSyncTime = -1;
    this._registrationClient?.stop({ notifyBridge: true });
    this._registrationClient?.cancelPlacement();
    this._registrationClient?.clearPose();
    this._robotRuntime?.applyInteractionFromState();
  }

  public toggleMode(): void {
    if (this.isManualOnly() && this._state.mode === "manual") {
      return;
    }
    if (this._state.mode === "manual") {
      this._callbacks.log("manual registration disabled");
      this._beginAutoMode();
      return;
    }
    this._callbacks.log("manual registration enabled");
    this._beginManualMode();
  }

  public completeStep(): boolean {
    if (isRegistrationComplete(this._state)) {
      return true;
    }
    if (isRegistrationPendingCommit(this._state, this._commitInFlight)) {
      return false;
    }
    if (this._state.mode === "manual") {
      return this._completeManualStep();
    }
    if (hasRegistrationCandidate(this._state)) {
      if (this._registrationClient?.commit()) {
        this._commitInFlight = true;
        this._state = { ...this._state, phase: "awaiting_commit", message: "" };
        this._notify();
        this._callbacks.log("registration commit requested");
        return false;
      }
      this._callbacks.log(
        "auto registration: commit failed — registration client unavailable",
      );
      this._state = { ...this._state, message: "" };
      this._notify();
      return false;
    }
    this._registrationClient?.stop({ notifyBridge: true });
    this._callbacks.log("registration step skipped");
    return true;
  }

  public handleRegistrationStatus(msg: RegistrationStatusMessage): void {
    this._logRegistrationStatusIfChanged(msg);
    if (msg.phase === "succeeded") {
      this.handleCommitAcknowledged("registration_status", msg);
      return;
    }
    this._state = applyRegistrationStatusToViewState(this._state, msg);

    if (msg.phase === "failed") {
      this._commitInFlight = false;
      this._finishRegistrationDispatched = false;
      this._callbacks.log(
        `registration failed on bridge: ${msg.message || "unknown reason"}`,
      );
      if (this._state.mode === "manual") {
        this._robotRuntime?.applyInteractionFromState();
      }
      this._registrationPreview?.end();
    } else if (this._state.mode === "auto") {
      this._registrationPreview?.updateFromRegistrationStatus(msg);
    }
    this._notify();
  }

  public redo(): void {
    if (!isRegistrationFailed(this._state)) {
      return;
    }
    this._finishRegistrationDispatched = false;
    if (
      this._registrationClient?.preferredMode() === "manualOnly" ||
      this._state.mode === "manual"
    ) {
      this._callbacks.log("redo requested — restarting manual registration");
      this._beginManualMode();
      return;
    }
    this._callbacks.log("redo requested — restarting auto registration");
    this._beginAutoMode();
  }

  public handleBridgeConnectionChanged(connected: boolean): void {
    if (!connected && isRegistrationPendingCommit(this._state, this._commitInFlight)) {
      this._commitInFlight = false;
      this._callbacks.log("manual registration: bridge disconnected during commit");
      this._state = { ...this._state, phase: "editing", message: "" };
      this._notify();
    }
  }

  public handleCommitAcknowledged(
    source: "bridge_status" | "registration_status",
    msg?: RegistrationStatusMessage,
  ): void {
    if (this._state.phase === "succeeded") {
      this._tryAutoFinishRegistration();
      return;
    }
    if (source === "bridge_status" && !this._commitInFlight) {
      return;
    }
    if (source === "registration_status" && msg) {
      this._state = applyRegistrationStatusToViewState(this._state, msg);
      if (this._state.phase !== "succeeded") {
        return;
      }
    } else {
      this._registrationClient?.cancelPlacement();
      this._state = { ...this._state, phase: "succeeded", message: "" };
      this._callbacks.log("registration confirmed via bridge_status");
    }
    this._registrationPreview?.setComplete();
    this._commitInFlight = false;
    this._notify();
    this._tryAutoFinishRegistration();
  }

  public handleBridgeStatus(msg: BridgeStatusMessage): void {
    if (this._commitInFlight && msg.world_frame_committed) {
      this.handleCommitAcknowledged("bridge_status");
    }
  }

  public tick(): void {
    if (
      this._registrationClient?.hasActiveIntent() &&
      this._registrationClient.isNoResponseTimeout() &&
      this._bridgeRuntime?.hasConnection()
    ) {
      if (this._state.message !== NO_RESPONSE_STATUS_MSG) {
        this._state = { ...this._state, message: NO_RESPONSE_STATUS_MSG };
        this._callbacks.render();
      }
      return;
    }

    if (
      this._state.mode !== "manual" ||
      isRegistrationPendingCommit(this._state, this._commitInFlight) ||
      isRegistrationComplete(this._state) ||
      !this._bridgeRuntime?.hasConnection()
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
    if (!this._bridgeRuntime?.hasConnection()) {
      const finalized = this._registrationClient?.finalizeOffline() ?? false;
      if (!finalized) {
        this._callbacks.log(
          "manual registration: offline finalize failed — marker pose unavailable",
        );
        this._state = { ...this._state, message: "" };
        this._notify();
        return false;
      }
      this._registrationClient?.cancelPlacement();
      this._state = { ...this._state, phase: "succeeded", message: "" };
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
      this._state = { ...this._state, message: "" };
      this._notify();
      return false;
    }

    if (this._registrationClient?.commit()) {
      this._commitInFlight = true;
      this._registrationClient?.freezePlacement();
      this._state = { ...this._state, phase: "awaiting_commit", message: "" };
      this._notify();
      this._callbacks.log("manual registration commit requested");
      return false;
    }

    this._callbacks.log("manual registration: registration_command commit send failed");
    this._state = { ...this._state, message: "" };
    this._notify();
    return false;
  }

  private _beginAutoMode(): void {
    this._commitInFlight = false;
    this._finishRegistrationDispatched = false;
    this._lastManualCandidateSyncTime = -1;
    this._state = createRegistrationViewState();
    this._registrationClient?.cancelPlacement();
    this._registrationClient?.stop({ notifyBridge: true });
    this._registrationClient?.clearPose();
    this._robotRuntime?.applyInteractionFromState();
    this._frameCapture?.setCaptureErrorHandler(() => {
      this._callbacks.log("auto registration: camera capture error");
      this._state = { ...this._state, message: "" };
      this._notify();
    });
    this._registrationPreview?.begin();
    this._registrationClient?.start("april_odom_baseline");
    this._notify(true);
  }

  private _beginManualMode(): void {
    this._commitInFlight = false;
    this._finishRegistrationDispatched = false;
    this._lastManualCandidateSyncTime = -1;
    this._registrationClient?.stop({ notifyBridge: true });
    this._state = createManualRegistrationState("editing");
    this._callbacks.refreshDescription();

    if (!this._callbacks.beginManualRegistrationPlacementFromWizard()) {
      this._callbacks.log(
        "manual registration: could not begin placement from wizard panel",
      );
      this._state = { ...this._state, phase: "editing", message: "" };
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
    const key = `${msg.phase}|${msg.mode ?? "-"}|${msg.capture}|${msg.motion?.waypoint_index ?? "-"}`;
    if (key === this._lastLoggedRegistrationStatusKey) {
      return;
    }
    this._lastLoggedRegistrationStatusKey = key;
    this._callbacks.log(
      `registration_status phase=${msg.phase} mode=${msg.mode ?? "-"} capture=${msg.capture} "${msg.message}"`,
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
    if (!isRegistrationComplete(this._state)) {
      return;
    }
    if (this._finishRegistrationDispatched) {
      return;
    }
    this._finishRegistrationDispatched = true;
    this._commitInFlight = false;
    if (this._state.mode === "manual") {
      this._callbacks.finishRegistration();
      return;
    }
    this._callbacks.scheduleFinishRegistration(1.5);
  }
}
