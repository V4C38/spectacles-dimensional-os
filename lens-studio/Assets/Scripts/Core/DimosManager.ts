import { FrameCaptureController } from "../Camera/FrameCaptureController";
import { RegistrationClient } from "../Registration/RegistrationClient";
import { BridgeClient } from "../Bridge/BridgeClient";
import { BridgeRuntime } from "../Bridge/BridgeRuntime";
import { DimosServices } from "./DimosServices";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { SetupRegistrationPreview } from "../Setup/SetupRegistrationPreview";
import {
  AppStateListener,
  AppPhase,
  BridgeLinkState,
  bridgeNavigationReady,
  defaultNavigationOutcome,
  DimosAppState,
  isRuntimePhase as isAppRuntimePhase,
  LidarDisplayMode,
  navigationPlacementToggleEnabled,
  NavigationGoalMode,
  nextLidarMode,
  nextNavigationGoalMode,
  OperatingMode,
  RobotInteractionMode,
} from "./AppState";
import { isCapabilityAvailable } from "../Robot/RobotRuntimeModel";
import { manualNavGoalConfig } from "../Navigation/NavigationModel";

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

  public get registrationClient(): RegistrationClient {
    return this.dimosServices.registration;
  }

  public get setupRegistrationPreview(): SetupRegistrationPreview {
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
          robot.robotMarker?.ui?.toggleVisible();
        },
        onStopRequested: () => navigation.requestEmergencyStop(),
        onGoalModeCycleRequested: () => this.cycleNavigationGoalMode(),
        getOperatingMode: () => this.operatingMode,
      },
      {
        manualRegistrationAlignment: robot.manualRegistrationAlignment,
        hasBridgeConnection: () => this.hasBridgeConnection(),
        isCapabilityAvailable: (cap) =>
          isCapabilityAvailable(this.appState.robotRuntime, cap),
        getInteractionMode: () => this.appState.robotInteractionMode,
        setInteractionMode: (mode) => this._setRobotInteractionMode(mode),
        getIsRuntimePhase: () => this.isRuntimePhase(),
        disableNavigationPlacementForRegistration: () => {
          if (navigation.placementEnabled) {
            navigation.disarm();
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
    this.dimosServices.robot.robotMarker?.ui?.setOperatingMode(mode);

    const navigation = this.dimosServices.navigation;
    if (mode === "registration") {
      navigation.syncManualNavigationForOperatingMode(mode, state);
      return;
    }

    if (mode === "manual") {
      navigation.syncManualNavigationState({ forceEnable: true });
    } else if (mode === "agent") {
      navigation.onManualNavigationToggleChanged(false);
    }
    navigation.syncManualNavigationForOperatingMode(mode, state);
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
    this.registrationClient?.cancelPlacement();
    this.registrationClient?.stop();
    this.registrationClient?.clearPose();
    this.dimosServices.bridge.cancelRuntimeReconnect();
    this.dimosServices.bridge.disconnect();
    this.dimosServices.bridge.applyFrameCapturePolicy(true);
    this.dimosServices.state.update({
      phase: "registration",
      navigationOutcome: defaultNavigationOutcome(),
    });
    this._applyPhaseSideEffects("registration");
    this._setRobotInteractionMode("hidden");
  }

  public enterRuntime(): void {
    this._log("enterRuntime");
    this.setupRegistrationPreview?.endIfActive();
    this.registrationClient?.cancelPlacement();
    this.registrationClient?.stop();
    const runtimePatch: Partial<DimosAppState> = { phase: "runtime" };
    if (this.operatingMode === "manual") {
      runtimePatch.lidarMode = "obstacles";
    }
    this.dimosServices.state.update(runtimePatch);
    this._applyPhaseSideEffects("runtime");
    const bridgeSnapshot = this.appState.bridgeSnapshot;
    this.dimosServices.robot.prepareForRuntime(bridgeSnapshot.worldFrameApproximate);
    this.dimosServices.bridge.applyFrameCapturePolicy();
    this._setRobotInteractionMode("runtimeRobot");
    this.dimosServices.robot.robotMarker?.syncPose();
    if (this.operatingMode === "manual") {
      this.dimosServices.navigation.syncManualNavigationState({ forceEnable: true });
    } else {
      this.dimosServices.navigation.deferPlacementSync();
    }
  }

  public tryConnectBridge(ip: string): Promise<boolean> {
    return this.dimosServices.bridge.tryConnect(ip);
  }

  public normalizeBridgeIp(raw: string): string {
    return this.dimosServices.bridge.normalizeBridgeIp(raw);
  }

  public get bridgeClockSyncState(): "idle" | "pending" | "ready" | "failed" {
    return this.dimosServices.bridgeClient?.clockSyncState ?? "idle";
  }

  public get onBridgeClockSyncStateChanged() {
    return this.dimosServices.bridgeClient?.onClockSyncStateChanged;
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

  public clearBridgeIp(): void {
    this.dimosServices.bridge.clearIp();
  }

  public isBridgeSocketOpen(): boolean {
    return this.dimosServices.bridge.isSocketOpen();
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

  public beginManualRegistrationPlacementAt(position: vec3, rotation: quat): void {
    this.registrationClient?.beginManualPlacement(position, rotation);
  }

  public requestEmergencyStop(): void {
    this.dimosServices.navigation.requestEmergencyStop();
  }

  public beginAgentNavigationGoal(): boolean {
    return this.dimosServices.navigation.canSubmitNavigationGoal();
  }

  public submitAgentNavigationGoal(position: vec3, rotation: quat): boolean {
    return this.dimosServices.navigation.submitGoal(position, rotation, {
      mode: "single",
      allowDrag: false,
      force: true,
    });
  }

  public cycleLidarMode(): void {
    this.setLidarMode(nextLidarMode(this.lidarMode));
  }

  public cycleNavigationGoalMode(): void {
    this.setNavigationGoalMode(nextNavigationGoalMode(this.navigationGoalMode));
  }

  public get navigationGoalMode(): NavigationGoalMode {
    return this.appState.navigationGoalMode;
  }

  private setNavigationGoalMode(mode: NavigationGoalMode): void {
    if (this.navigationGoalMode === mode) {
      return;
    }
    this._log(`setNavigationGoalMode: ${mode}`);
    this.dimosServices.state.update({ navigationGoalMode: mode });
    this.dimosServices.navigation.onNavigationGoalModeChanged();
  }

  public get lidarMode(): LidarDisplayMode {
    return this.appState.lidarMode;
  }

  private setLidarMode(mode: LidarDisplayMode): void {
    if (this.lidarMode === mode) {
      return;
    }
    this._log(`setLidarMode: ${mode}`);
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
    if (mode === "registration") {
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
    if (mode === "registration") {
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
    const navigation = this.dimosServices.navigation;
    if (enabled) {
      navigation.arm(manualNavGoalConfig(this.navigationGoalMode));
    } else {
      navigation.onManualNavigationToggleChanged(false);
    }
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
