// ================================================================
/** Observable store for setup/runtime phase, debug toggles, operating mode, and navigation/robot interaction state. */
// ================================================================

import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WHITE,
} from "../UI/kit/UIKit";

export type AppPhase = "setup" | "runtime";
export type OperatingMode = "manual" | "agent";
export type RobotInteractionMode = "hidden" | "manualPlacement" | "runtimeRobot";
export type NavigationMode = "idle" | "placingGoal" | "executingGoal";
export type NavigationOutcome = "none" | "success" | "failed";
export type BridgeLinkState = "disconnected" | "connectedNoRobot" | "connected";
export type LidarDisplayMode = "off" | "obstacles" | "full";

export const LIDAR_MODE_LABELS: Record<LidarDisplayMode, string> = {
  off: "LiDAR: Off",
  obstacles: "LiDAR: Obstacles",
  full: "LiDAR: Full",
};

export interface StatusTextPresentation {
  text: string;
  color: vec4;
}

export function navigationOutcomePresentation(
  outcome: NavigationOutcome,
): StatusTextPresentation | null {
  if (outcome === "success") {
    return { text: "Navigation success", color: COLOR_SUCCESS };
  }
  if (outcome === "failed") {
    return { text: "Navigation failed", color: COLOR_ERROR };
  }
  return null;
}

export function robotMarkerSteadyStatePresentation(
  state: DimosAppState,
): StatusTextPresentation {
  if (state.operatingMode === "agent") {
    return { text: "", color: COLOR_WHITE };
  }
  if (!state.robotRuntime.capabilities.nav.available) {
    const reason = state.robotRuntime.capabilities.nav.reason;
    if (reason) {
      return { text: reason, color: COLOR_WHITE };
    }
  }
  return {
    text: state.navigationMode === "executingGoal" ? "Navigating" : "Idle",
    color: COLOR_WHITE,
  };
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

export interface DimosAppState {
  phase: AppPhase;
  debugMode: boolean;
  lidarMode: LidarDisplayMode;
  operatingMode: OperatingMode;
  /** UI-only: which mode's settings submenu is open, or null when collapsed. */
  mainMenuExpandedSettingsMode: OperatingMode | null;
  navigationPlacementEnabled: boolean;
  robotInteractionMode: RobotInteractionMode;
  navigationMode: NavigationMode;
  navigationOutcome: NavigationOutcome;
  bridgeLinkState: BridgeLinkState;
  robotRuntime: RobotRuntimeState;
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

function cloneState(state: DimosAppState): DimosAppState {
  return {
    ...state,
    robotRuntime: cloneRobotRuntime(state.robotRuntime),
  };
}

const DEFAULT_ROBOT_BODY_HEIGHT_M = 0.55;
const LIDAR_FLOOR_CLEARANCE_CM = 0.5;
const LIDAR_MAX_HEIGHT_ABOVE_BODY_M = 1.0;

export interface LidarVerticalBandCm {
  minAboveFloorCm: number;
  maxAboveFloorCm: number;
}

/** Robot body height (m) from negotiated runtime metadata. */
export function robotBodyHeightM(runtime: RobotRuntimeState): number {
  if (runtime.bodyBoundsM) {
    return runtime.bodyBoundsM[2];
  }
  if (runtime.baseHeightM !== null) {
    return runtime.baseHeightM;
  }
  return DEFAULT_ROBOT_BODY_HEIGHT_M;
}

/** LiDAR vertical band above the robot floor plane (world cm). */
export function lidarVerticalBandCm(runtime: RobotRuntimeState): LidarVerticalBandCm {
  const bodyHeightCm = robotBodyHeightM(runtime) * 100.0;
  return {
    minAboveFloorCm: LIDAR_FLOOR_CLEARANCE_CM,
    maxAboveFloorCm: bodyHeightCm + LIDAR_MAX_HEIGHT_ABOVE_BODY_M * 100.0,
  };
}

/** World-space floor Y (cm) from marker origin Y and negotiated robot base height. */
export function robotFloorWorldYCm(
  markerWorldYCm: number,
  runtime: RobotRuntimeState,
): number {
  // Offline/manual marker Y is already ground contact; base_height only applies
  // to bridge poses at base_link after hello negotiation.
  if (!runtime.negotiated) {
    return markerWorldYCm;
  }
  const baseHeightM =
    runtime.baseHeightM ??
    (runtime.bodyBoundsM ? runtime.bodyBoundsM[2] : null);
  if (baseHeightM === null) {
    return markerWorldYCm;
  }
  return markerWorldYCm - baseHeightM * 100.0;
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
      // Re-entrant call from inside a listener — queue for after current dispatch.
      this._pendingPatches.push(patch);
      return cloneState(this._state);
    }
    this._state = { ...this._state, ...patch };
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
