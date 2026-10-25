import { LIDAR_PRESETS } from "./lidarSettings";
import type { LidarSettings, Vec3 } from "../websocket/protocolTypes";

export const OBSTACLE_HALO_M = 0.6;
export type LidarDisplayPreferences = { pointLimit: number; obstacleRangeM: number; fullRangeM: number };
export const DEFAULT_LIDAR_PREFERENCES: LidarDisplayPreferences = { pointLimit: 4000, obstacleRangeM: 0.6, fullRangeM: 5 };
export function normalizeLidarPreferences(value: Partial<LidarDisplayPreferences> | null): LidarDisplayPreferences {
  if (!value || !Number.isFinite(value.pointLimit) || !Number.isFinite(value.obstacleRangeM) || !Number.isFinite(value.fullRangeM)) return { ...DEFAULT_LIDAR_PREFERENCES };
  return { pointLimit: Math.round(Math.max(250, Math.min(4000, value.pointLimit!)) / 250) * 250, obstacleRangeM: Math.max(0.1, Math.min(2, value.obstacleRangeM!)), fullRangeM: Math.max(0.5, Math.min(10, value.fullRangeM!)) };
}
/** Server circle contains the body-shaped halo; clearance is measured from body bounds. */
export function obstacleLidarSettings(bounds: Vec3 = [0.7, 0.5, 0.55], clearanceM = OBSTACLE_HALO_M): LidarSettings {
  return { ...LIDAR_PRESETS.obstacles, max_range_m: Math.hypot(bounds[0], bounds[1]) / 2 + clearanceM };
}
