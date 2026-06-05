// ================================================================
/** Observable store for setup/runtime phase, debug toggles, operating mode, and navigation/robot interaction state. */
// ================================================================

export type AppPhase = "setup" | "runtime";
export type OperatingMode = "manual" | "agent";
export type RobotInteractionMode = "hidden" | "manualPlacement" | "runtimeRobot";
export type NavigationMode = "idle" | "placingGoal" | "executingGoal";

export interface RuntimeCapabilityState {
  available: boolean;
  reason: string | null;
}

export interface RobotRuntimeState {
  negotiated: boolean;
  bridgeConnected: boolean;
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
  showLiDAR: boolean;
  operatingMode: OperatingMode;
  navigationPlacementEnabled: boolean;
  robotInteractionMode: RobotInteractionMode;
  navigationMode: NavigationMode;
  robotRuntime: RobotRuntimeState;
}

export type AppStateListener = (state: DimosAppState) => void;

const DEFAULT_CAPABILITY_NAMES = [
  "lidar",
  "odom",
  "align",
  "align_manual",
  "nav",
  "path",
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
    bridgeConnected: false,
    robotId: null,
    robotModel: null,
    displayName: "Development Robot",
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

  constructor(private _state: DimosAppState) {}

  public get snapshot(): DimosAppState {
    return cloneState(this._state);
  }

  public update(patch: Partial<DimosAppState>): DimosAppState {
    const nextState: DimosAppState = {
      ...this._state,
      ...patch,
    };
    this._state = nextState;
    const snapshot = cloneState(nextState);
    this._listeners.forEach((listener) => listener(snapshot));
    return snapshot;
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
