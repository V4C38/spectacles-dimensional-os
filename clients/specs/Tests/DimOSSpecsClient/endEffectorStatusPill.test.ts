import { expect, it, vi } from "vitest";
import { EndEffectorStatusPill } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/EndEffectorStatusPill";
import { EndEffectorStatus } from "../../Assets/Scripts/DimOSARClient/manipulation/EndEffectorStatus";

it("anchors the Specs status beside the EE and fades its plate, text, and animated glyph together", () => {
  const transform = { setWorldPosition: vi.fn(), setWorldRotation: vi.fn(), setLocalScale: vi.fn() };
  const root = { enabled: false, getTransform: () => transform }, text = { text: "", textFill: { color: new vec4() } };
  const plate = { backgroundColor: new vec4() }, triangles = vi.fn();
  const pill = Object.assign(Object.create(EndEffectorStatusPill.prototype), {
    root, text, plate, icon: { triangles }, status: new EndEffectorStatus(),
  }) as EndEffectorStatusPill;
  const anchor = { getTransform: () => ({ getWorldPosition: () => new vec3(1, 2, 3) }) } as SceneObject;
  const camera = { getTransform: () => ({ getWorldRotation: () => quat.quatIdentity() }) } as SceneObject;
  const failed = { blocked: false, fresh: true, stopped: false, moving: false, rejection: { message: "IK failed" } };
  pill.apply(failed, anchor, camera, 1);
  pill.apply({ ...failed }, anchor, camera, 3);
  expect(root.enabled).toBe(true);
  expect(text.text).toBe("IK failed");
  expect(text.textFill.color.w).toBe(1);
  expect(transform.setWorldPosition).toHaveBeenLastCalledWith(new vec3(17, 3, 3));
  expect(triangles.mock.calls.at(-1)![0].length).toBeGreaterThan(0);
  const ready = { ...failed, rejection: null };
  pill.apply(ready, anchor, camera, 3.1);
  pill.apply(ready, anchor, camera, 3.19);
  expect(text.textFill.color.w).toBeCloseTo(0.5);
  expect(plate.backgroundColor.w).toBeCloseTo(0.47);
  expect(triangles.mock.calls.at(-1)![2][3]).toBeCloseTo(0.5);
  pill.apply(ready, anchor, camera, 3.3);
  expect(root.enabled).toBe(false);
});
