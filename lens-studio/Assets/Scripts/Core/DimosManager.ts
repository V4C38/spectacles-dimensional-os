import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { AlignmentSession } from "../Alignment/AlignmentSession";
import { BridgeClient } from "../Bridge/BridgeClient";
import { BridgeRuntime } from "../Bridge/BridgeRuntime";
import { DimosServices } from "./DimosServices";
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
import { isCapabilityAvailable } from "../Robot/RobotRuntimeModel";

/** Phase lifecycle, operating mode, and subsystem orchestration for DimOS runtime. */
@component
export class DimosManager extends BaseScriptComponent {
  @input
  dimosServices: DimosServices;

  private _lastSyncedOperatingMode: OperatingMode | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._bindSubsystems();
      this.enterSetup();
    });
  }

  public subscribeAppState(listener: AppStateListener): () => void {
    return this.dimosServices.state.subscribe(listener);
  }

  public get appState(): DimosAppState {
    return this.dimosServices.state.snapshot;
  }

  public get bridgeLinkState(): BridgeLinkState {
    return this.appState.bridgeLinkState;
  }

  public get onBridgeReady() {
    return this.dimosServices.bridge.onBridgeReady;
  }

  public get onBridgeStatusChanged() {
    return this.dimosServices.bridge.onBridgeStatusChanged;
  }

  public get onBridgeConnectionChanged() {
    return this.dimosServices.bridge.onBridgeConnectionChanged;
  }

  public get alignmentSession(): AlignmentSession {
    return this.dimosServices.alignment;
  }

  public get setupAlignmentPreview(): SetupAlignmentPreview {
    return this.dimosServices.setupPreview;
  }

  public get bridgeRuntime(): BridgeRuntime {
    return this.dimosServices.bridge;
  }

  public get robotRuntime(): RobotRuntime {
    return this.dimosServices.robot;
  }

  public get frameCaptureController(): FrameCaptureController | null {
    return this.dimosServices.frameCaptureController ?? null;
  }

  public get bridgeClient(): BridgeClient | null {
    return this.dimosServices.bridgeClient ?? null;
  }

  private _bindSubsystems(): void {
    if (!this.dimosServices) {
      return;
    }
    const robot = this.dimosServices.robot;
    const navigation = this.dimosServices.navigation;

    this.dimosServices.bind(
      {
        onToggleRequested: () => {
          const view = robot.robotMarkerView;
          if (this.operatingMode === "manual") {
            view?.hide();
            this.setNavigationPlacementEnabled(!this.navigationPlacementEnabled);
            return;
          }
          view?.toggleVisible();
        },
        onStopRequested: () => navigation.requestEmergencyStop(),
        onNavigationPlacementRequested: (enabled) =>
          this.setNavigationPlacementEnabled(enabled),
        getOperatingMode: () => this.operatingMode,
        getNavigationPlacementEnabled: () => this.navigationPlacementEnabled,
      },
      {
        poseCorrection: robot.poseCorrection,
        hasBridgeConnection: () => this.hasBridgeConnection(),
        isCapabilityAvailable: (cap) =>
          isCapabilityAvailable(this.appState.robotRuntime, cap),
        getInteractionMode: () => this.appState.robotInteractionMode,
        setInteractionMode: (mode) => this._setRobotInteractionMode(mode),
        getIsRuntimePhase: () => this.isRuntimePhase(),
        disableNavigationPlacementForAlignment: () => {
          if (navigation.placementEnabled) {
            navigation.setPlacementEnabled(false);
          }
        },
      },
    );

    this.dimosServices.state.subscribe((state) =>
      this._syncOperatingModeSideEffects(state),
    );
  }

  private _syncOperatingModeSideEffects(state: DimosAppState): void {
    const mode = state.operatingMode;
    if (this._lastSyncedOperatingMode === mode) {
      return;
    }
    this._lastSyncedOperatingMode = mode;
    this.dimosServices.robot.robotMarkerView?.setOperatingMode(mode);

    const navigation = this.dimosServices.navigation;
    if (mode === "setup") {
      navigation.setPlacementEnabledForOperatingMode(mode, state);
      return;
    }

    if (mode === "manual") {
      if (state.navigationState === "off") {
        this.dimosServices.state.update({ navigationState: "armed" });
      } else {
        navigation.syncPlacementToggleOnMarkerView();
        navigation.onPlacementEnabledChanged(true);
      }
    } else if (mode === "agent") {
      navigation.setPlacementEnabled(false);
      if (
        state.navigationState === "armed" ||
        state.navigationState === "placingGoal"
      ) {
        this.dimosServices.state.update({ navigationState: "off" });
      }
    }
    navigation.setPlacementEnabledForOperatingMode(mode, state);
  }

  private _applyPhaseSideEffects(phase: AppPhase): void {
    const robot = this.dimosServices.robot;
    const navigation = this.dimosServices.navigation;
    if (phase !== "runtime") {
      robot.clearInactiveState();
      navigation.clearInactiveState();
    }
    robot.applyInteractionFromState();
    if (phase === "runtime") {
      this.dimosServices.bridge.reapplyBridgeStatusIfConnected();
      robot.robotMarker?.syncPose();
    }
    navigation.applyRuntimeStateFromSnapshot();
    robot.refreshLidarPresentation();
  }

  public enterSetup(): void {
    this._log("enterSetup");
    this.alignmentSession?.cancelPlacement();
    this.alignmentSession?.stop();
    this.alignmentSession?.clearPose();
    this.dimosServices.bridge.disconnect();
    this.frameCaptureController?.setMode("off");
    this.dimosServices.state.update({
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
    this.dimosServices.robot.prepareForRuntime(
      Boolean(
        this.dimosServices.bridgeClient?.lastBridgeStatus?.registration_approximate,
      ),
    );
    this.dimosServices.state.update({ phase: "runtime", navigationState: "armed" });
    this._applyPhaseSideEffects("runtime");
    if (this.frameCaptureController) {
      const registered = Boolean(
        this.dimosServices.bridgeClient?.lastBridgeStatus?.registered,
      );
      this.frameCaptureController.setMode(registered ? "runtime" : "off");
    }
    this._setRobotInteractionMode("runtimeRobot");
    this.dimosServices.robot.robotMarker?.syncPose();
    this.dimosServices.navigation.deferPlacementSync();
  }

  public setBaseUrl(url: string): void {
    this.dimosServices.bridge.setBaseUrl(url);
  }

  public getBaseUrl(): string {
    return this.dimosServices.bridge.getBaseUrl();
  }

  public getDefaultBridgeIp(): string {
    return this.dimosServices.bridge.getDefaultBridgeIp();
  }

  public saveIp(ip: string): void {
    this.dimosServices.bridge.saveIp(ip);
  }

  public loadIp(): string | null {
    return this.dimosServices.bridge.loadIp();
  }

  public checkConnection(): Promise<boolean> {
    return this.dimosServices.bridge.checkConnection();
  }

  public disconnect(): void {
    this.dimosServices.bridge.disconnect();
  }

  public hasBridgeConnection(): boolean {
    return this.dimosServices.bridge.hasConnection();
  }

  public requestBridgeStatus(): boolean {
    return this.dimosServices.bridge.requestBridgeStatus();
  }

  public beginManualAlignmentPlacementAt(position: vec3, rotation: quat): void {
    this.alignmentSession?.beginManualPlacement(position, rotation);
  }

  public requestEmergencyStop(): void {
    this.dimosServices.navigation.requestEmergencyStop();
  }

  public beginAgentNavigationGoal(): boolean {
    return this.dimosServices.navigation.beginAgentNavigationGoal();
  }

  public submitAgentNavigationGoal(position: vec3, rotation: quat): boolean {
    return this.dimosServices.navigation.submitAgentNavigationGoal(position, rotation);
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
    this.dimosServices.state.update({ lidarMode: mode });
  }

  public setDebugMode(enabled: boolean): void {
    if (this.debugMode === enabled) {
      return;
    }
    this.dimosServices.state.update({ debugMode: enabled });
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
    this.dimosServices.state.update({ mainMenuExpandedSettingsMode: nextExpanded });
  }

  public setOperatingMode(mode: OperatingMode): void {
    if (this.appState.operatingMode === mode) {
      return;
    }
    this._log(`setOperatingMode: ${mode}`);
    if (mode === "setup") {
      this.dimosServices.state.update({ operatingMode: mode, lidarMode: "off" });
      return;
    }
    const lidarMode: LidarDisplayMode = mode === "manual" ? "obstacles" : "off";
    const settingsSubmenuOpen = this.appState.mainMenuExpandedSettingsMode !== null;
    this.dimosServices.state.update({
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
    this.dimosServices.state.update({ navigationState: enabled ? "armed" : "off" });
    const navigation = this.dimosServices.navigation;
    navigation.onPlacementEnabledChanged(enabled);
    navigation.syncPlacementToggleOnMarkerView();
  }

  public get navigationPlacementEnabled(): boolean {
    return navigationPlacementToggleEnabled(this.appState);
  }

  private isRuntimePhase(): boolean {
    return isAppRuntimePhase(this.appState);
  }

  private _setRobotInteractionMode(mode: RobotInteractionMode): void {
    if (this.appState.robotInteractionMode === mode) {
      this.dimosServices.robot.applyInteractionFromState();
      return;
    }
    this._log(`robotInteractionMode: ${mode}`);
    this.dimosServices.state.update({ robotInteractionMode: mode });
    this.dimosServices.robot.applyInteractionFromState();
  }

  private _log(message: string): void {
    print(`DimosManager: ${message}`);
  }
}
