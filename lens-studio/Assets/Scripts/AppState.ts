export type AppPhase = "setup" | "runtime";
export type OperatingMode = "manual" | "agent";
export type RobotInteractionMode = "hidden" | "manualPlacement" | "runtimeRobot";
export type NavigationMode = "idle" | "placingGoal" | "executingGoal";

export interface DimosAppState {
  phase: AppPhase;
  debugMode: boolean;
  operatingMode: OperatingMode;
  executeMovement: boolean;
  navigationPlacementEnabled: boolean;
  robotInteractionMode: RobotInteractionMode;
  navigationMode: NavigationMode;
}

export type AppStateListener = (state: DimosAppState) => void;

function cloneState(state: DimosAppState): DimosAppState {
  return { ...state };
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
