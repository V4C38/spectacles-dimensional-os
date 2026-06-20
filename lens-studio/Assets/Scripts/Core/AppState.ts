// ================================================================
/** Observable store for setup/runtime phase, debug toggles, operating mode, and navigation/robot interaction state. */
// ================================================================

import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WHITE,
} from "../UI/kit/UIKit";
import {
  deriveNavigationProfile,
  isFollowingProfile,
  NAV_GOAL_MODE_LABELS,
  NavigationGoalMode,
  nextNavigationGoalMode,
} from "../Navigation/NavigationProfile";

export type { NavigationGoalMode };
export { NAV_GOAL_MODE_LABELS, nextNavigationGoalMode };

/** Whole-app lifecycle: setup wizard vs live XR session. */
export type AppPhase = "setup" | "runtime";
/** Runtime UX mode; `"setup"` is calibration preview overlay — not the same as `AppPhase.setup`. */
export type OperatingMode = "setup" | "manual" | "agent";
export type RobotInteractionMode = "hidden" | "manualPlacement" | "runtimeRobot";
export type NavigationState =
  | "off"
  | "armed"
  | "placingGoal"
  | "executingGoal";
export type NavigationOutcome =
  | { kind: "none" }
  | { kind: "success" }
  | { kind: "failed"; errorCode: number | null };
export type BridgeLinkState = "disconnected" | "connectedNoRobot" | "connected";
export type LidarDisplayMode = "off" | "obstacles" | "full";

export type SetupSessionState = {
  phase: "setup";
  interaction: "hidden" | "manualPlacement";
};

export type RuntimeSessionState = {
  phase: "runtime";
  operating: OperatingMode;
  interaction: RobotInteractionMode;
  navigation: NavigationState;
  outcome: NavigationOutcome;
};

export type SessionState = SetupSessionState | RuntimeSessionState;

export const LIDAR_MODE_LABELS: Record<LidarDisplayMode, string> = {
  off: "LiDAR: Off",
  obstacles: "LiDAR: Obstacles",
  full: "LiDAR: Full",
};

export interface StatusTextPresentation {
  text: string;
  color: vec4;
}

export function defaultNavigationOutcome(): NavigationOutcome {
  return { kind: "none" };
}

export function isRuntimePhase(state: DimosAppState): boolean {
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

export function navigationPlacementToggleEnabled(state: DimosAppState): boolean {
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

export function robotMarkerSteadyStatePresentation(
  state: DimosAppState,
): StatusTextPresentation {
  if (state.operatingMode === "setup") {
    return { text: "", color: COLOR_WHITE };
  }
  if (state.operatingMode === "agent") {
    return { text: "", color: COLOR_WHITE };
  }
  if (!state.robotRuntime.capabilities.nav.available) {
    const reason = state.robotRuntime.capabilities.nav.reason;
    if (reason) {
      return { text: reason, color: COLOR_WHITE };
    }
  }
  if (state.navigationState === "executingGoal") {
    const profile = deriveNavigationProfile(
      state.operatingMode,
      state.navigationGoalMode,
    );
    return {
      text: isFollowingProfile(profile) ? "Following" : "Navigating",
      color: COLOR_WHITE,
    };
  }
  return { text: "Idle", color: COLOR_WHITE };
}

export function toSessionState(state: DimosAppState): SessionState {
  if (state.phase === "setup") {
    const interaction =
      state.robotInteractionMode === "manualPlacement"
        ? "manualPlacement"
        : "hidden";
    return { phase: "setup", interaction };
  }
  return {
    phase: "runtime",
    operating: state.operatingMode,
    interaction: state.robotInteractionMode,
    navigation: state.navigationState,
    outcome: state.navigationOutcome,
  };
}

export function validateSessionFields(state: DimosAppState): DimosAppState {
  const next: DimosAppState = { ...state };

  if (next.phase === "setup") {
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
      next.operatingMode === "setup" &&
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
  robotModel: string | null;
  displayName: string;
  visualOriginFrame: string;
  bodyBoundsM: [number, number, number] | null;
  footprintM: [number, number] | null;
  baseHeightM: number | null;
  defaultRenderOffsetM: [number, number, number] | null;
  alignmentProfile: Record<string, unknown> | null;
  capabilities: Record<string, RuntimeCapabilityState>;
}

export interface DriftState {
  isDrifting: boolean;
  transDeltaM: number;
  yawDeltaDeg: number | null;
  yawCorrected: boolean;
  solveQuality: number;
  solveMethod: "tag" | "tag_translation" | null;
  lastUpdateTs: number | null;
}

export interface DimosAppState {
  phase: AppPhase;
  debugMode: boolean;
  lidarMode: LidarDisplayMode;
  operatingMode: OperatingMode;
  /** UI-only: which mode's settings submenu is open, or null when collapsed. */
  mainMenuExpandedSettingsMode: OperatingMode | null;
  navigationGoalMode: NavigationGoalMode;
  navigationState: NavigationState;
  robotInteractionMode: RobotInteractionMode;
  navigationOutcome: NavigationOutcome;
  bridgeLinkState: BridgeLinkState;
  robotRuntime: RobotRuntimeState;
  driftState: DriftState;
}

export type AppStateListener = (state: DimosAppState) => void;

export const NO_ROBOT_CONNECTED_LABEL = "No Robot connected";

const DEFAULT_CAPABILITY_NAMES = [
  "lidar",
  "odom",
  "align",
  "align_manual",
  "nav",
  "path",
  "plan_preview",
  "cancel_goal",
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
    alignmentProfile: state.alignmentProfile ? { ...state.alignmentProfile } : null,
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

function cloneState(state: DimosAppState): DimosAppState {
  return {
    ...state,
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
    robotModel: null,
    displayName: NO_ROBOT_CONNECTED_LABEL,
    visualOriginFrame: "base_link",
    bodyBoundsM: null,
    footprintM: null,
    baseHeightM: null,
    defaultRenderOffsetM: null,
    alignmentProfile: null,
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

export function createDefaultDimosAppState(): DimosAppState {
  return validateSessionFields({
    phase: "setup",
    debugMode: false,
    lidarMode: "obstacles",
    operatingMode: "manual",
    mainMenuExpandedSettingsMode: null,
    navigationGoalMode: "single",
    navigationState: "off",
    robotInteractionMode: "hidden",
    navigationOutcome: defaultNavigationOutcome(),
    bridgeLinkState: "disconnected",
    robotRuntime: createDefaultRobotRuntimeState(),
    driftState: createDefaultDriftState(),
  });
}

export class AppState {
  private readonly _listeners: AppStateListener[] = [];
  private _dispatching = false;
  private _pendingPatches: Partial<DimosAppState>[] = [];

  constructor(private _state: DimosAppState) {}

  public get snapshot(): DimosAppState {
    return cloneState(this._state);
  }

  public update(patch: Partial<DimosAppState>): DimosAppState {
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
