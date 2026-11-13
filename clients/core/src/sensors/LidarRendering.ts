import type { Quat, Vec3 } from "../ClientContracts";

export const LIDAR_FULL_HEIGHT_RANGE_M = { min: 0.1, max: 2 } as const;

// Turbo-style height spectrum, low purple/blue through cyan/green to high orange/red.
const HEIGHT_STOPS: Vec3[] = [[50, 45, 140], [70, 107, 227], [27, 207, 212], [160, 252, 60], [249, 201, 50], [244, 99, 21], [220, 35, 20]];
export function lidarHeightColor(t: number): Vec3 {
  const index = Math.max(0, Math.min(1, t)) * (HEIGHT_STOPS.length - 1);
  const a = HEIGHT_STOPS[Math.floor(index)], b = HEIGHT_STOPS[Math.min(HEIGHT_STOPS.length - 1, Math.floor(index) + 1)];
  const mix = index - Math.floor(index);
  return a.map((value, axis) => (value + (b[axis] - value) * mix) / 255) as Vec3;
}

/** Native sensor metres from a physical body box, undoing only the wire XY heuristic. */
export function lidarBodyClearance(point: Readonly<Vec3>, robot: Readonly<Vec3>, orientation: Readonly<Quat>, bounds: Readonly<Vec3>, odomScaleCorrectionFactor = 1): number {
  const scale = requireScale(odomScaleCorrectionFactor);
  const [qx, qy, qz, qw] = orientation;
  const yaw = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
  const dx = (point[0] - robot[0]) / scale, dy = (point[1] - robot[1]) / scale;
  const x = dx * Math.cos(yaw) + dy * Math.sin(yaw);
  const y = -dx * Math.sin(yaw) + dy * Math.cos(yaw);
  return Math.hypot(Math.max(0, Math.abs(x) - bounds[0] / 2), Math.max(0, Math.abs(y) - bounds[1] / 2));
}

function requireScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("odometry scale must be finite and positive");
  return scale;
}

export interface LidarFrameInput<Origin> {
  points: readonly Readonly<Vec3>[];
  origin: Origin;
  mode: "full" | "obstacles";
  robot?: Readonly<Vec3> | null;
  baseHeightM?: number;
  orientation?: Readonly<Quat>;
  bounds?: Readonly<Vec3>;
  pointLimit?: number;
  obstacleRangeM?: number;
  odomScaleCorrectionFactor?: number;
}
export type LidarPointColor = readonly [number, number, number, number];
const HEIGHT_PALETTE = Array.from({ length: 256 }, (_, i) => lidarHeightColor(i / 255));

/** One instance per renderer owns sampling and invalidation; host units and GPU uploads stay outside Core. */
export class LidarFrameSampler<Origin> {
  private source: LidarFrameInput<Origin>["points"] | null = null;
  private origin: Origin | null = null;
  private limit = -1;
  private style: readonly number[] = [];
  private positions: Vec3[] = [];
  private colors: LidarPointColor[] = [];
  private indices: number[] = [];
  constructor(private readonly project: (point: Readonly<Vec3>, origin: Origin) => Vec3,
    private readonly limits: { maximum: number; minimum: number; default: number }) {}

  sample(input: LidarFrameInput<Origin>) {
    const limit = Math.max(this.limits.minimum, Math.min(this.limits.maximum,
      Math.floor(input.pointLimit ?? this.limits.default)));
    const positionsChanged = input.points !== this.source || input.origin !== this.origin || limit !== this.limit;
    const count = Math.min(input.points.length, limit);
    if (positionsChanged) {
      this.indices = Array.from({ length: count }, (_, i) => Math.floor(i * input.points.length / count));
      this.positions = this.indices.map(index => this.project(input.points[index], input.origin));
    }
    const floor = input.robot ? input.robot[2] - (input.baseHeightM ?? 0) : 0;
    const orientation = input.orientation ?? [0, 0, 0, 1];
    const bounds = input.bounds ?? [0.7, 0.5, 0.55];
    const clearance = input.obstacleRangeM ?? 0.6;
    const factor = input.odomScaleCorrectionFactor ?? 1;
    const style = input.mode === "full" ? [0, floor] : [1, clearance, factor,
      ...(input.robot ?? []), ...orientation, ...bounds];
    const colorsChanged = positionsChanged || style.length !== this.style.length ||
      style.some((value, i) => !Object.is(value, this.style[i]));
    if (colorsChanged) {
      this.colors = this.indices.map(index => {
        const point = input.points[index];
        if (input.mode === "obstacles") {
          const t = input.robot ? Math.min(1,
            lidarBodyClearance(point, input.robot, orientation as Readonly<Quat>, bounds as Readonly<Vec3>, factor) / Math.max(0.001, clearance)) : 1;
          return [1, 0, 0, 1 - t * t * (3 - 2 * t)];
        }
        const height = LIDAR_FULL_HEIGHT_RANGE_M;
        const t = Math.max(0, Math.min(1, (point[2] - floor - height.min) / (height.max - height.min)));
        return [...HEIGHT_PALETTE[Math.round(t * 255)], 1];
      });
    }
    this.source = input.points;
    this.origin = input.origin;
    this.limit = limit;
    this.style = style;
    return { positions: this.positions as readonly Vec3[], colors: this.colors as readonly LidarPointColor[],
      sourceIndices: this.indices as readonly number[], positionsChanged, colorsChanged };
  }
  clear(): void { this.source = null; this.origin = null; this.limit = -1; this.style = []; }
}
