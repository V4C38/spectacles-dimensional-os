import type { ARModuleSession, ARModuleSessionState } from "../websocket/arModuleSession";
import { LIDAR_PRESETS, lidarModeFromSettings, nextLidarMode, requestLidarSettings, type LidarDisplayMode } from "./lidarSettings";
import { normalizeLidarPreferences, obstacleLidarSettings, type LidarDisplayPreferences } from "./lidarDisplayPreferences";
export interface LidarPreferenceStore { read(): Partial<LidarDisplayPreferences> | null; write(preferences: LidarDisplayPreferences): void; }
/** Settings policy is portable. Persistence and the point-cloud renderer are host adapters. */
export class LidarDisplayController {
  mode: LidarDisplayMode = "off";
  readonly preferences: LidarDisplayPreferences;
  private lastState: ARModuleSessionState["state"] = null;
  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText">, private readonly store?: LidarPreferenceStore, private readonly bodyHalo = true) {
    this.preferences = normalizeLidarPreferences(store?.read() ?? null);
  }
  observe(view: ARModuleSessionState): void {
    if (!view.state?.lidar || this.lastState === view.state) return;
    this.lastState = view.state; this.mode = lidarModeFromSettings(view.state.lidar);
    if (this.mode === "full") this.preferences.fullRangeM = view.state.lidar.max_range_m;
    if (this.mode === "obstacles" && this.bodyHalo) this.preferences.obstacleRangeM = Math.round(Math.max(0.1, Math.min(2, view.state.lidar.max_range_m - obstacleLidarSettings(view.hello?.robot.body_bounds_m, 0).max_range_m)) * 10) / 10;
    this.persist();
  }
  setMode(mode: LidarDisplayMode): void {
    if (this.session.view().connection !== "ready" || this.session.view().capabilities?.lidar.available !== true) return;
    const settings = mode === "obstacles" && this.bodyHalo ? obstacleLidarSettings(this.session.view().hello?.robot.body_bounds_m, this.preferences.obstacleRangeM)
      : mode === "full" ? { ...LIDAR_PRESETS.full, max_range_m: this.preferences.fullRangeM } : LIDAR_PRESETS[mode];
    requestLidarSettings(this.session, settings); this.mode = mode;
  }
  cycle(): LidarDisplayMode { this.setMode(nextLidarMode(this.mode)); return this.mode; }
  adjustRange(direction: number): void {
    if (this.mode === "off") return;
    const key = this.mode === "obstacles" ? "obstacleRangeM" : "fullRangeM", step = this.mode === "obstacles" ? 0.1 : 0.5;
    this.preferences[key] = Math.round(Math.max(step, Math.min(this.mode === "obstacles" ? 2 : 10, this.preferences[key] + direction * step)) * 10) / 10;
    this.persist(); this.setMode(this.mode);
  }
  adjustPoints(direction: number): void {
    if (this.mode === "off") return;
    this.preferences.pointLimit = Math.max(250, Math.min(4000, this.preferences.pointLimit + direction * 250)); this.persist();
  }
  private persist(): void { this.store?.write({ ...this.preferences }); }
}
