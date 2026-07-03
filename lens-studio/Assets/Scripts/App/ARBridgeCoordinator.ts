import { FrameCaptureController } from "../ARBridge/Camera/FrameCaptureController";
import { RegistrationClient } from "../ARBridge/Registration/RegistrationClient";
import { ARBridgeSession } from "../ARBridge/Network/ARBridgeSession";
import { InboundRouter } from "../ARBridge/Session/InboundRouter";
import { ARBridgeServices } from "./ARBridgeServices";
import { RobotPresenter } from "./Robot/RobotPresenter";
import { RegistrationPreviewPresenter } from "./Registration/RegistrationPreview";
import {
  AppStateListener,
  AppPhase,
  BridgeLinkState,
  bridgeNavigationReady,
  defaultNavigationOutcome,
  AppStateData,
  isRuntimePhase as isAppRuntimePhase,
  LidarDisplayMode,
  navigationPlacementToggleEnabled,
  NavigationGoalMode,
  nextLidarMode,
  nextNavigationGoalMode,
  OperatingMode,
  RobotInteractionMode,
} from "./AppState";
import { isCapabilityAvailable } from "./Robot/RobotRuntimeModel";
import { manualNavGoalConfig } from "../ARBridge/Navigation/NavigationModel";
import { COLOR_WHITE } from "./UI/kit/UIKit";

/** Phase lifecycle, operating mode, and subsystem orchestration for AR bridge runtime. */
@component
export class ARBridgeCoordinator extends BaseScriptComponent {
  @input
  arBridgeServices: ARBridgeServices;

  private _lastSyncedOperatingMode: OperatingMode | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._bindSubsystems();
      this.enterRegistration();
    });
  }

  public subscribeAppState(listener: AppStateListener): () => void {
    return this.arBridgeServices.state.subscribe(listener);
  }

  public get appState(): AppStateData {
    return this.arBridgeServices.state.snapshot;
  }

  public get bridgeLinkState(): BridgeLinkState {
    return this.appState.bridgeLinkState;
  }

  public get onBridgeReady() {
    return this.arBridgeServices.router.onBridgeReady;
  }

  public get onBridgeStatusChanged() {
    return this.arBridgeServices.router.onBridgeStatusChanged;
  }

  public get onBridgeConnectionChanged() {
    return this.arBridgeServices.router.onBridgeConnectionChanged;
  }

  public get registrationClient(): RegistrationClient {
    return this.arBridgeServices.registration;
  }

  public get registrationPreview(): RegistrationPreviewPresenter {
    return this.arBridgeServices.registrationPreview;
  }

  public get router(): InboundRouter {
    return this.arBridgeServices.router;
  }

  public get robot(): RobotPresenter {
    return this.arBridgeServices.robot;
  }

  public get frameCaptureController(): FrameCaptureController | null {
    return this.arBridgeServices.frameCaptureController ?? null;
  }

  public get bridgeSession(): ARBridgeSession | null {
    return this.arBridgeServices.bridgeSession ?? null;
  }

  private _bindSubsystems(): void {
    if (!this.arBridgeServices) {
      return;
    }
    const robot = this.arBridgeServices.robot;
    const navigation = this.arBridgeServices.navigation;

    this.arBridgeServices.bind(
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

    this.arBridgeServices.state.subscribe((state) =>
      this._syncOperatingModeSideEffects(state),
    );
  }

  private _syncOperatingModeSideEffects(state: AppStateData): void {
    const mode = state.operatingMode;
    if (this._lastSyncedOperatingMode === mode) {
      return;
    }
    this._lastSyncedOperatingMode = mode;
    this.arBridgeServices.robot.robotMarker?.ui?.setOperatingMode(mode);

    const navigation = this.arBridgeServices.navigation;
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
    const robot = this.arBridgeServices.robot;
    const navigation = this.arBridgeServices.navigation;
    if (phase !== "runtime") {
      robot.clearInactiveState();
      navigation.clearInactiveState();
    }
    robot.applyInteractionFromState();
    if (phase === "runtime") {
      this.arBridgeServices.router.reapplyBridgeStatusIfConnected();
      robot.robotMarker?.syncPose();
    }
    navigation.applyRuntimeStateFromSnapshot();
    robot.refreshLidarPresentation();
  }

  public enterRegistration(options?: { preserveBridge?: boolean }): void {
    this._log("enterRegistration");
    this.registrationClient?.cancelPlacement();
    this.registrationClient?.stop();
    this.registrationClient?.clearPose();
    this.arBridgeServices.router.cancelRuntimeReconnect();
    if (!options?.preserveBridge) {
      this.arBridgeServices.router.disconnect();
    }
    this.arBridgeServices.router.applyFrameCapturePolicy(true);
    this.arBridgeServices.state.update({
      phase: "registration",
      navigationOutcome: defaultNavigationOutcome(),
    });
    this._applyPhaseSideEffects("registration");
    this._setRobotInteractionMode("hidden");
  }

  public enterRuntime(): void {
    this._log("enterRuntime");
    this.registrationPreview?.endIfActive();
    this.registrationClient?.cancelPlacement();
    this.registrationClient?.stop();
    const runtimePatch: Partial<AppStateData> = { phase: "runtime" };
    this.arBridgeServices.state.update(runtimePatch);
    this._applyPhaseSideEffects("runtime");
    const bridgeSnapshot = this.appState.bridgeSnapshot;
    this.arBridgeServices.robot.prepareForRuntime(bridgeSnapshot.worldFrameApproximate);
    this.arBridgeServices.router.applyFrameCapturePolicy();
    this._setRobotInteractionMode("runtimeRobot");
    this.arBridgeServices.robot.robotMarker?.syncPose();
    if (this.operatingMode === "manual") {
      this.arBridgeServices.navigation.syncManualNavigationState({ forceEnable: true });
    } else {
      this.arBridgeServices.navigation.deferPlacementSync();
    }
  }

  public tryConnectBridge(ip: string): Promise<boolean> {
    return this.arBridgeServices.router.tryConnect(ip);
  }

  public normalizeBridgeIp(raw: string): string {
    return this.arBridgeServices.router.normalizeBridgeIp(raw);
  }

  public get bridgeClockSyncState(): "idle" | "pending" | "ready" | "failed" {
    return this.arBridgeServices.bridgeSession?.clockSyncState ?? "idle";
  }

  public get onBridgeClockSyncStateChanged() {
    return this.arBridgeServices.bridgeSession?.onClockSyncStateChanged;
  }

  public getBaseUrl(): string {
    return this.arBridgeServices.router.getBaseUrl();
  }

  public getDefaultBridgeIp(): string {
    return this.arBridgeServices.router.getDefaultBridgeIp();
  }

  public saveIp(ip: string): void {
    this.arBridgeServices.router.saveIp(ip);
  }

  public loadIp(): string | null {
    return this.arBridgeServices.router.loadIp();
  }

  public clearBridgeIp(): void {
    this.arBridgeServices.router.clearIp();
  }

  public isBridgeSocketOpen(): boolean {
    return this.arBridgeServices.router.isSocketOpen();
  }

  public disconnect(): void {
    this.arBridgeServices.router.disconnect();
  }

  public hasBridgeConnection(): boolean {
    return this.arBridgeServices.router.hasConnection();
  }

  public requestBridgeStatus(): boolean {
    return this.arBridgeServices.router.requestBridgeStatus();
  }

  public beginManualRegistrationPlacementAt(position: vec3, rotation: quat): void {
    this.registrationClient?.beginManualPlacement(position, rotation);
  }

  public requestEmergencyStop(): void {
    this.arBridgeServices.navigation.requestEmergencyStop();
  }

  public beginAgentNavigationGoal(): boolean {
    return this.arBridgeServices.navigation.canSubmitNavigationGoal();
  }

  public submitAgentNavigationGoal(position: vec3, rotation: quat): boolean {
    return this.arBridgeServices.navigation.submitGoal(position, rotation, {
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
    this.arBridgeServices.state.update({ navigationGoalMode: mode });
    this.arBridgeServices.navigation.onNavigationGoalModeChanged();
  }

  public get lidarMode(): LidarDisplayMode {
    return this.appState.lidarMode;
  }

  private setLidarMode(mode: LidarDisplayMode): void {
    if (this.lidarMode === mode) {
      return;
    }
    this._log(`setLidarMode: ${mode}`);
    this.arBridgeServices.state.update({ lidarMode: mode });
  }

  public setDebugMode(enabled: boolean): void {
    if (this.debugMode === enabled) {
      return;
    }
    this._log(`setDebugMode: ${enabled}`);
    this.arBridgeServices.state.update({ debugMode: enabled });
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

  public setOperatingMode(mode: OperatingMode): void {
    if (this.appState.operatingMode === mode) {
      return;
    }
    this._log(`setOperatingMode: ${mode}`);
    if (mode === "registration") {
      this.arBridgeServices.state.update({ operatingMode: mode, lidarMode: "off" });
      return;
    }
    this.arBridgeServices.state.update({ operatingMode: mode });
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
    const navigation = this.arBridgeServices.navigation;
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
      this.arBridgeServices.robot.applyInteractionFromState();
      return;
    }
    this._log(`robotInteractionMode: ${mode}`);
    this.arBridgeServices.state.update({ robotInteractionMode: mode });
    this.arBridgeServices.robot.applyInteractionFromState();
  }

  private _log(message: string): void {
    const text = `ARBridgeCoordinator: ${message}`;
    print(text);
    this.arBridgeServices.state.uiLogger.logConsole(text, COLOR_WHITE);
  }
}
