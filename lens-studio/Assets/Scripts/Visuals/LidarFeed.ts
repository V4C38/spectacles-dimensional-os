import { PointCloudRenderer } from "./PointCloudRenderer";
import {
  LidarDisplayMode,
  RobotRuntimeState,
  lidarVerticalBandCm,
  robotFloorWorldYCm,
} from "../AppState";

// ================================================================
/**
 * Manages LiDAR data caching, the deferred mesh-pump tick, and
 * the lidar-preview sync loop extracted from DimosManager.
 */
// ================================================================

export interface LidarFeedContext {
  getIsActive: () => boolean;
  getLidarMode: () => LidarDisplayMode;
  getHasBridgeConnection: () => boolean;
  getRobotRuntime: () => RobotRuntimeState;
  /** World-space position of the robot marker (cm), or null if unavailable. */
  getRobotMarkerPosition: () => vec3 | null;
  /** Last pose position converted to Lens centimeters, or null if no pose received. */
  getLastPosePosition: () => vec3 | null;
}

export class LidarFeed {
  private _lastLidarPoints: [number, number, number][] | null = null;
  private _lidarMeshDirty = false;

  constructor(
    private readonly _renderer: PointCloudRenderer,
    private readonly _ctx: LidarFeedContext,
  ) {}

  /** Call from a bridge onLidar handler. */
  public onLidarMessage(points: [number, number, number][]): void {
    if (this._ctx.getIsActive() && this._ctx.getLidarMode() !== "off") {
      this._lastLidarPoints = points;
      this._lidarMeshDirty = true;
      this._refreshRobotLidarAnchor();
    }
  }

  /** Call every frame from an UpdateEvent bound in DimosManager (deferred mesh pump). */
  public tick(): void {
    if (
      !this._lidarMeshDirty ||
      !this._ctx.getIsActive() ||
      this._ctx.getLidarMode() === "off" ||
      !this._lastLidarPoints
    ) {
      return;
    }
    this._lidarMeshDirty = false;
    this._renderer.renderPointCloud(this._lastLidarPoints);
  }

  /** Update the renderer's robot-anchor position from the latest pose/marker. */
  public refreshRobotLidarAnchor(): void {
    this._refreshRobotLidarAnchor();
  }

  /** Discard cached points (e.g. on disconnect). */
  public clearCachedPoints(): void {
    this._lastLidarPoints = null;
    this._lidarMeshDirty = false;
  }

  /** Visually clear the renderer without discarding cached points (e.g. on deactivate). */
  public clearRenderer(): void {
    this._renderer.clearAll();
  }

  /**
   * Sync the renderer to the current lidar display state.
   *
   * Decision table (logic unchanged from DimosManager._syncLiDARPreview):
   *   inactive              → clearAll
   *   lidarMode off         → clearAll
   *   connected + cached    → render cached points at robot anchor
   *   connected + no cache  → clearAll + set full-lidar visibility
   *   disconnected          → render mock lidar at marker anchor
   */
  public sync(): void {
    if (!this._ctx.getIsActive() || this._ctx.getLidarMode() === "off") {
      this._lastLidarPoints = null;
      this._lidarMeshDirty = false;
      this._renderer.clearAll();
      return;
    }

    const mode = this._ctx.getLidarMode();
    this._renderer.setFullLidarVisible(mode === "full");

    if (this._ctx.getHasBridgeConnection()) {
      if (mode !== "full") {
        this._renderer.clearFullLidar();
      }
      if (this._lastLidarPoints) {
        this._refreshRobotLidarAnchor();
        this._renderer.renderPointCloud(this._lastLidarPoints);
      } else {
        this._renderer.clearAll();
        this._renderer.setFullLidarVisible(mode === "full");
      }
      return;
    }

    const anchor = this._ctx.getRobotMarkerPosition() ?? vec3.zero();
    this._syncRobotLidarAnchor(anchor);
    this._renderer.renderMockLidar(anchor);
  }

  private _refreshRobotLidarAnchor(): void {
    const markerPos = this._ctx.getRobotMarkerPosition();
    if (markerPos) {
      this._syncRobotLidarAnchor(markerPos);
      return;
    }
    const posePos = this._ctx.getLastPosePosition();
    if (posePos) {
      this._syncRobotLidarAnchor(posePos);
    }
  }

  private _syncRobotLidarAnchor(position: vec3): void {
    const runtime = this._ctx.getRobotRuntime();
    this._renderer.setRobotWorldPosition(position);
    this._renderer.setRobotFloorWorldY(robotFloorWorldYCm(position.y, runtime));
    const band = lidarVerticalBandCm(runtime);
    this._renderer.setLidarVerticalBand(band.minAboveFloorCm, band.maxAboveFloorCm);
  }
}
