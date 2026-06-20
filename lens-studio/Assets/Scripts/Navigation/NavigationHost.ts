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

/** Navigation subsystem: goal placement, paths, and emergency stop. */
export class NavigationHost {
  private _nav: NavigationController | null = null;
  private _placementDeferralEvent: DelayedCallbackEvent | null = null;
  private _bound = false;

  constructor(
    private readonly _eventHost: BaseScriptComponent,
    private readonly _pathParentFallback: SceneObject,
    private readonly dimosState: DimosState,
    private readonly bridgeClient: BridgeClient | null,
    private readonly robotRuntime: RobotRuntime,
    private readonly robotMarker: RobotMarker | null,
    private readonly placementRayOrigin: SceneObject | null,
    private readonly navigationMarkerRoot: SceneObject | null,
    private readonly robotGroundDeadzoneRadiusCm: number,
  ) {}

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
      this._pathParentFallback;

    const goalRenderer = new NavigationMarkerView(this.navigationMarkerRoot);
    const pathRenderer = new NavigationPathRenderer(parent);
    const placement = new SurfacePlacementController(
      this._eventHost,
      WorldQueryModule,
      this.placementRayOrigin ?? null,
      goalRenderer,
    );

    this._nav = new NavigationController(
      this._eventHost,
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

    const placementDeferral = this._eventHost.createEvent(
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

  public onNavigationProfileChanged(): void {
    this._nav?.onNavigationProfileChanged();
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
