import type { Quat, Vec3 } from "../websocket/protocolTypes";

// Turbo-style height spectrum, low purple/blue through cyan/green to high orange/red.
const HEIGHT_STOPS: Vec3[] = [[50, 45, 140], [70, 107, 227], [27, 207, 212], [160, 252, 60], [249, 201, 50], [244, 99, 21], [220, 35, 20]];
export function lidarHeightColor(t: number): Vec3 {
  const index = Math.max(0, Math.min(1, t)) * (HEIGHT_STOPS.length - 1);
  const a = HEIGHT_STOPS[Math.floor(index)], b = HEIGHT_STOPS[Math.min(HEIGHT_STOPS.length - 1, Math.floor(index) + 1)];
  const mix = index - Math.floor(index);
  return a.map((value, axis) => (value + (b[axis] - value) * mix) / 255) as Vec3;
}

/** Near obstacles are red, fading to white at the configured ground-plane distance from the robot pose. */
export function lidarObstacleIntensity(point: Vec3, robot: Vec3, rangeM: number, odomScaleCorrectionFactor = 1): number {
  const scale = requireScale(odomScaleCorrectionFactor);
  return Math.max(0, Math.min(1, Math.hypot(point[0] - robot[0], point[1] - robot[1]) / scale / Math.max(0.001, rangeM)));
}

/** Native sensor metres from a physical body box, undoing only the wire XY heuristic. */
export function lidarBodyClearance(point: Vec3, robot: Vec3, orientation: Quat, bounds: Vec3, odomScaleCorrectionFactor = 1): number {
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
