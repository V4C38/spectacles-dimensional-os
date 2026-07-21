import { describe, expect, it, vi } from "vitest";
import { ArSkillHandlers } from "../../Assets/Scripts/ARBridge/Agent/ArSkillHandlers";
import { quat, vec3 } from "../shims/lens-runtime";

describe("ArSkillHandlers", () => {
  it("converts HMD camera pose from cm to protocol meters", () => {
    const handlers = new ArSkillHandlers({
      getHmdWorldTransform: () => ({
        position: new vec3(100, 200, 300),
        // shim constructor is (w, x, y, z)
        rotation: new quat(0.5, 0, 0.5, 0),
      }),
      annotations: null,
    });
    const result = handlers.handle({
      type: "ar_skill",
      ts: 1,
      request_id: "r1",
      skill: "get_user_hmd_transform",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.position).toEqual([1, 2, 3]);
    expect(result.data?.orientation).toEqual([0, 0.5, 0, 0.5]);
  });

  it("returns camera transform unavailable when provider yields null", () => {
    const handlers = new ArSkillHandlers({
      getHmdWorldTransform: () => null,
      annotations: null,
    });
    const result = handlers.handle({
      type: "ar_skill",
      ts: 1,
      request_id: "r1",
      skill: "get_user_hmd_transform",
    });
    expect(result).toEqual({
      ok: false,
      error: "camera transform unavailable",
    });
  });

  it("returns unknown skill for unregistered names", () => {
    const handlers = new ArSkillHandlers({
      getHmdWorldTransform: () => null,
      annotations: null,
    });
    const result = handlers.handle({
      type: "ar_skill",
      ts: 1,
      request_id: "r1",
      skill: "not_a_skill",
    });
    expect(result).toEqual({ ok: false, error: "unknown skill" });
  });

  it("validates annotation args and forwards color", () => {
    const apply = vi.fn().mockReturnValue({ ok: true });
    const handlers = new ArSkillHandlers({
      getHmdWorldTransform: () => null,
      annotations: { apply } as never,
    });
    const bad = handlers.handle({
      type: "ar_skill",
      ts: 1,
      request_id: "r1",
      skill: "draw_world_annotation",
      args: { id: "m1", kind: "marker" },
    });
    expect(bad.ok).toBe(false);

    const ok = handlers.handle({
      type: "ar_skill",
      ts: 1,
      request_id: "r2",
      skill: "draw_world_annotation",
      args: {
        id: "line-1",
        kind: "line",
        points: [
          [0, 0, 0],
          [1, 0, 2],
        ],
        color: [0.1, 0.2, 0.3],
        duration_s: 12,
      },
    });
    expect(ok.ok).toBe(true);
    expect(apply).toHaveBeenCalledWith({
      id: "line-1",
      kind: "line",
      points: [
        [0, 0, 0],
        [1, 0, 2],
      ],
      label: undefined,
      active: true,
      duration_s: 12,
      color: [0.1, 0.2, 0.3],
    });
  });

  it("clears annotation when active is false", () => {
    const apply = vi.fn().mockReturnValue({ ok: true });
    const handlers = new ArSkillHandlers({
      getHmdWorldTransform: () => null,
      annotations: { apply } as never,
    });
    handlers.handle({
      type: "ar_skill",
      ts: 1,
      request_id: "r1",
      skill: "draw_world_annotation",
      args: { id: "m1", active: false },
    });
    expect(apply).toHaveBeenCalledWith({ id: "m1", active: false });
  });
});
