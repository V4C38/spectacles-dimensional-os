import {
  AppState,
  AppStateListener,
  createDefaultDimosAppState,
  DimosAppState,
} from "./AppState";
import { UILogListener, UILogger } from "../UI/UILogger";

/** Shared observable app state and UI log for DimOS runtime subsystems. */
export class DimosState {
  private readonly _appState = new AppState(createDefaultDimosAppState());
  private readonly _uiLogger = new UILogger();

  public get store(): AppState {
    return this._appState;
  }

  public get snapshot(): DimosAppState {
    return this._appState.snapshot;
  }

  public update(patch: Partial<DimosAppState>): DimosAppState {
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
