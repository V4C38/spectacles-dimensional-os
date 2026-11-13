import { LIDAR_FULL_HEIGHT_RANGE_M } from "./LidarRendering";
import { encodeLidarSettingsRequest } from "../websocket/protocol";
import { requireCapability, type ARModuleSession, type ARModuleSessionState } from "../websocket/ARModuleSession";
import type { LidarSettings, Vec3 } from "../ClientContracts";

export type LidarDisplayMode = "off" | "obstacles" | "full";

export const LIDAR_PRESETS: Readonly<Record<LidarDisplayMode, Readonly<LidarSettings>>> = {
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
    min_height_m: LIDAR_FULL_HEIGHT_RANGE_M.min,
    max_height_m: LIDAR_FULL_HEIGHT_RANGE_M.max,
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

export function lidarModeFromSettings(settings: LidarSettings | null | undefined, obstacles = LIDAR_PRESETS.obstacles): LidarDisplayMode {
  if (!settings?.enabled) {
    return "off";
  }
  const full = LIDAR_PRESETS.full;
  if (
    settings.min_height_m === full.min_height_m
    && settings.max_height_m === full.max_height_m
  ) {
    return "full";
  }
  if (
    settings.min_height_m === obstacles.min_height_m
    && settings.max_height_m === obstacles.max_height_m
  ) {
    return "obstacles";
  }
  return obstacles === LIDAR_PRESETS.obstacles ? "off" : lidarModeFromSettings(settings);
}

export function requestLidarSettings(session: Pick<ARModuleSession, "view" | "sendText">, settings: LidarSettings): void {
  requireCapability(session, "lidar");
  session.sendText(encodeLidarSettingsRequest(settings));
}

export const OBSTACLE_HALO_M = 0.6;
export type LidarDisplayPreferences = { pointLimit: number; obstacleRangeM: number; fullRangeM: number };
export const DEFAULT_LIDAR_PREFERENCES: Readonly<LidarDisplayPreferences> = { pointLimit: 4000, obstacleRangeM: 0.6, fullRangeM: 5 };
export function normalizeLidarPreferences(value: Partial<LidarDisplayPreferences> | null): LidarDisplayPreferences {
  if (!value || !Number.isFinite(value.pointLimit) || !Number.isFinite(value.obstacleRangeM) || !Number.isFinite(value.fullRangeM)) return { ...DEFAULT_LIDAR_PREFERENCES };
  return { pointLimit: Math.round(Math.max(250, Math.min(4000, value.pointLimit!)) / 250) * 250, obstacleRangeM: Math.max(0.1, Math.min(2, value.obstacleRangeM!)), fullRangeM: Math.max(0.5, Math.min(10, value.fullRangeM!)) };
}
/** Server circle contains the body-shaped halo; clearance is measured from body bounds. */
export function obstacleLidarSettings(bounds: Readonly<Vec3> = [0.7, 0.5, 0.55], clearanceM = OBSTACLE_HALO_M): LidarSettings {
  return { ...LIDAR_PRESETS.obstacles, max_range_m: Math.hypot(bounds[0], bounds[1]) / 2 + clearanceM };
}

export interface LidarPreferenceStore {
  read(): Partial<LidarDisplayPreferences> | null;
  write(preferences: LidarDisplayPreferences): void;
}

/** Settings policy is portable. Persistence and the point-cloud renderer are host adapters. */
export class LidarDisplayController {
  private readonly savedPreferences: LidarDisplayPreferences;
  private wizardOffSent = false;
  private postSetupSent = false;

  constructor(
    private readonly session: Pick<ARModuleSession, "view" | "sendText">,
    private readonly store?: LidarPreferenceStore,
    private readonly bodyHalo = true,
    private readonly options: { readonly resetSetupOnDisconnect?: boolean } = {},
  ) {
    this.savedPreferences = normalizeLidarPreferences(store?.read() ?? null);
  }

  get mode(): LidarDisplayMode {
    const view = this.session.view();
    return view.connection === "ready" ? lidarModeFromSettings(view.state?.lidar) : "off";
  }

  get preferences(): Readonly<LidarDisplayPreferences> {
    return { ...this.savedPreferences };
  }

  observe(view: ARModuleSessionState): void {
    if (view.connection !== "ready") {
      if (this.options.resetSetupOnDisconnect) this.resetSetup();
      return;
    }
    if (!view.state?.lidar) return;
    const settings = view.state.lidar;
    const mode = lidarModeFromSettings(settings);
    const previous = { ...this.savedPreferences };
    if (mode === "full") this.savedPreferences.fullRangeM = settings.max_range_m;
    if (mode === "obstacles" && this.bodyHalo) {
      const radius = obstacleLidarSettings(view.hello?.robot.body_bounds_m, 0).max_range_m;
      const clearance = Math.max(0.1, Math.min(2, settings.max_range_m - radius));
      this.savedPreferences.obstacleRangeM = Math.round(clearance * 10) / 10;
    }
    if (previous.fullRangeM !== this.savedPreferences.fullRangeM ||
        previous.obstacleRangeM !== this.savedPreferences.obstacleRangeM) this.persist();
  }

  setMode(mode: LidarDisplayMode): boolean {
    const view = this.session.view();
    if (view.connection !== "ready" || view.capabilities?.lidar.available !== true) return false;
    let settings = LIDAR_PRESETS[mode];
    if (mode === "obstacles" && this.bodyHalo) {
      settings = obstacleLidarSettings(view.hello?.robot.body_bounds_m, this.savedPreferences.obstacleRangeM);
    } else if (mode === "full") {
      settings = { ...LIDAR_PRESETS.full, max_range_m: this.savedPreferences.fullRangeM };
    }
    requestLidarSettings(this.session, settings);
    return true;
  }

  resetSetup(): void {
    this.wizardOffSent = this.postSetupSent = false;
  }

  resetPostSetup(): void {
    this.postSetupSent = false;
  }

  /** Call explicitly from setup flow; observations alone never send a command. */
  syncSetup(completed: boolean): void {
    const view = this.session.view();
    if (view.connection !== "ready" || view.capabilities?.lidar.available !== true) return;
    if (completed ? this.postSetupSent : this.wizardOffSent) return;
    try {
      if (!completed) {
        requestLidarSettings(this.session, LIDAR_PRESETS.off);
        this.wizardOffSent = true;
      } else if (this.setMode("obstacles")) {
        this.postSetupSent = true;
      }
    } catch {
      // A failed request remains eligible for the next setup refresh.
    }
  }

  cycle(): LidarDisplayMode {
    this.setMode(nextLidarMode(this.mode));
    return this.mode;
  }

  adjustRange(direction: number): void {
    const mode = this.mode;
    if (mode === "off") return;
    const key = mode === "obstacles" ? "obstacleRangeM" : "fullRangeM";
    const step = mode === "obstacles" ? 0.1 : 0.5;
    const limit = mode === "obstacles" ? 2 : 10;
    const value = Math.max(step, Math.min(limit, this.savedPreferences[key] + direction * step));
    this.savedPreferences[key] = Math.round(value * 10) / 10;
    this.persist();
    this.setMode(mode);
  }

  adjustPoints(direction: number): void {
    if (this.mode === "off") return;
    const points = this.savedPreferences.pointLimit + direction * 250;
    this.savedPreferences.pointLimit = Math.max(250, Math.min(4000, points));
    this.persist();
  }

  private persist(): void {
    this.store?.write({ ...this.savedPreferences });
  }
}
