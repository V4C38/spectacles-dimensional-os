import type { Vec3 } from "../websocket/protocolTypes";

// Turbo-style height spectrum, low purple/blue through cyan/green to high orange/red.
const HEIGHT_STOPS: Vec3[] = [[50, 45, 140], [70, 107, 227], [27, 207, 212], [160, 252, 60], [249, 201, 50], [244, 99, 21], [220, 35, 20]];
export function lidarHeightColor(t: number): Vec3 {
  const index = Math.max(0, Math.min(1, t)) * (HEIGHT_STOPS.length - 1);
  const a = HEIGHT_STOPS[Math.floor(index)], b = HEIGHT_STOPS[Math.min(HEIGHT_STOPS.length - 1, Math.floor(index) + 1)];
  const mix = index - Math.floor(index);
  return a.map((value, axis) => (value + (b[axis] - value) * mix) / 255) as Vec3;
}

/** Near obstacles are red, fading to white at the configured ground-plane distance from the robot pose. */
export function lidarObstacleIntensity(point: Vec3, robot: Vec3, rangeM: number): number {
  return Math.max(0, Math.min(1, Math.hypot(point[0] - robot[0], point[1] - robot[1]) / Math.max(0.001, rangeM)));
}
