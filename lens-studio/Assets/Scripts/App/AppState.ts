// ================================================================
/** Observable store for registration/runtime phase, debug toggles, operating mode, and navigation/robot interaction state. */
// ================================================================

import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
} from "./UI/UIKit";
import { UILogListener, UILogger } from "./UI/UILogger";
import {
  TagTrackingProfile,
  RegistrationMode,
  deriveLinkStateFromSnapshot,
  type WorldFrameSolveMethod,
} from "../ARBridge/Network/Protocol";

/** Whole-app lifecycle: registration wizard vs live AR session. */
export type AppPhase = "registration" | "runtime";
/** Runtime UX mode; `"registrationMode"` is registration preview overlay — not the same as `AppPhase.registration`. */
export type OperatingMode = "registrationMode" | "manual" | "agent";
export type RobotInteractionMode = "hidden" | "manual_placement" | "runtimeRobot";
export type NavigationState =
  | "disabled"
  | "idle"
  | "navIntent"
  | "navigating"
  | "resolved";
export type WireNavigationState = Exclude<NavigationState, "disabled">;
export type NavTerminalOutcome = "succeeded" | "failed";
export type NavigationErrorState =
  | { kind: "none" }
  | { kind: "failed"; errorCode: number | null };
export type BridgeLinkState = "disconnected" | "connectedNoRobot" | "connected";
export type AgentActivityState = "idle" | "busy";

export interface AgentActivity {
  state: AgentActivityState;
  detail: string | null;
}

export const NO_ROBOT_CONNECTED_LABEL = "No Robot connected";

export interface BridgeSnapshot {
  handshakeReady: boolean;
  robotConnected: boolean;
  worldFrameCommitted: boolean;
  worldFrameApproximate: boolean;
  reconnecting: boolean;
  worldFrameMethod: RegistrationMode | null;
  statusTs: number | null;
}

export type LidarDisplayMode = "off" | "obstacles" | "full";

export type RegistrationSessionState = {
  phase: "registration";
  interaction: "hidden" | "manual_placement";
};

export type RuntimeSessionState = {
  phase: "runtime";
  operating: OperatingMode;
  interaction: RobotInteractionMode;
  navigation: NavigationState;
  error: NavigationErrorState;
};

export type SessionState = RegistrationSessionState | RuntimeSessionState;

export const LIDAR_MODE_LABELS: Record<LidarDisplayMode, string> = {
  off: "LiDAR: Off",
  obstacles: "LiDAR: Obstacles",
  full: "LiDAR: Full",
};

export interface StatusTextPresentation {
  text: string;
  color: vec4;
}

export function createDefaultBridgeSnapshot(): BridgeSnapshot {
  return {
    handshakeReady: false,
    robotConnected: false,
    worldFrameCommitted: false,
    worldFrameApproximate: false,
    reconnecting: false,
    worldFrameMethod: null,
    statusTs: null,
  };
}

export function bridgeNavigationReady(snapshot: BridgeSnapshot): boolean {
  return (
    snapshot.handshakeReady &&
    snapshot.robotConnected &&
    snapshot.worldFrameCommitted &&
    !snapshot.reconnecting
  );
}

export function defaultNavigationError(): NavigationErrorState {
  return { kind: "none" };
}

export function isRuntimePhase(state: AppStateData): boolean {
  return state.phase === "runtime";
}

export function navigationErrorIsNone(error: NavigationErrorState): boolean {
  return error.kind === "none";
}

export function navigationErrorIsFailed(error: NavigationErrorState): boolean {
  return error.kind === "failed";
}

export function navigationErrorHasNavRuntimeError(error: NavigationErrorState): boolean {
  return error.kind === "failed" && error.errorCode !== null;
}

export function navigationPlacementToggleEnabled(state: AppStateData): boolean {
  return state.navigationState !== "disabled";
}

export function navigationErrorPresentation(
  error: NavigationErrorState,
): StatusTextPresentation | null {
  if (error.kind === "failed") {
    return { text: "Navigation failed", color: COLOR_ERROR };
  }
  return null;
}

/** Robot HUD + menu activity line (Idle, Navigating, outcome, future agent bridge states). */
export function robotActivityPresentation(
  state: AppStateData,
): StatusTextPresentation {
  return (
    navigationErrorPresentation(state.navigationError)
    ?? robotMarkerSteadyStatePresentation(state)
  );
}

export function agentBusyVfxActive(state: AppStateData): boolean {
  if (state.operatingMode !== "agent") {
    return false;
  }
  // Busy VFX while executing, or while asleep (waiting for wake word).
  // Idle VFX only while Listening (session open, not executing).
  return state.agentActivity.state === "busy" || !state.agentSpeechSessionActive;
}

export function agentModeActivityPresentation(
  state: AppStateData,
): StatusTextPresentation {
  if (state.agentActivity.state === "busy") {
    return { text: "Executing Command", color: COLOR_WHITE };
  }
  if (state.agentSpeechSessionActive) {
    return { text: "Listening", color: COLOR_WHITE };
  }
  return { text: "Asleep", color: COLOR_WHITE };
}

export function createDefaultAgentActivity(): AgentActivity {
  return { state: "idle", detail: null };
}

export function robotMarkerSteadyStatePresentation(
  state: AppStateData,
): StatusTextPresentation {
  if (
    state.phase === "runtime" &&
    state.bridgeSnapshot.handshakeReady &&
    !state.bridgeSnapshot.robotConnected
  ) {
    return { text: "Robot offline", color: COLOR_ERROR };
  }
  if (state.operatingMode === "registrationMode") {
    return { text: "", color: COLOR_WHITE };
  }
  if (state.operatingMode === "agent") {
    return agentModeActivityPresentation(state);
  }
  if (!state.robotRuntime.capabilities.nav.available) {
    const reason = state.robotRuntime.capabilities.nav.reason;
    if (reason) {
      return { text: reason, color: COLOR_WHITE };
    }
  }
  if (state.navigationState === "navigating") {
    return { text: "Navigating", color: COLOR_WHITE };
  }
  if (state.navigationState === "navIntent") {
    return { text: "Preparing Navigation", color: COLOR_WHITE };
  }
  return { text: "Idle", color: COLOR_WHITE };
}

export function toSessionState(state: AppStateData): SessionState {
  if (state.phase === "registration") {
    const interaction =
      state.robotInteractionMode === "manual_placement"
        ? "manual_placement"
        : "hidden";
    return { phase: "registration", interaction };
  }
  return {
    phase: "runtime",
    operating: state.operatingMode,
    interaction: state.robotInteractionMode,
    navigation: state.navigationState,
    error: state.navigationError,
  };
}

export function validateSessionFields(state: AppStateData): AppStateData {
  const next: AppStateData = { ...state };

  if (next.phase === "registration") {
    next.navigationState = "disabled";
    next.navigationError = defaultNavigationError();
    if (next.robotInteractionMode === "runtimeRobot") {
      next.robotInteractionMode = "hidden";
    }
  }

  if (next.phase === "runtime") {
    const navModesArmed =
      next.operatingMode === "manual" || next.operatingMode === "agent";
    if (next.navigationState !== "disabled" && !navModesArmed) {
      next.navigationState = "disabled";
    }
    if (next.operatingMode === "registrationMode" && next.navigationState !== "disabled") {
      next.navigationState = "disabled";
    }
  }

  if (!next.robotRuntime.capabilities.lidar?.available && next.lidarMode !== "off") {
    next.lidarMode = "off";
  }

  return next;
}

export function nextLidarMode(mode: LidarDisplayMode): LidarDisplayMode {
  if (mode === "off") {
    return "obstacles";
  }
  if (mode === "obstacles") {
    return "full";
  }
  return "off";
}

export interface RuntimeCapabilityState {
  available: boolean;
  reason: string | null;
}

export interface RobotRuntimeState {
  negotiated: boolean;
  robotId: string | null;
  displayName: string;
  visualOriginFrame: string;
  bodyBoundsM: [number, number, number] | null;
  footprintM: [number, number] | null;
  baseHeightM: number | null;
  defaultRenderOffsetM: [number, number, number] | null;
  tagTrackingProfile: TagTrackingProfile | null;
  capabilities: Record<string, RuntimeCapabilityState>;
}

export interface DriftState {
  isDrifting: boolean;
  transDeltaM: number;
  yawDeltaDeg: number | null;
  yawCorrected: boolean;
  solveQuality: number;
  solveMethod: WorldFrameSolveMethod | null;
  lastUpdateTs: number | null;
}

export interface AppStateData {
  phase: AppPhase;
  debugMode: boolean;
  lidarMode: LidarDisplayMode;
  operatingMode: OperatingMode;
  navigationState: NavigationState;
  robotInteractionMode: RobotInteractionMode;
  navigationError: NavigationErrorState;
  bridgeSnapshot: BridgeSnapshot;
  robotRuntime: RobotRuntimeState;
  driftState: DriftState;
  agentActivity: AgentActivity;
  agentSpeechSessionActive: boolean;
}

export type AppStateListener = (state: AppStateData) => void;

const DEFAULT_CAPABILITY_NAMES = [
  "lidar",
  "odom",
  "nav",
  "path",
  "cancel_nav_goal",
  "emergency_stop",
];

function cloneCapabilities(
  capabilities: Record<string, RuntimeCapabilityState>,
): Record<string, RuntimeCapabilityState> {
  const next: Record<string, RuntimeCapabilityState> = {};
  Object.keys(capabilities).forEach((key) => {
    const capability = capabilities[key];
    next[key] = {
      available: capability.available,
      reason: capability.reason,
    };
  });
  return next;
}

function cloneRobotRuntime(state: RobotRuntimeState): RobotRuntimeState {
  return {
    ...state,
    bodyBoundsM: state.bodyBoundsM ? [...state.bodyBoundsM] as [number, number, number] : null,
    footprintM: state.footprintM ? [...state.footprintM] as [number, number] : null,
    defaultRenderOffsetM: state.defaultRenderOffsetM
      ? [...state.defaultRenderOffsetM] as [number, number, number]
      : null,
    tagTrackingProfile: state.tagTrackingProfile ? { ...state.tagTrackingProfile } : null,
    capabilities: cloneCapabilities(state.capabilities),
  };
}

function cloneDriftState(state: DriftState): DriftState {
  return { ...state };
}

function cloneNavigationError(error: NavigationErrorState): NavigationErrorState {
  if (error.kind === "failed") {
    return { kind: "failed", errorCode: error.errorCode };
  }
  return { ...error };
}

function cloneBridgeSnapshot(snapshot: BridgeSnapshot): BridgeSnapshot {
  return { ...snapshot };
}

function cloneAgentActivity(activity: AgentActivity): AgentActivity {
  return {
    state: activity.state,
    detail: activity.detail,
  };
}

function cloneState(state: AppStateData): AppStateData {
  return {
    ...state,
    bridgeSnapshot: cloneBridgeSnapshot(state.bridgeSnapshot),
    navigationError: cloneNavigationError(state.navigationError),
    robotRuntime: cloneRobotRuntime(state.robotRuntime),
    driftState: cloneDriftState(state.driftState),
    agentActivity: cloneAgentActivity(state.agentActivity),
  };
}

export function createDefaultRobotRuntimeState(): RobotRuntimeState {
  const capabilities: Record<string, RuntimeCapabilityState> = {};
  DEFAULT_CAPABILITY_NAMES.forEach((capability) => {
    capabilities[capability] = {
      available: true,
      reason: null,
    };
  });
  return {
    negotiated: false,
    robotId: null,
    displayName: NO_ROBOT_CONNECTED_LABEL,
    visualOriginFrame: "base_link",
    bodyBoundsM: null,
    footprintM: null,
    baseHeightM: null,
    defaultRenderOffsetM: null,
    tagTrackingProfile: null,
    capabilities,
  };
}

export function createDefaultDriftState(): DriftState {
  return {
    isDrifting: false,
    transDeltaM: 0.0,
    yawDeltaDeg: null,
    yawCorrected: false,
    solveQuality: 0.0,
    solveMethod: null,
    lastUpdateTs: null,
  };
}

export function createDefaultAppStateData(): AppStateData {
  return validateSessionFields({
    phase: "registration",
    debugMode: false,
    lidarMode: "off",
    operatingMode: "manual",
    navigationState: "disabled",
    robotInteractionMode: "hidden",
    navigationError: defaultNavigationError(),
    bridgeSnapshot: createDefaultBridgeSnapshot(),
    robotRuntime: createDefaultRobotRuntimeState(),
    driftState: createDefaultDriftState(),
    agentActivity: createDefaultAgentActivity(),
    agentSpeechSessionActive: false,
  });
}

export class AppState {
  private readonly _listeners: AppStateListener[] = [];
  private _dispatching = false;
  private _pendingPatches: Partial<AppStateData>[] = [];

  constructor(private _state: AppStateData) {}

  public get snapshot(): AppStateData {
    return cloneState(this._state);
  }

  public update(patch: Partial<AppStateData>): AppStateData {
    if (this._dispatching) {
      this._pendingPatches.push(patch);
      return cloneState(this._state);
    }
    this._state = validateSessionFields({ ...this._state, ...patch });
    this._dispatching = true;
    try {
      const snapshot = cloneState(this._state);
      for (const listener of this._listeners.slice()) {
        try {
          listener(snapshot);
        } catch (e) {
          print(`AppState listener error: ${e}`);
        }
      }
    } finally {
      this._dispatching = false;
    }
    while (this._pendingPatches.length > 0) {
      const queued = this._pendingPatches.splice(0);
      for (const pending of queued) {
        this.update(pending);
      }
    }
    return cloneState(this._state);
  }

  public subscribe(listener: AppStateListener): () => void {
    this._listeners.push(listener);
    listener(this.snapshot);
    return () => {
      const index = this._listeners.indexOf(listener);
      if (index >= 0) {
        this._listeners.splice(index, 1);
      }
    };
  }
}

/** Shared observable app state and UI log for AR bridge runtime subsystems. */
export class AppStateStore {
  private readonly _appState = new AppState(createDefaultAppStateData());
  private readonly _uiLogger = new UILogger();

  public get store(): AppState {
    return this._appState;
  }

  public get snapshot(): AppStateData {
    return cloneState(this._appState.snapshot);
  }

  public get bridgeLinkState(): BridgeLinkState {
    return deriveLinkStateFromSnapshot(this._appState.snapshot.bridgeSnapshot);
  }

  public update(patch: Partial<AppStateData>): AppStateData {
    return this._appState.update(patch);
  }

  public subscribe(listener: AppStateListener): () => void {
    return this._appState.subscribe(listener);
  }

  public get uiLogger(): UILogger {
    return this._uiLogger;
  }

  public subscribeUILog(listener: UILogListener): () => void {
    return this._uiLogger.subscribe(listener);
  }
}
