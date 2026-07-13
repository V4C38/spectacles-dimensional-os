import { ArSkillMessage } from "../Network/Protocol";

export interface ArSkillHandlerResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export type ArSkillHandler = (
  args?: Record<string, unknown>,
) => ArSkillHandlerResult;

/** Registry of Lens-side AR skill handlers (reference stubs for v17). */
export class ArSkillHandlers {
  private readonly _handlers = new Map<string, ArSkillHandler>();

  constructor() {
    this.register("get_user_hmd_transform", () => ({
      ok: true,
      data: {
        position: [0.0, 0.0, 0.0],
        orientation: [0.0, 0.0, 0.0, 1.0],
      },
    }));
    this.register("draw_world_annotation", () => ({
      ok: true,
    }));
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
}
