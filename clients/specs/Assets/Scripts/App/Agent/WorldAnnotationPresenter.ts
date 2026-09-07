import { protocolMetersToLensCentimeters } from "../../ARBridge/Network/Protocol";
import { findText } from "../UI/UIKit";
import { LineRenderer, LineRgb } from "../Utilities/LineRenderer";

export type AnnotationKind = "marker" | "line";

export type Point3 = { x: number; y: number; z: number };

export interface WorldAnnotationArgs {
  id: string;
  kind?: AnnotationKind;
  points?: [number, number, number][];
  label?: string;
  active?: boolean;
  duration_s?: number;
  color?: [number, number, number];
}

export interface WorldAnnotationPresenterDeps {
  eventHost: ScriptComponent;
  parent: SceneObject;
  markerPrefab: ObjectPrefab | null;
}

type AnnotationEntry =
  | { kind: "marker"; root: SceneObject; expiresAt: number | null }
  | { kind: "line"; line: LineRenderer };

const DEFAULT_LINE_COLOR: LineRgb = [1, 1, 0];
const DEFAULT_BEZIER_SAMPLES = 12;
/** Lift as a fraction of start→end horizontal length (slight curvature). */
const BEZIER_LIFT_FRACTION = 0.12;
const BEZIER_MIN_LIFT = 5; // cm
const BEZIER_MAX_LIFT = 40; // cm

export function sampleQuadraticBezier(
  start: Point3,
  end: Point3,
  sampleCount: number = DEFAULT_BEZIER_SAMPLES,
): Point3[] {
  const count = Math.max(2, Math.floor(sampleCount));
  const midX = (start.x + end.x) * 0.5;
  const midY = (start.y + end.y) * 0.5;
  const midZ = (start.z + end.z) * 0.5;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  const lift = Math.min(
    BEZIER_MAX_LIFT,
    Math.max(BEZIER_MIN_LIFT, horizontal * BEZIER_LIFT_FRACTION),
  );
  const control: Point3 = { x: midX, y: midY + lift, z: midZ };

  const points: Point3[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const oneMinus = 1 - t;
    points.push({
      x: oneMinus * oneMinus * start.x + 2 * oneMinus * t * control.x + t * t * end.x,
      y: oneMinus * oneMinus * start.y + 2 * oneMinus * t * control.y + t * t * end.y,
      z: oneMinus * oneMinus * start.z + 2 * oneMinus * t * control.z + t * t * end.z,
    });
  }
  return points;
}

/** When only start/stop are given, sample a slight bezier; otherwise pass points through. */
export function resolveLinePoints(points: Point3[]): Point3[] {
  if (points.length === 2) {
    return sampleQuadraticBezier(points[0], points[1]);
  }
  return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

/** Owns world-anchored marker/line annotations keyed by id. */
export class WorldAnnotationPresenter {
  private readonly _eventHost: ScriptComponent;
  private readonly _parent: SceneObject;
  private readonly _markerPrefab: ObjectPrefab | null;
  private readonly _entries = new Map<string, AnnotationEntry>();
  private _updateBound = false;

  constructor(deps: WorldAnnotationPresenterDeps) {
    this._eventHost = deps.eventHost;
    this._parent = deps.parent;
    this._markerPrefab = deps.markerPrefab;
  }

  public apply(args: WorldAnnotationArgs): { ok: boolean; error?: string } {
    const id = args.id?.trim();
    if (!id) {
      return { ok: false, error: "annotation id is required" };
    }
    if (args.active === false) {
      this.remove(id);
      return { ok: true };
    }
    if (args.kind !== "marker" && args.kind !== "line") {
      return { ok: false, error: `unsupported annotation kind: ${args.kind}` };
    }
    const points = args.points;
    if (!Array.isArray(points) || points.length === 0) {
      return { ok: false, error: "annotation points are required" };
    }
    if (args.kind === "marker") {
      return this._upsertMarker(id, { ...args, kind: "marker", points });
    }
    return this._upsertLine(id, { ...args, kind: "line", points });
  }

  public remove(id: string): void {
    const entry = this._entries.get(id);
    if (!entry) {
      return;
    }
    this._destroyEntry(entry);
    this._entries.delete(id);
  }

  public clearAll(): void {
    for (const id of [...this._entries.keys()]) {
      this.remove(id);
    }
  }

  /** Test helper — current registry size. */
  public size(): number {
    return this._entries.size;
  }

  private _upsertMarker(
    id: string,
    args: WorldAnnotationArgs & { points: [number, number, number][] },
  ): { ok: boolean; error?: string } {
    if (!this._markerPrefab) {
      return { ok: false, error: "annotation marker prefab is not assigned" };
    }
    if (args.points.length !== 1) {
      return { ok: false, error: "marker annotations require exactly one point" };
    }
    this.remove(id);
    const root = this._markerPrefab.instantiate(this._parent);
    const worldCm = protocolMetersToLensCentimeters(args.points[0]);
    root.getTransform().setWorldPosition(worldCm);
    const text = findText(root, "ObjectName") ?? findFirstTextFallback(root);
    if (text && args.label) {
      text.text = args.label;
    }
    root.enabled = true;
    const expiresAt =
      args.duration_s !== undefined && isFinite(args.duration_s) && args.duration_s > 0
        ? getTime() + args.duration_s
        : null;
    this._entries.set(id, { kind: "marker", root, expiresAt });
    if (expiresAt !== null) {
      this._ensureUpdateTick();
    }
    return { ok: true };
  }

  private _upsertLine(
    id: string,
    args: WorldAnnotationArgs & { points: [number, number, number][] },
  ): { ok: boolean; error?: string } {
    if (args.points.length < 2) {
      return { ok: false, error: "line annotations require at least two points" };
    }
    this.remove(id);
    const protocolPoints: Point3[] = args.points.map((p) => ({
      x: p[0],
      y: p[1],
      z: p[2],
    }));
    const resolved = resolveLinePoints(protocolPoints);
    const lensPoints = resolved.map((p) =>
      protocolMetersToLensCentimeters([p.x, p.y, p.z]),
    );
    const color: LineRgb =
      args.color && args.color.length === 3
        ? [args.color[0], args.color[1], args.color[2]]
        : DEFAULT_LINE_COLOR;
    const line = new LineRenderer({
      parent: this._parent,
      name: `AnnotationLine_${id}`,
      eventHost: this._eventHost,
      onExpired: () => this.remove(id),
    });
    line.setColor(color);
    if (args.duration_s !== undefined) {
      line.setDuration(args.duration_s);
    }
    line.setPoints(lensPoints);
    this._entries.set(id, { kind: "line", line });
    return { ok: true };
  }

  private _ensureUpdateTick(): void {
    if (this._updateBound) {
      return;
    }
    this._updateBound = true;
    this._eventHost.createEvent("UpdateEvent").bind(() => this._tickMarkerExpiry());
  }

  private _tickMarkerExpiry(): void {
    const now = getTime();
    for (const [id, entry] of [...this._entries.entries()]) {
      if (entry.kind !== "marker" || entry.expiresAt === null) {
        continue;
      }
      if (now >= entry.expiresAt) {
        this.remove(id);
      }
    }
  }

  private _destroyEntry(entry: AnnotationEntry): void {
    if (entry.kind === "marker") {
      entry.root.destroy();
      return;
    }
    entry.line.destroy();
  }
}

function findFirstTextFallback(root: SceneObject): Text | null {
  const direct = root.getComponent("Component.Text") as Text | null;
  if (direct) {
    return direct;
  }
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const nested = findFirstTextFallback(root.getChild(i));
    if (nested) {
      return nested;
    }
  }
  return null;
}
