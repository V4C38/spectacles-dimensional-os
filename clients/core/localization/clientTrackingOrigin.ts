import type { LocalizationResult, Quat, Vec3 } from "../websocket/protocolTypes";

/** `T_odom_client` — this client's tracking origin in `odom`. */
export interface ClientTrackingOrigin {
  position: Vec3;
  orientation: Quat;
  confidence: number;
  ts: number;
}

export class ClientTrackingOriginStore {
  private current: ClientTrackingOrigin | null = null;

  setFromLocalizationResult(result: LocalizationResult): ClientTrackingOrigin {
    const position = requireVec3(result.position, "position");
    const orientation = requireQuat(result.orientation);
    const confidence = result.confidence;
    const ts = result.ts;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error("Field 'confidence' must be in [0, 1]");
    }
    if (!Number.isFinite(ts)) {
      throw new Error("Field 'ts' must be finite");
    }
    this.current = {
      position: [position[0], position[1], position[2]],
      orientation: [orientation[0], orientation[1], orientation[2], orientation[3]],
      confidence,
      ts,
    };
    return this.current;
  }

  clear(): void {
    this.current = null;
  }

  get T_odom_client(): ClientTrackingOrigin | null {
    return this.current;
  }

  get hasTrackingOrigin(): boolean {
    return this.current !== null;
  }
}

function requireVec3(value: Vec3, key: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`Field '${key}' must be a 3-element array`);
  }
  return [
    requireFinite(value[0], `${key}[0]`),
    requireFinite(value[1], `${key}[1]`),
    requireFinite(value[2], `${key}[2]`),
  ];
}

function requireQuat(value: Quat): Quat {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("orientation must be a 4-element quaternion [qx, qy, qz, qw]");
  }
  const orientation: Quat = [
    requireFinite(value[0], "orientation[0]"),
    requireFinite(value[1], "orientation[1]"),
    requireFinite(value[2], "orientation[2]"),
    requireFinite(value[3], "orientation[3]"),
  ];
  if (Math.hypot(orientation[0], orientation[1], orientation[2], orientation[3]) < 1e-6) {
    throw new Error("orientation must be a non-zero quaternion");
  }
  return orientation;
}

function requireFinite(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Field '${key}' must be finite`);
  }
  return value;
}
