import { BridgeClient } from "../Bridge/BridgeClient";
import { FrameCaptureController } from "../Alignment/FrameCaptureController";
import { AlignmentSession } from "../Alignment/AlignmentSession";
import { BridgeRuntime } from "../Bridge/BridgeRuntime";
import { DimosState } from "./DimosState";
import { NavigationHost } from "../Navigation/NavigationHost";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { SetupAlignmentPreview } from "../Setup/SetupAlignmentPreview";
import {
  AppStateListener,
  AppPhase,
  BridgeLinkState,
  defaultNavigationOutcome,
  DimosAppState,
  isRuntimePhase as isAppRuntimePhase,
  LidarDisplayMode,
  navigationPlacementToggleEnabled,
  nextLidarMode,
  OperatingMode,
  RobotInteractionMode,
} from "./AppState";
import {
  isCapabilityAvailable,
} from "../Robot/RobotRuntimeModel";

/** Phase lifecycle, operating mode, and subsystem orchestration for DimOS runtime. */
@component
export class DimosManager extends BaseScriptComponent {
  @input
  dimosState: DimosState;

  @input
  bridgeRuntime: BridgeRuntime;

  @input
  robotRuntime: RobotRuntime;

  @input
  navigationHost: NavigationHost;

  @input
  setupAlignmentPreview: SetupAlignmentPreview;

  @input
  bridgeClient: BridgeClient;

  @input
  frameCaptureController: FrameCaptureController;

  @input
  alignmentSession: AlignmentSession;

  private _lastSyncedOperatingMode: OperatingMode | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._bindSubsystems();
      this.bridgeRuntime?.bind();
      this.enterSetup();
    });
  }

  public subscribeAppState(listener: AppStateListener): () => void {
    return this.dimosState.subscribe(listener);
  }

  public get appState(): DimosAppState {
    return this.dimosState.snapshot;
  }

  public get bridgeLinkState(): BridgeLinkState {
    return this.appState.bridgeLinkState;
  }

  public get onBridgeReady() {
    return this.bridgeRuntime.onBridgeReady;
  }

  public get onBridgeStatusChanged() {
    return this.bridgeRuntime.onBridgeStatusChanged;
  }

  public get onBridgeConnectionChanged() {
    return this.bridgeRuntime.onBridgeConnectionChanged;
  }

  private _bindSubsystems(): void {
    this.robotRuntime.bind({
      onToggleRequested: () => {
        const view = this.robotRuntime.robotMarkerView;
        if (this.operatingMode === "manual") {
          view?.hide();
          this.setNavigationPlacementEnabled(!this.navigationPlacementEnabled);
          return;
        }
        view?.toggleVisible();
      },
      onStopRequested: () => this.navigationHost.requestEmergencyStop(),
      onNavigationPlacementRequested: (enabled) =>
        this.setNavigationPlacementEnabled(enabled),
      getOperatingMode: () => this.operatingMode,
      getNavigationPlacementEnabled: () => this.navigationPlacementEnabled,
    });

    this.navigationHost.bind();

    if (this.alignmentSession) {
      this.alignmentSession.initialize({
        poseCorrection: this.robotRuntime.poseCorrection,
        hasBridgeConnection: () => this.hasBridgeConnection(),
        isCapabilityAvailable: (cap) =>
          isCapabilityAvailable(this.appState.robotRuntime, cap),
        getInteractionMode: () => this.appState.robotInteractionMode,
        setInteractionMode: (mode) => this._setRobotInteractionMode(mode),
        getIsRuntimePhase: () => this.isRuntimePhase(),
        disableNavigationPlacementForAlignment: () => {
          if (this.navigationHost.placementEnabled) {
            this.navigationHost.setPlacementEnabled(false);
          }
        },
      });
    }

    this.dimosState.subscribe((state) => this._syncOperatingModeSideEffects(state));
  }

  private _syncOperatingModeSideEffects(state: DimosAppState): void {
    const mode = state.operatingMode;
    if (this._lastSyncedOperatingMode === mode) {
      return;
    }
    this._lastSyncedOperatingMode = mode;
    this.robotRuntime.robotMarkerView?.setOperatingMode(mode);

    if (mode === "setup") {
      this.navigationHost.setPlacementEnabledForOperatingMode(mode, state);
      return;
    }

    if (mode === "manual") {
      if (state.navigationState === "off") {
        this.dimosState.update({ navigationState: "armed" });
      } else {
        this.navigationHost.syncPlacementToggleOnMarkerView();
        this.navigationHost.onPlacementEnabledChanged(true);
      }
    } else if (mode === "agent") {
      this.navigationHost.setPlacementEnabled(false);
      if (
        state.navigationState === "armed" ||
        state.navigationState === "placingGoal"
      ) {
        this.dimosState.update({ navigationState: "off" });
      }
    }
    this.navigationHost.setPlacementEnabledForOperatingMode(mode, state);
  }

  private _applyPhaseSideEffects(phase: AppPhase): void {
    if (phase !== "runtime") {
      this.robotRuntime.clearInactiveState();
      this.navigationHost.clearInactiveState();
    }
    this.robotRuntime.applyInteractionFromState();
    if (phase === "runtime") {
      this.bridgeRuntime.reapplyBridgeStatusIfConnected();
      this.robotRuntime.robotMarker?.syncPose();
    }
    this.navigationHost.applyRuntimeStateFromSnapshot();
    this.robotRuntime.refreshLidarPresentation();
  }

  public enterSetup(): void {
    this._log("enterSetup");
    this.alignmentSession?.cancelPlacement();
    this.alignmentSession?.stop();
    this.alignmentSession?.clearPose();
    this.bridgeRuntime.disconnect();
    this.frameCaptureController?.setMode("off");
    this.dimosState.update({
      phase: "setup",
      navigationState: "off",
      navigationOutcome: defaultNavigationOutcome(),
    });
    this._applyPhaseSideEffects("setup");
    this._setRobotInteractionMode("hidden");
  }

  public enterRuntime(): void {
    this._log("enterRuntime");
    this.setupAlignmentPreview?.endIfActive();
    this.alignmentSession?.cancelPlacement();
    this.alignmentSession?.stop();
    this.robotRuntime.prepareForRuntime(
      Boolean(this.bridgeClient?.lastBridgeStatus?.registration_approximate),
    );
    this.dimosState.update({ phase: "runtime", navigationState: "armed" });
    this._applyPhaseSideEffects("runtime");
    if (this.frameCaptureController) {
      const registered = Boolean(this.bridgeClient?.lastBridgeStatus?.registered);
      this.frameCaptureController.setMode(registered ? "runtime" : "off");
    }
    this._setRobotInteractionMode("runtimeRobot");
    this.robotRuntime.robotMarker?.syncPose();
    this.navigationHost.deferPlacementSync();
  }

  public setBaseUrl(url: string): void {
    this.bridgeRuntime.setBaseUrl(url);
  }

  public getBaseUrl(): string {
    return this.bridgeRuntime.getBaseUrl();
  }

  public getDefaultBridgeIp(): string {
    return this.bridgeRuntime.getDefaultBridgeIp();
  }

  public saveIp(ip: string): void {
    this.bridgeRuntime.saveIp(ip);
  }

  public loadIp(): string | null {
    return this.bridgeRuntime.loadIp();
  }

  public checkConnection(): Promise<boolean> {
    return this.bridgeRuntime.checkConnection();
  }

  public disconnect(): void {
    this.bridgeRuntime.disconnect();
  }

  public hasBridgeConnection(): boolean {
    return this.bridgeRuntime.hasConnection();
  }

  public requestBridgeStatus(): boolean {
    return this.bridgeRuntime.requestBridgeStatus();
  }

  public beginManualAlignmentPlacementAt(position: vec3, rotation: quat): void {
    this.alignmentSession?.beginManualPlacement(position, rotation);
  }

  public requestEmergencyStop(): void {
    this.navigationHost.requestEmergencyStop();
  }

  public beginAgentNavigationGoal(): boolean {
    return this.navigationHost.beginAgentNavigationGoal();
  }

  public submitAgentNavigationGoal(position: vec3, rotation: quat): boolean {
    return this.navigationHost.submitAgentNavigationGoal(position, rotation);
  }

  public cycleLidarMode(): void {
    this.setLidarMode(nextLidarMode(this.lidarMode));
  }

  public get lidarMode(): LidarDisplayMode {
    return this.appState.lidarMode;
  }

  private setLidarMode(mode: LidarDisplayMode): void {
    if (this.lidarMode === mode) {
      return;
    }
    this.dimosState.update({ lidarMode: mode });
  }

  public setDebugMode(enabled: boolean): void {
    if (this.debugMode === enabled) {
      return;
    }
    this.dimosState.update({ debugMode: enabled });
  }

  public get debugMode(): boolean {
    return this.appState.debugMode;
  }

  public onMainMenuModeButtonPressed(mode: OperatingMode): void {
    if (mode === "setup") {
      return;
    }
    if (this.appState.operatingMode === mode) {
      return;
    }
    this.setOperatingMode(mode);
  }

  public setMainMenuSettingsExpanded(enabled: boolean): void {
    const nextExpanded = enabled ? this.operatingMode : null;
    if (this.appState.mainMenuExpandedSettingsMode === nextExpanded) {
      return;
    }
    this.dimosState.update({ mainMenuExpandedSettingsMode: nextExpanded });
  }

  public setOperatingMode(mode: OperatingMode): void {
    if (this.appState.operatingMode === mode) {
      return;
    }
    this._log(`setOperatingMode: ${mode}`);
    if (mode === "setup") {
      this.dimosState.update({ operatingMode: mode, lidarMode: "off" });
      return;
    }
    const lidarMode: LidarDisplayMode = mode === "manual" ? "obstacles" : "off";
    const settingsSubmenuOpen = this.appState.mainMenuExpandedSettingsMode !== null;
    this.dimosState.update({
      operatingMode: mode,
      lidarMode,
      mainMenuExpandedSettingsMode: settingsSubmenuOpen ? mode : null,
    });
  }

  public get operatingMode(): OperatingMode {
    return this.appState.operatingMode;
  }

  public setNavigationPlacementEnabled(enabled: boolean): void {
    const currentEnabled = navigationPlacementToggleEnabled(this.appState);
    if (currentEnabled === enabled) {
      return;
    }
    this._log(`setNavigationPlacementEnabled: ${enabled}`);
    this.dimosState.update({ navigationState: enabled ? "armed" : "off" });
    this.navigationHost.onPlacementEnabledChanged(enabled);
    this.navigationHost.syncPlacementToggleOnMarkerView();
  }

  public get navigationPlacementEnabled(): boolean {
    return navigationPlacementToggleEnabled(this.appState);
  }

  private isRuntimePhase(): boolean {
    return isAppRuntimePhase(this.appState);
  }

  private _setRobotInteractionMode(mode: RobotInteractionMode): void {
    if (this.appState.robotInteractionMode === mode) {
      this.robotRuntime.applyInteractionFromState();
      return;
    }
    this._log(`robotInteractionMode: ${mode}`);
    this.dimosState.update({ robotInteractionMode: mode });
    this.robotRuntime.applyInteractionFromState();
  }

  private _log(message: string): void {
    print(`DimosManager: ${message}`);
  }
}
