import { encodeLidarSettingsRequest } from "../websocket/protocol";
import { requireCapability, type ARModuleSession } from "../websocket/arModuleSession";
import type { LidarSettings } from "../websocket/protocolTypes";

export type LidarDisplayMode = "off" | "obstacles" | "full";

export const LIDAR_MODE_LABELS: Record<LidarDisplayMode, string> = {
  off: "LiDAR: Off",
  obstacles: "LiDAR: Obstacles",
  full: "LiDAR: Full",
};

export const LIDAR_PRESETS: Record<LidarDisplayMode, LidarSettings> = {
  off: {
    enabled: false,
    min_height_m: 0,
    max_height_m: 0,
    max_range_m: 0,
  },
  obstacles: {
    enabled: true,
    min_height_m: 0.1,
    max_height_m: 0.8,
    max_range_m: 0.5,
  },
  full: {
    enabled: true,
    min_height_m: 0.1,
    max_height_m: 2.0,
    max_range_m: 5.0,
  },
};

export function nextLidarMode(mode: LidarDisplayMode): LidarDisplayMode {
  if (mode === "off") {
    return "obstacles";
  }
  if (mode === "obstacles") {
    return "full";
  }
  return "off";
}

export function lidarModeFromSettings(settings: LidarSettings | null | undefined): LidarDisplayMode {
  if (!settings?.enabled) {
    return "off";
  }
  const full = LIDAR_PRESETS.full;
  if (
    settings.min_height_m === full.min_height_m
    && settings.max_height_m === full.max_height_m
    && settings.max_range_m === full.max_range_m
  ) {
    return "full";
  }
  const obstacles = LIDAR_PRESETS.obstacles;
  if (
    settings.min_height_m === obstacles.min_height_m
    && settings.max_height_m === obstacles.max_height_m
    && settings.max_range_m === obstacles.max_range_m
  ) {
    return "obstacles";
  }
  return "off";
}

export function requestLidarSettings(session: ARModuleSession, settings: LidarSettings): void {
  requireCapability(session, "lidar");
  session.sendText(encodeLidarSettingsRequest(settings));
}
