import { BridgeClient } from "../Bridge/BridgeClient";
import { DimosState } from "../Core/DimosState";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { NavigationController } from "./NavigationController";
import { NavigationMarkerView } from "./NavigationMarkerView";
import { NavigationPathRenderer } from "./NavigationPathRenderer";
import { SurfacePlacementController } from "./SurfacePlacementController";
import {
  DimosAppState,
  navigationPlacementToggleEnabled,
} from "../Core/AppState";

const WorldQueryModule = require("LensStudio:WorldQueryModule");

/** Scene component owning the navigation subsystem. */
@component
export class NavigationHost extends BaseScriptComponent {
  @input
  dimosState: DimosState;

  @input
  bridgeClient: BridgeClient;

  @input
  robotRuntime: RobotRuntime;

  @input
  robotMarker: RobotMarker;

  @input
  placementRayOrigin: SceneObject;

  @input
  navigationMarkerRoot: SceneObject;

  @input
  robotGroundDeadzoneRadiusCm = 75;

  private _nav: NavigationController | null = null;
  private _placementDeferralEvent: DelayedCallbackEvent | null = null;
  private _bound = false;

  public get controller(): NavigationController | null {
    return this._nav;
  }

  public bind(): void {
    if (this._bound) {
      return;
    }
    this._bound = true;

    const parent =
      this.robotMarker?.markerRoot?.getParent() ??
      this.getSceneObject();

    const goalRenderer = new NavigationMarkerView(this.navigationMarkerRoot);
    const pathRenderer = new NavigationPathRenderer(parent);
    const placement = new SurfacePlacementController(
      this,
      WorldQueryModule,
      this.placementRayOrigin ?? null,
      goalRenderer,
    );

    this._nav = new NavigationController(
      this,
      this.bridgeClient ?? null,
      this.dimosState.store,
      this.robotMarker ?? null,
      goalRenderer,
      pathRenderer,
      placement,
      this.robotGroundDeadzoneRadiusCm,
      () => this.robotRuntime?.lastPose ?? null,
      () => {},
    );

    this.robotRuntime.setSyncNavigationPlacement(() => this._nav?.syncPlacementState());

    this.dimosState.subscribe((state) => this._syncFromState(state));

    const placementDeferral = this.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    placementDeferral.bind(() => this._nav?.syncPlacementState());
    this._placementDeferralEvent = placementDeferral;

    this._nav.startWatchdog();
  }

  public deferPlacementSync(): void {
    this._placementDeferralEvent?.reset(0.0);
  }

  public requestEmergencyStop(): void {
    this._nav?.requestEmergencyStop();
  }

  public beginAgentNavigationGoal(): boolean {
    return this._nav?.beginAgentGoal() ?? false;
  }

  public submitAgentNavigationGoal(position: vec3, rotation: quat): boolean {
    return this._nav?.submitAgentGoal(position, rotation) ?? false;
  }

  public onHelloReset(): void {
    this._nav?.cancelOutcome();
  }

  public onDisconnect(): void {
    this._nav?.clearForDisconnect();
  }

  public resetForUserDisconnect(): void {
    this._nav?.resetForUserDisconnect();
  }

  public clearInactiveState(): void {
    this._nav?.clearInactiveState();
  }

  public applyRuntimeStateFromSnapshot(): void {
    this._nav?.applyRuntimeState(this.dimosState.snapshot.robotRuntime);
  }

  public setPlacementEnabledForOperatingMode(
    mode: DimosAppState["operatingMode"],
    state: DimosAppState,
  ): void {
    if (mode === "setup") {
      this._nav?.setPlacementEnabled(false);
      this._nav?.syncPlacementState();
      return;
    }
    if (mode === "manual") {
      if (state.navigationState !== "off") {
        this._nav?.onPlacementEnabledChanged(true);
      }
    } else if (mode === "agent") {
      this._nav?.setPlacementEnabled(false);
    }
    this._nav?.syncPlacementState();
  }

  public onPlacementEnabledChanged(enabled: boolean): void {
    this._nav?.onPlacementEnabledChanged(enabled);
  }

  public setPlacementEnabled(enabled: boolean): void {
    this._nav?.setPlacementEnabled(enabled);
  }

  public get placementEnabled(): boolean {
    return this._nav?.placementEnabled ?? false;
  }

  public syncPlacementToggleOnMarkerView(): void {
    this.robotRuntime.robotMarkerView?.setNavigationPlacementToggle(
      navigationPlacementToggleEnabled(this.dimosState.snapshot),
    );
  }

  private _syncFromState(state: DimosAppState): void {
    this._nav?.applyRuntimeState(state.robotRuntime);
    if (state.lidarMode === "off" && !this._nav?.canStartPlacement()) {
      this._nav?.setPlacementEnabled(false);
    }
  }
}
