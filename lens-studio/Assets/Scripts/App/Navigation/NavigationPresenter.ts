// ================================================================
/** Owns nav marker prefab lifecycle, path mesh display, and placement/marker presentation sync. */
// ================================================================

import { AppStateData } from "../AppState";
import { RobotMarker } from "../Robot/RobotMarker";
import { robotFloorWorldYCm } from "../Robot/RobotRuntimeModel";
import { NavigationTargetMarker } from "./NavigationTargetMarker";
import { NavigationPathRenderer } from "./NavigationPathRenderer";
import { SurfacePlacementController } from "./SurfacePlacementController";
import {
  buildNavViewContext,
  deriveMarkerPresentation,
  deriveNavDisplayPhase,
  derivePathPresentation,
  derivePlacementInteractionPolicy,
  type NavEngineState,
  type NavGoalConfig,
  type NavigationEffect,
} from "../../ARBridge/Navigation/NavigationModel";

export type NavigationPresenterDeps = {
  script: BaseScriptComponent;
  navigationMarkerPrefab: ObjectPrefab;
  pathRenderer: NavigationPathRenderer;
  placement: SurfacePlacementController;
  getEngine: () => NavEngineState;
  getAppState: () => AppStateData;
  robotMarker: RobotMarker | null;
  getPreviewTarget: () => { position: vec3; rotation: quat } | null;
  getCancelAvailable: () => boolean;
  canConfirmGoal: () => boolean;
  shouldCancelOnConfirm: () => boolean;
  onRequestCancelGoal: () => void;
  onOutcomeAnimationFinished: () => void;
};

/** Scene presentation for navigation marker, path, and placement interaction. */
export class NavigationPresenter {
  private _marker: NavigationTargetMarker | null = null;
  private _outcomeAnimating = false;
  private _bridgePath: vec3[] | null = null;
  private _previewBasePath: vec3[] | null = null;

  constructor(private readonly _deps: NavigationPresenterDeps) {}

  public hasMarker(): boolean {
    return this._marker !== null;
  }

  public isOutcomeAnimating(): boolean {
    return this._outcomeAnimating;
  }

  public getMarkerWorldY(): number | null {
    return this._marker?.worldPosition.y ?? null;
  }

  public getRobotFloorY(
    sourceY: number | null = this._deps.robotMarker?.getWorldPosition()?.y ?? null,
  ): number | null {
    if (sourceY === null) {
      return null;
    }
    return robotFloorWorldYCm(sourceY, this._deps.getAppState().robotRuntime);
  }

  public createDragMarker(): NavigationTargetMarker {
    const marker = this._spawnMarker();
    marker.setDragEnabled(true);
    return marker;
  }

  public destroyMarker(): void {
    this._destroyMarker();
  }

  public clearPathDisplay(): void {
    this._bridgePath = null;
    this._previewBasePath = null;
    this._deps.pathRenderer?.clear();
  }

  public clearPreviewPath(): void {
    this._previewBasePath = null;
  }

  public clearPathRenderer(): void {
    this._deps.pathRenderer?.clear();
  }

  public setPreviewPath(waypoints: vec3[] | null): void {
    this._updatePathHeightRange();
    this._previewBasePath = waypoints;
  }

  public setBridgePath(waypoints: vec3[] | null): void {
    this._updatePathHeightRange();
    this._bridgePath = waypoints;
  }

  public sync(): void {
    const engine = this._deps.getEngine();
    const config = engine.activeConfig;
    if (!config || this._outcomeAnimating) {
      return;
    }
    if (!this._marker && !config.allowDrag) {
      return;
    }
    const ctx = buildNavViewContext(engine, {
      placementActive: this._deps.placement.isPlacementActive(),
      markerExists: this._marker !== null,
      outcomeAnimating: this._outcomeAnimating,
    });
    if (!ctx) {
      return;
    }

    const { kind, preset } = deriveMarkerPresentation(ctx);
    const placementActive = this._deps.placement.isPlacementActive();
    const phase = deriveNavDisplayPhase(ctx);
    this._marker?.applyPreset(config, kind, preset, {
      confirmAvailable: this._deps.canConfirmGoal(),
      cancelAvailable: this._deps.getCancelAvailable(),
      showConfirmInPreview: placementActive && config.mode === "single",
      showCancelInPreview: phase === "preview" && config.mode === "continuous",
    });
    this._deps.placement.setInteractionPolicy(
      derivePlacementInteractionPolicy(
        engine,
        placementActive,
        this._outcomeAnimating,
      ),
    );

    const { renderPath, style } = derivePathPresentation(ctx);
    if (!renderPath || style === null) {
      this._deps.pathRenderer?.clear();
      return;
    }

    const robotPosition = this._getRobotFloorPosition() ?? null;
    const previewTarget = this._deps.getPreviewTarget();
    const goalPosition =
      this._deps.placement.getRenderedPosition() ??
      previewTarget?.position ??
      this._marker?.worldPosition ??
      null;
    if (!robotPosition || !goalPosition) {
      this._deps.pathRenderer?.clear();
      return;
    }
    this._deps.pathRenderer.setHeightRange(robotPosition.y, goalPosition.y);

    let points: vec3[];
    if (phase === "navigating" && this._bridgePath && this._bridgePath.length >= 2) {
      points = this._bridgePath;
    } else if (this._previewBasePath && this._previewBasePath.length >= 2) {
      points = this._previewBasePath;
    } else {
      points = [robotPosition, goalPosition];
    }
    this._deps.pathRenderer.setLensPath(points, style);
  }

  /** Returns true when a new marker was created. */
  public ensureMarkerForGoal(
    position: vec3,
    rotation: quat,
    config: NavGoalConfig,
  ): boolean {
    if (this._marker) {
      if (!config.allowDrag) {
        this._marker.setPose(position, rotation);
        this._marker.setDragEnabled(false);
        this._bindDisplayOnlyMarkerEvents(this._marker);
      }
      return false;
    }
    const marker = this._spawnMarker();
    marker.setPose(position, rotation);
    marker.setDragEnabled(config.allowDrag);
    if (!config.allowDrag) {
      this._bindDisplayOnlyMarkerEvents(marker);
    }
    if (config.allowDrag && this._deps.getEngine().activeConfig?.allowDrag) {
      this._deps.placement.attach(marker);
    }
    return true;
  }

  public applyVisualEffect(
    effect: NavigationEffect,
    getStartPose: () => { position: vec3; rotation: quat } | null,
  ): boolean {
    switch (effect.kind) {
      case "syncMarkerPresentation":
        this.sync();
        return true;
      case "destroyMarker":
        this.destroyMarker();
        return true;
      case "respawnMarkerAtRobot":
        if (effect.immediate) {
          this._deps.placement.respawnPlacingImmediately(getStartPose);
        } else {
          this._deps.placement.respawnPlacingAt(getStartPose);
        }
        return true;
      case "setPlacementInteraction":
        this._deps.placement.setInteractionPolicy(effect.policy);
        return true;
      case "beginOutcomeAnimation":
        this.beginOutcomeAnimation(effect.label);
        return true;
      case "stopPlacement":
        this._deps.placement.stop();
        this._deps.placement.detach();
        return true;
      default:
        return false;
    }
  }

  public beginOutcomeAnimation(label: "Cancelled" | "Failed"): void {
    const config = this._deps.getEngine().activeConfig;
    if (!config) {
      return;
    }
    this._outcomeAnimating = true;
    this._marker?.showOutcomeReset(config, label, {
      cancelAvailable: this._deps.getCancelAvailable(),
    });
    this._deps.placement.setInteractionPolicy({ dragEnabled: false, followRobot: false });
  }

  private _updatePathHeightRange(): void {
    const robotY = this.getRobotFloorY();
    const goalY = this._marker?.worldPosition.y ?? null;
    if (robotY !== null && goalY !== null) {
      this._deps.pathRenderer.setHeightRange(robotY, goalY);
    }
  }

  private _getRobotFloorPosition(
    position: vec3 | null = this._deps.robotMarker?.getWorldPosition() ?? null,
  ): vec3 | null {
    if (!position) {
      return null;
    }
    const floorY = this.getRobotFloorY(position.y);
    if (floorY === null) {
      return null;
    }
    return new vec3(position.x, floorY, position.z);
  }

  private _bindDisplayOnlyMarkerEvents(marker: NavigationTargetMarker): void {
    marker.bindEvents({
      onConfirmTriggerUp: () => {
        if (this._deps.shouldCancelOnConfirm()) {
          this._deps.onRequestCancelGoal();
        }
      },
      onOutcomeResetComplete: () => {
        this._handleOutcomeResetComplete();
      },
    });
  }

  private _handleOutcomeResetComplete(): void {
    this._outcomeAnimating = false;
    this._deps.onOutcomeAnimationFinished();
  }

  private _spawnMarker(): NavigationTargetMarker {
    this._destroyMarker();
    const root = this._deps.navigationMarkerPrefab.instantiate(
      this._deps.script.getSceneObject(),
    );
    const marker = root.getComponent(
      NavigationTargetMarker.getTypeName(),
    ) as NavigationTargetMarker | null;
    if (!marker) {
      root.destroy();
      throw new Error(
        "NavigationPresenter: prefab is missing NavigationTargetMarker component",
      );
    }
    marker.ensureReady();
    marker.bindEvents({
      onOutcomeResetComplete: () => {
        this._handleOutcomeResetComplete();
      },
    });
    this._marker = marker;
    return marker;
  }

  private _destroyMarker(): void {
    if (!this._marker) {
      return;
    }
    this._marker.destroy();
    this._marker = null;
  }
}
