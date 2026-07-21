import {
  ArSkillMessage,
  lensCentimetersToProtocolMeters,
} from "../Network/Protocol";
import type { WorldAnnotationPresenter } from "../../App/Agent/WorldAnnotationPresenter";

export interface ArSkillHandlerResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export type ArSkillHandler = (
  args?: Record<string, unknown>,
) => ArSkillHandlerResult;

export interface HmdWorldTransform {
  position: vec3;
  rotation: quat;
}

export interface ArSkillHandlersDeps {
  getHmdWorldTransform: () => HmdWorldTransform | null;
  annotations: WorldAnnotationPresenter | null;
}

/** Registry of Lens-side AR skill handlers. */
export class ArSkillHandlers {
  private readonly _handlers = new Map<string, ArSkillHandler>();
  private readonly _getHmdWorldTransform: () => HmdWorldTransform | null;
  private readonly _annotations: WorldAnnotationPresenter | null;

  constructor(deps: ArSkillHandlersDeps) {
    this._getHmdWorldTransform = deps.getHmdWorldTransform;
    this._annotations = deps.annotations;

    this.register("get_user_hmd_transform", () => this._handleHmdTransform());
    this.register("draw_world_annotation", (args) => this._handleDrawAnnotation(args));
  }

  public register(skill: string, handler: ArSkillHandler): void {
    this._handlers.set(skill, handler);
  }

  public handle(msg: ArSkillMessage): ArSkillHandlerResult {
    const handler = this._handlers.get(msg.skill);
    if (!handler) {
      return { ok: false, error: "unknown skill" };
    }
    return handler(msg.args);
  }

  private _handleHmdTransform(): ArSkillHandlerResult {
    const pose = this._getHmdWorldTransform();
    if (!pose) {
      return { ok: false, error: "camera transform unavailable" };
    }
    const position = lensCentimetersToProtocolMeters(pose.position);
    const r = pose.rotation;
    return {
      ok: true,
      data: {
        position,
        orientation: [r.x, r.y, r.z, r.w],
      },
    };
  }

  private _handleDrawAnnotation(
    args?: Record<string, unknown>,
  ): ArSkillHandlerResult {
    if (!this._annotations) {
      return { ok: false, error: "annotation presenter unavailable" };
    }
    if (!args || typeof args !== "object") {
      return { ok: false, error: "draw_world_annotation requires args" };
    }
    const id = args.id;
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, error: "annotation id is required" };
    }
    const active = args.active === undefined ? true : Boolean(args.active);
    if (!active) {
      return this._annotations.apply({ id, active: false });
    }
    const kind = args.kind;
    if (kind !== "marker" && kind !== "line") {
      return { ok: false, error: "kind must be 'marker' or 'line'" };
    }
    const points = parsePoints(args.points);
    if (!points) {
      return { ok: false, error: "points must be an array of [x,y,z] meter triples" };
    }
    const label = typeof args.label === "string" ? args.label : undefined;
    const durationRaw = args.duration_s;
    const duration_s =
      typeof durationRaw === "number" && isFinite(durationRaw) ? durationRaw : undefined;
    const color = parseColor(args.color);
    return this._annotations.apply({
      id,
      kind,
      points,
      label,
      active: true,
      duration_s,
      color,
    });
  }
}

function parsePoints(raw: unknown): [number, number, number][] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const points: [number, number, number][] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 3) {
      return null;
    }
    const x = item[0];
    const y = item[1];
    const z = item[2];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      !isFinite(x) ||
      !isFinite(y) ||
      !isFinite(z)
    ) {
      return null;
    }
    points.push([x, y, z]);
  }
  return points;
}

function parseColor(raw: unknown): [number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) {
    return undefined;
  }
  const r = raw[0];
  const g = raw[1];
  const b = raw[2];
  if (
    typeof r !== "number" ||
    typeof g !== "number" ||
    typeof b !== "number" ||
    !isFinite(r) ||
    !isFinite(g) ||
    !isFinite(b)
  ) {
    return undefined;
  }
  return [r, g, b];
}
