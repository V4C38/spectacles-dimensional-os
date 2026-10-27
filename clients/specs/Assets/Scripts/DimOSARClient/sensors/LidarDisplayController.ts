import type { ARModuleSession, ARModuleSessionState } from "../websocket/arModuleSession";
import { LIDAR_PRESETS, lidarModeFromSettings, nextLidarMode, requestLidarSettings, type LidarDisplayMode } from "./lidarSettings";
import { normalizeLidarPreferences, obstacleLidarSettings, type LidarDisplayPreferences } from "./lidarDisplayPreferences";
export interface LidarPreferenceStore { read(): Partial<LidarDisplayPreferences> | null; write(preferences: LidarDisplayPreferences): void; }
/** Settings policy is portable. Persistence and the point-cloud renderer are host adapters. */
export class LidarDisplayController {
  private readonly savedPreferences: LidarDisplayPreferences;
  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText">, private readonly store?: LidarPreferenceStore, private readonly bodyHalo = true) {
    this.savedPreferences = normalizeLidarPreferences(store?.read() ?? null);
  }
  get mode(): LidarDisplayMode {
    const view = this.session.view();
    return view.connection === "ready" ? lidarModeFromSettings(view.state?.lidar) : "off";
  }
  get preferences(): Readonly<LidarDisplayPreferences> { return { ...this.savedPreferences }; }
  observe(view: ARModuleSessionState): void {
    if (view.connection !== "ready" || !view.state?.lidar) return;
    const settings = view.state.lidar;
    const mode = lidarModeFromSettings(settings);
    const previous = { ...this.savedPreferences };
    if (mode === "full") this.savedPreferences.fullRangeM = settings.max_range_m;
    if (mode === "obstacles" && this.bodyHalo) {
      const radius = obstacleLidarSettings(view.hello?.robot.body_bounds_m, 0).max_range_m;
      this.savedPreferences.obstacleRangeM = Math.round(Math.max(0.1, Math.min(2, settings.max_range_m - radius)) * 10) / 10;
    }
    if (previous.fullRangeM !== this.savedPreferences.fullRangeM || previous.obstacleRangeM !== this.savedPreferences.obstacleRangeM) this.persist();
  }
  setMode(mode: LidarDisplayMode): void {
    if (this.session.view().connection !== "ready" || this.session.view().capabilities?.lidar.available !== true) return;
    const settings = mode === "obstacles" && this.bodyHalo ? obstacleLidarSettings(this.session.view().hello?.robot.body_bounds_m, this.savedPreferences.obstacleRangeM)
      : mode === "full" ? { ...LIDAR_PRESETS.full, max_range_m: this.savedPreferences.fullRangeM } : LIDAR_PRESETS[mode];
    requestLidarSettings(this.session, settings);
  }
  cycle(): LidarDisplayMode { this.setMode(nextLidarMode(this.mode)); return this.mode; }
  adjustRange(direction: number): void {
    if (this.mode === "off") return;
    const key = this.mode === "obstacles" ? "obstacleRangeM" : "fullRangeM", step = this.mode === "obstacles" ? 0.1 : 0.5;
    this.savedPreferences[key] = Math.round(Math.max(step, Math.min(this.mode === "obstacles" ? 2 : 10, this.savedPreferences[key] + direction * step)) * 10) / 10;
    this.persist(); this.setMode(this.mode);
  }
  adjustPoints(direction: number): void {
    if (this.mode === "off") return;
    this.savedPreferences.pointLimit = Math.max(250, Math.min(4000, this.savedPreferences.pointLimit + direction * 250)); this.persist();
  }
  private persist(): void { this.store?.write({ ...this.savedPreferences }); }
}
