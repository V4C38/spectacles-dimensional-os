export type OperatingMode = import("DimOSARClient.lspkg/Scripts/DimOSARClient/replication/CollaborationTypes").InteractionSnapshot["mode"];

export class AppState {
  debugModeEnabled = false;
  setDebugMode(enabled: boolean): void { this.debugModeEnabled = enabled; }
}
