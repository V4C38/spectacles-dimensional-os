export type OperatingMode = import("../../DimOSARClient/replication/CollaborationTypes").InteractionSnapshot["mode"];

export class AppState {
  debugModeEnabled = false;
  setDebugMode(enabled: boolean): void { this.debugModeEnabled = enabled; }
}
