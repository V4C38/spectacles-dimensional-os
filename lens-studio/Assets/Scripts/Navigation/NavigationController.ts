import { BridgeClient } from "../Network/BridgeClient";
import { NavigationMode } from "../AppState";
import { NavStatusMessage, PathMessage } from "../Network/Protocol";
import { PathRenderer } from "../Visuals/PathRenderer";
import { NavigationMarkerView } from "./NavigationMarkerView";
import { PlacementController } from "./PlacementController";

// ================================================================
/** State machine for goal placement, nav-goal submission, path display, and nav-status handling. */
// ================================================================

export interface NavigationControllerOptions {
  bridgeClient: BridgeClient | null;
  goalRenderer: NavigationMarkerView | null;
  pathRenderer: PathRenderer | null;
  placementController: PlacementController | null;
  onNavigationModeChanged: (mode: NavigationMode) => void;
  canStartPlacement: () => boolean;
  canSendNavGoal: () => boolean;
  getGoalResetPose?: () => { position: vec3; rotation: quat } | null;
}

export class NavigationController {
  private _placementEnabled = false;

  constructor(private readonly _options: NavigationControllerOptions) {
    if (this._options.placementController) {
      this._options.placementController.onConfirmed = (position, rotation) => {
        this._handleGoalConfirmed(position, rotation);
      };
      this._options.placementController.onCancelled = () => {
        this._handleGoalCancelled();
      };
    }
  }

  public setPlacementEnabled(
    enabled: boolean,
    initialPose: { position: vec3; rotation: quat } | null = null,
  ): void {
    if (enabled) {
      if (this._placementEnabled) {
        print("NavigationController: placement already enabled");
        return;
      }
      if (!this._options.canStartPlacement()) {
        print("NavigationController: cannot start placement (precondition failed)");
        return;
      }
      if (!initialPose) {
        print("NavigationController: cannot start placement (no initial pose)");
        return;
      }
      print("NavigationController: placement enabled");
      this._placementEnabled = true;
      this._options.pathRenderer?.clear();
      this._options.placementController?.start(
        initialPose.position,
        initialPose.rotation,
      );
      this._options.onNavigationModeChanged("placingGoal");
      return;
    }

    if (!this._placementEnabled) {
      return;
    }
    print("NavigationController: placement disabled");
    this._options.placementController?.stop();
    this._options.pathRenderer?.clear();
    this._placementEnabled = false;
    this._options.onNavigationModeChanged("idle");
  }

  public get placementEnabled(): boolean {
    return this._placementEnabled;
  }

  public clearInactiveState(): void {
    this._placementEnabled = false;
    this._options.placementController?.stop();
    this._options.pathRenderer?.clear();
    this._options.onNavigationModeChanged("idle");
  }

  public requestEmergencyStop(): void {
    this._options.bridgeClient?.sendEmergencyStop();
    if (this._placementEnabled) {
      this._options.placementController?.showPlacing();
      this._options.onNavigationModeChanged("placingGoal");
    } else {
      this._options.onNavigationModeChanged("idle");
    }
  }

  public requestCancelGoal(): void {
    this._options.bridgeClient?.sendCancelGoal();
    if (this._placementEnabled) {
      this._options.placementController?.showPlacing();
      this._options.onNavigationModeChanged("placingGoal");
    } else {
      this._options.onNavigationModeChanged("idle");
    }
  }

  public applyPath(msg: PathMessage): void {
    this._options.pathRenderer?.setProtocolPath(msg.waypoints);
  }

  public applyNavStatus(msg: NavStatusMessage): string {
    if (msg.goal_reached) {
      this._options.pathRenderer?.clear();
      if (this._placementEnabled) {
        const newPose = this._options.getGoalResetPose?.() ?? null;
        if (newPose) {
          this._options.placementController?.showPlacingAtNewPose(
            newPose.position,
            newPose.rotation,
          );
        } else {
          this._options.placementController?.showPlacing();
        }
        this._options.onNavigationModeChanged("placingGoal");
      } else {
        this._options.onNavigationModeChanged("idle");
      }
      return "Goal reached";
    }

    if (msg.state === "following_path") {
      if (this._placementEnabled) {
        this._options.onNavigationModeChanged("executingGoal");
      }
      return "Navigating";
    }
    if (msg.state === "recovery") {
      if (this._placementEnabled) {
        this._options.onNavigationModeChanged("executingGoal");
      }
      return "Recovery";
    }
    return "Idle";
  }

  private _handleGoalConfirmed(position: vec3, rotation: quat): void {
    print(
      `NavigationController: goal confirmed at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`,
    );
    this._options.pathRenderer?.clear();
    this._options.placementController?.showExecuting();
    this._options.onNavigationModeChanged("executingGoal");

    if (this._options.canSendNavGoal()) {
      this._options.bridgeClient?.sendNavGoal(position, rotation);
      return;
    }

    print(
      "NavigationController: executing locally without sending nav_goal",
    );
  }

  private _handleGoalCancelled(): void {
    print("NavigationController: goal cancelled");
    this.requestCancelGoal();
  }
}
