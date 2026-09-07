import { PointCloudRenderer } from "./PointCloudRenderer";
import { LidarDisplayMode, RobotRuntimeState } from "../AppState";
import {
  lidarVerticalBandCm,
  robotFloorWorldYCm,
} from "../Robot/RobotRuntimeModel";
import { DEFAULT_LIDAR_OBSTACLE_SETTINGS } from "../../ARBridge/Network/Protocol";

export interface LidarRenderContext {
  mode: LidarDisplayMode;
  active: boolean;
  connected: boolean;
  anchor: vec3 | null;
  runtime: RobotRuntimeState;
}

/** Owns LiDAR presentation: packet-driven mesh builds and mode lifecycle. */
export class LidarPresenter {
  private _lastRxTime = 0;
  private _lastMode: LidarDisplayMode = "off";

  constructor(private readonly _renderer: PointCloudRenderer | null) {}

  /** Render one incoming LiDAR packet immediately; sole live mesh-build trigger. */
  public onLidarReceived(
    points: [number, number, number][],
    ctx: LidarRenderContext,
  ): void {
    if (!ctx.active || ctx.mode === "off" || !ctx.connected) {
      return;
    }
    this._lastRxTime = getTime();
    this._lastMode = ctx.mode;
    this._applyFilterGeometry(ctx);
    this._renderer?.setFullLidarVisible(ctx.mode === "full");
    this._renderer?.renderPointCloud(points, ctx.mode);
  }

  /** Mode/off/phase changes: clear inactive layers; never rebuild stale packets. */
  public onPresentationStateChanged(ctx: LidarRenderContext): void {
    if (!ctx.active || ctx.mode === "off") {
      this.clearBuffer();
      this._renderer?.clearAll();
      this._lastMode = ctx.mode;
      return;
    }

    const modeChanged = ctx.mode !== this._lastMode;
    if (modeChanged) {
      this._clearInactiveLayer(ctx.mode);
      this._lastMode = ctx.mode;
    }

    this._renderer?.setFullLidarVisible(ctx.mode === "full");

    if (!ctx.connected) {
      const anchor = ctx.anchor ?? vec3.zero();
      this._applyFilterGeometry(ctx);
      this._renderer?.renderMockLidar(anchor, ctx.mode);
      return;
    }

    if (modeChanged) {
      this._applyFilterGeometry(ctx);
    }
  }

  public clearBuffer(): void {
    this._lastRxTime = 0;
  }

  /** Frame pump: stale clear only. */
  public tickFrame(
    active: boolean,
    mode: LidarDisplayMode,
    connected: boolean,
    staleClearS: number,
  ): void {
    if (
      active &&
      mode !== "off" &&
      connected &&
      this._lastRxTime > 0 &&
      getTime() - this._lastRxTime >= staleClearS
    ) {
      this.clearBuffer();
      this._renderer?.clearAll();
    }
  }

  private _clearInactiveLayer(mode: LidarDisplayMode): void {
    if (mode === "full") {
      this._renderer?.clearObstacleLidar();
      return;
    }
    this._renderer?.clearFullLidar();
  }

  private _applyFilterGeometry(ctx: LidarRenderContext): void {
    if (ctx.anchor) {
      this._renderer?.setRobotWorldPosition(ctx.anchor);
      this._renderer?.setRobotFloorWorldY(
        robotFloorWorldYCm(ctx.anchor.y, ctx.runtime),
      );
    }
    const band = lidarVerticalBandCm(ctx.runtime);
    this._renderer?.setLidarVerticalBand(band.minAboveFloorCm, band.maxAboveFloorCm);
    this._renderer?.setObstacleDistanceBand(
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.minDistanceM * 100.0,
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.opaqueDistanceM * 100.0,
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.maxDistanceM * 100.0,
    );
  }
}
