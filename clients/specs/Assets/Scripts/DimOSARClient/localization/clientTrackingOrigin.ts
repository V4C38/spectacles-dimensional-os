import { normalizeQuat, rotateVecByQuat } from "./clientTrackingTransforms";
import type { LocalizationResult, LocalizationMapTransform, MapAlignment, MapContext, Quat, Vec3 } from "../websocket/protocolTypes";

/** `T_odom_client` — this client's tracking origin in `odom`. */
export interface ClientTrackingOrigin {
  position: Vec3;
  orientation: Quat;
  confidence: number;
  ts: number;
  mapAlignment?: MapAlignment;
  mapTransform?: LocalizationMapTransform;
}

export class ClientTrackingOriginStore {
  private current: ClientTrackingOrigin | null = null;
  private alignment: MapAlignment | null = null;
  private transform: LocalizationMapTransform | null = null;
  private context: MapContext | null = null;
  private trackingReference = "";

  get mapAlignment(): MapAlignment | null { return this.alignment; }
  get mapContext(): MapContext | null { return this.context; }
  beginTrackingReference(reference: string): void {
    if (this.trackingReference && this.trackingReference !== reference) { const context = this.context; this.clear(); this.context = context; }
    this.trackingReference = reference;
  }
  acceptsContext(context: MapContext): boolean {
    return this.context !== null && this.context.map_code === context.map_code && this.context.odom_reference_id === context.odom_reference_id;
  }
  setMapContext(context: MapContext, reset = false): void {
    if (reset || (this.context !== null && !this.acceptsContext(context)) ||
        (this.alignment !== null && (this.alignment.map_code !== context.map_code || this.alignment.odom_reference_id !== context.odom_reference_id))) this.clear();
    this.context = { ...context };
  }
  applyMapTransform(transform: LocalizationMapTransform): void {
    if (!this.acceptsContext(transform) || (this.transform !== null && transform.revision <= this.transform.revision)) return;
    this.transform = { ...transform };
    this.recompose();
  }
  private recompose(): void {
    if (!this.alignment || !this.transform) return;
    const q = normalizeQuat(this.transform.orientation), b = normalizeQuat(this.alignment.orientation);
    const p = rotateVecByQuat(q, this.alignment.position), a = this.transform.position;
    const [x, y, z, w] = q, [bx, by, bz, bw] = b;
    this.current = {
      position: [a[0] + p[0], a[1] + p[1], a[2] + p[2]],
      orientation: normalizeQuat([w * bx + x * bw + y * bz - z * by,
        w * by - x * bz + y * bw + z * bx, w * bz + x * by - y * bx + z * bw,
        w * bw - x * bx - y * by - z * bz]),
      confidence: Math.min(this.alignment.confidence, this.transform.confidence), ts: this.alignment.ts,
      mapAlignment: this.alignment, mapTransform: this.transform,
    };
  }

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
    if (result.map_alignment && result.map_transform) {
      if (!this.acceptsContext(result.map_alignment) || !this.acceptsContext(result.map_transform) ||
          result.map_alignment.tracking_reference_id !== this.trackingReference) throw new Error("Map alignment reference changed");
      this.alignment = result.map_alignment;
      if (!this.transform || result.map_transform.revision > this.transform.revision) this.transform = result.map_transform;
      this.recompose();
      return this.current!;
    }
    this.alignment = null;
    this.transform = null;
    this.current = {
      position: [position[0], position[1], position[2]],
      orientation: [orientation[0], orientation[1], orientation[2], orientation[3]],
      confidence,
      ts,
    };
    return this.current;
  }

  /** Restore a retained estimate without declaring it a newly observed localization result. */
  restore(origin: ClientTrackingOrigin): void {
    if (origin.mapAlignment && origin.mapAlignment.tracking_reference_id !== this.trackingReference) { this.clear(); return; }
    this.alignment = origin.mapAlignment ?? null;
    this.transform = origin.mapTransform ?? null;
    if (this.alignment) this.context = { map_code: this.alignment.map_code, odom_reference_id: this.alignment.odom_reference_id };
    this.current = { ...origin, position: requireVec3(origin.position, "position"), orientation: requireQuat(origin.orientation) };
  }

  clear(): void {
    this.alignment = null;
    this.transform = null;
    this.context = null;
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
