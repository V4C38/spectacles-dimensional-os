import { PointCloudRenderer } from "./PointCloudRenderer";
import { LidarDisplayMode, RobotRuntimeState } from "../Core/AppState";
import {
  lidarVerticalBandCm,
  robotFloorWorldYCm,
} from "../Robot/RobotRuntimeModel";
import { DEFAULT_LIDAR_OBSTACLE_SETTINGS } from "../Bridge/Protocol";

export interface LidarPresentationInput {
  mode: LidarDisplayMode;
  active: boolean;
  connected: boolean;
  points: [number, number, number][] | null;
  anchor: vec3 | null;
  runtime: RobotRuntimeState;
}

/** Owns LiDAR point buffer and point-cloud presentation (live, mock, off). */
export class LidarPresentationController {
  private _lastPoints: [number, number, number][] | null = null;
  private _lastRxTime = 0;
  private _meshDirty = false;

  constructor(private readonly _renderer: PointCloudRenderer | null) {}

  public onLidarReceived(points: [number, number, number][]): void {
    this._lastPoints = points;
    this._lastRxTime = getTime();
    this._meshDirty = true;
  }

  public clearBuffer(): void {
    this._lastPoints = null;
    this._lastRxTime = 0;
    this._meshDirty = false;
  }

  public get lastPoints(): [number, number, number][] | null {
    return this._lastPoints;
  }

  public markMeshDirty(): void {
    this._meshDirty = true;
  }

  /** Frame pump: stale clear + render when dirty. Returns true if stale clear ran. */
  public tickFrame(
    active: boolean,
    mode: LidarDisplayMode,
    connected: boolean,
    staleClearS: number,
  ): void {
    if (
      !this._meshDirty &&
      active &&
      mode !== "off" &&
      connected &&
      this._lastPoints !== null &&
      this._lastRxTime > 0 &&
      getTime() - this._lastRxTime >= staleClearS
    ) {
      this.clearBuffer();
      this._renderer?.clearAll();
      return;
    }
    if (
      !this._meshDirty ||
      !active ||
      mode === "off" ||
      !this._lastPoints
    ) {
      return;
    }
    this._meshDirty = false;
    this._renderer?.renderPointCloud(this._lastPoints);
  }

  public apply(input: LidarPresentationInput): void {
    if (!input.active || input.mode === "off") {
      this.clearBuffer();
      this._renderer?.clearAll();
      return;
    }

    const mode = input.mode;
    this._renderer?.setFullLidarVisible(mode === "full");

    if (input.connected) {
      if (mode !== "full") {
        this._renderer?.clearFullLidar();
      }
      if (input.anchor) {
        this._applyAnchorGeometry(input.anchor, input.runtime);
      }
      if (this._lastPoints) {
        this._renderer?.renderPointCloud(this._lastPoints);
        this._meshDirty = false;
      } else {
        this._renderer?.clearAll();
        this._renderer?.setFullLidarVisible(mode === "full");
      }
      return;
    }

    const anchor = input.anchor ?? vec3.zero();
    this._applyAnchorGeometry(anchor, input.runtime);
    this._renderer?.renderMockLidar(anchor);
  }

  private _applyAnchorGeometry(position: vec3, runtime: RobotRuntimeState): void {
    this._renderer?.setRobotWorldPosition(position);
    this._renderer?.setRobotFloorWorldY(robotFloorWorldYCm(position.y, runtime));
    const band = lidarVerticalBandCm(runtime);
    this._renderer?.setLidarVerticalBand(band.minAboveFloorCm, band.maxAboveFloorCm);
    this._renderer?.setObstacleDistanceBand(
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.minDistanceM * 100.0,
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.opaqueDistanceM * 100.0,
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.maxDistanceM * 100.0,
    );
  }
}
