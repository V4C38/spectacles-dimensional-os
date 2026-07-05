// ================================================================
/** Observable store for registration/runtime phase, debug toggles, operating mode, and navigation/robot interaction state. */
// ================================================================

import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
} from "./UI/kit/UIKit";
import { UILogListener, UILogger } from "./UI/UILogger";
import { TagTrackingProfile, RegistrationMode } from "../ARBridge/Network/Protocol";
import {
  NAV_GOAL_MODE_LABELS,
  NavigationGoalMode,
  nextNavigationGoalMode,
} from "../ARBridge/Navigation/NavigationModel";

export type { NavigationGoalMode };
export { NAV_GOAL_MODE_LABELS, nextNavigationGoalMode };

/** Whole-app lifecycle: registration wizard vs live AR session. */
export type AppPhase = "registration" | "runtime";
/** Runtime UX mode; `"registration"` is registration preview overlay — not the same as `AppPhase.registration`. */
export type OperatingMode = "registration" | "manual" | "agent";
export type RobotInteractionMode = "hidden" | "manualPlacement" | "runtimeRobot";
export type NavigationState =
  | "off"
  | "armed"
  | "placingGoal"
  | "navigating";
export type NavigationOutcome =
  | { kind: "none" }
  | { kind: "success" }
  | { kind: "failed"; errorCode: number | null };
export type BridgeLinkState = "disconnected" | "connectedNoRobot" | "connected";

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
  interaction: "hidden" | "manualPlacement";
};

export type RuntimeSessionState = {
  phase: "runtime";
  operating: OperatingMode;
  interaction: RobotInteractionMode;
  navigation: NavigationState;
  outcome: NavigationOutcome;
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

export function defaultNavigationOutcome(): NavigationOutcome {
  return { kind: "none" };
}

export function isRuntimePhase(state: AppStateData): boolean {
  return state.phase === "runtime";
}

export function navigationOutcomeIsNone(outcome: NavigationOutcome): boolean {
  return outcome.kind === "none";
}

export function navigationOutcomeIsFailed(outcome: NavigationOutcome): boolean {
  return outcome.kind === "failed";
}

export function navigationOutcomeHasNavRuntimeError(outcome: NavigationOutcome): boolean {
  return outcome.kind === "failed" && outcome.errorCode !== null;
}

export function navigationPlacementToggleEnabled(state: AppStateData): boolean {
  return state.navigationState !== "off";
}

export function navigationOutcomePresentation(
  outcome: NavigationOutcome,
): StatusTextPresentation | null {
  if (outcome.kind === "success") {
    return { text: "Navigation success", color: COLOR_SUCCESS };
  }
  if (outcome.kind === "failed") {
    return { text: "Navigation failed", color: COLOR_ERROR };
  }
  return null;
}

/** Main HUD bridge connection line. */
export function bridgeLinkPresentation(
  linkState: BridgeLinkState,
): StatusTextPresentation {
  switch (linkState) {
    case "disconnected":
      return {
        text: "\n\n\nBridge not connected",
        color: COLOR_ERROR,
      };
    case "connectedNoRobot":
      return {
        text: "\n\n\nBridge connected - waiting for robot",
        color: COLOR_WARN,
      };
    case "connected":
      return {
        text: `\n\n\nBridge connected - ${AppState.connectedRobotDisplayName}`,
        color: COLOR_SUCCESS,
      };
  }
}

export interface BridgeLinkTransitionLog {
  hudText: string;
  hudColor: vec4;
  consoleText: string;
  consoleColor: vec4;
  hudDurationS?: number;
}

/** UILogger + HUD copy when bridgeLinkState changes (runtime). */
export function bridgeLinkTransitionLog(
  prev: BridgeLinkState,
  next: BridgeLinkState,
): BridgeLinkTransitionLog | null {
  if (prev === next) {
    return null;
  }
  if (next === "disconnected") {
    return {
      hudText: "Bridge disconnected",
      hudColor: COLOR_ERROR,
      consoleText: "Bridge disconnected",
      consoleColor: COLOR_ERROR,
      hudDurationS: 3.0,
    };
  }
  if (prev === "connected" && next === "connectedNoRobot") {
    return {
      hudText: "Robot disconnected",
      hudColor: COLOR_ERROR,
      consoleText: "Robot disconnected",
      consoleColor: COLOR_ERROR,
      hudDurationS: 3.0,
    };
  }
  if (prev === "connectedNoRobot" && next === "connected") {
    return {
      hudText: "Robot connected",
      hudColor: COLOR_SUCCESS,
      consoleText: "Robot connected",
      consoleColor: COLOR_SUCCESS,
      hudDurationS: 2.0,
    };
  }
  return null;
}

/** Robot HUD + menu activity line (Idle, Navigating, outcome, future agent bridge states). */
export function robotActivityPresentation(
  state: AppStateData,
): StatusTextPresentation {
  return (
    navigationOutcomePresentation(state.navigationOutcome)
    ?? robotMarkerSteadyStatePresentation(state)
  );
}

export function robotMarkerSteadyStatePresentation(
  state: AppStateData,
): StatusTextPresentation {
  if (state.phase === "runtime" && state.bridgeLinkState === "connectedNoRobot") {
    return { text: "Robot offline", color: COLOR_ERROR };
  }
  if (state.operatingMode === "registration") {
    return { text: "", color: COLOR_WHITE };
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
  return { text: "Idle", color: COLOR_WHITE };
}

export function toSessionState(state: AppStateData): SessionState {
  if (state.phase === "registration") {
    const interaction =
      state.robotInteractionMode === "manualPlacement"
        ? "manualPlacement"
        : "hidden";
    return { phase: "registration", interaction };
  }
  return {
    phase: "runtime",
    operating: state.operatingMode,
    interaction: state.robotInteractionMode,
    navigation: state.navigationState,
    outcome: state.navigationOutcome,
  };
}

export function validateSessionFields(state: AppStateData): AppStateData {
  const next: AppStateData = { ...state };

  if (next.phase === "registration") {
    next.navigationState = "off";
    next.navigationOutcome = defaultNavigationOutcome();
    if (next.robotInteractionMode === "runtimeRobot") {
      next.robotInteractionMode = "hidden";
    }
  }

  if (next.phase === "runtime") {
    if (next.navigationState === "armed" && next.operatingMode !== "manual") {
      next.navigationState = "off";
    }
    if (
      next.operatingMode === "registration" &&
      (next.navigationState === "armed" || next.navigationState === "placingGoal")
    ) {
      next.navigationState = "off";
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
  solveMethod: "apriltag_full" | "apriltag_translation" | null;
  lastUpdateTs: number | null;
}

export interface AppStateData {
  phase: AppPhase;
  /** Session milestone: set when runtime is first entered; survives wizard re-entry. */
  runtimeEstablished: boolean;
  debugMode: boolean;
  lidarMode: LidarDisplayMode;
  operatingMode: OperatingMode;
  navigationGoalMode: NavigationGoalMode;
  navigationState: NavigationState;
  robotInteractionMode: RobotInteractionMode;
  navigationOutcome: NavigationOutcome;
  bridgeLinkState: BridgeLinkState;
  bridgeSnapshot: BridgeSnapshot;
  robotRuntime: RobotRuntimeState;
  driftState: DriftState;
}

export type AppStateListener = (state: AppStateData) => void;

const DEFAULT_CAPABILITY_NAMES = [
  "lidar",
  "odom",
  "registration_april_tag",
  "registration_manual_pose",
  "nav",
  "path",
  "plan_preview",
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

function cloneNavigationOutcome(outcome: NavigationOutcome): NavigationOutcome {
  if (outcome.kind === "failed") {
    return { kind: "failed", errorCode: outcome.errorCode };
  }
  return { ...outcome };
}

function cloneBridgeSnapshot(snapshot: BridgeSnapshot): BridgeSnapshot {
  return { ...snapshot };
}

function cloneState(state: AppStateData): AppStateData {
  return {
    ...state,
    bridgeSnapshot: cloneBridgeSnapshot(state.bridgeSnapshot),
    navigationOutcome: cloneNavigationOutcome(state.navigationOutcome),
    robotRuntime: cloneRobotRuntime(state.robotRuntime),
    driftState: cloneDriftState(state.driftState),
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
    runtimeEstablished: false,
    debugMode: false,
    lidarMode: "off",
    operatingMode: "manual",
    navigationGoalMode: "continuous",
    navigationState: "off",
    robotInteractionMode: "hidden",
    navigationOutcome: defaultNavigationOutcome(),
    bridgeLinkState: "disconnected",
    bridgeSnapshot: createDefaultBridgeSnapshot(),
    robotRuntime: createDefaultRobotRuntimeState(),
    driftState: createDefaultDriftState(),
  });
}

export class AppState {
  /** Set from bridge hello; cleared on disconnect. */
  static connectedRobotDisplayName: string = NO_ROBOT_CONNECTED_LABEL;

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
    return this._appState.snapshot;
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
