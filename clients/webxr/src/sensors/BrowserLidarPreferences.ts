import { normalizeLidarPreferences, type LidarDisplayPreferences } from "@dimos-ar-client/sensors/LidarDisplay";
const KEY = "dimos-ar-lidar-preferences-v1";
export function readLidarPreferences(): LidarDisplayPreferences {
  try { return normalizeLidarPreferences(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return normalizeLidarPreferences(null); }
}
export function saveLidarPreferences(value: LidarDisplayPreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
