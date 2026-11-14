import { expect, it, vi } from "vitest";
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider", () => ({ Slider: class {} }));
vi.mock("../mocks/UIKit.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../mocks/UIKit")>(),
  uprightFacingRotation: () => quat.quatIdentity(),
}));
import { EndEffectorStatusView } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationRenderer";
import { ViewerNotificationPresenter } from "../../Assets/Scripts/DimOSSpecsClient/presentation/ViewerNotificationPresenter";
import { EndEffectorStatus } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationPresentation";

it("anchors the Specs status beside the EE and fades its plate, text, and animated glyph together", () => {
  const transform = { setWorldPosition: vi.fn(), setWorldRotation: vi.fn(), setLocalScale: vi.fn() };
  const root = { enabled: false, getTransform: () => transform }, text = { text: "", textFill: { color: new vec4() } };
  const plate = { backgroundColor: new vec4() }, triangles = vi.fn();
  const presenter = Object.assign(Object.create(ViewerNotificationPresenter.prototype), {
    root, text, plate, icon: { triangles },
  });
  const pill = Object.assign(Object.create(EndEffectorStatusView.prototype), {
    presenter, status: new EndEffectorStatus(),
  }) as EndEffectorStatusView;
  const anchor = { getTransform: () => ({ getWorldPosition: () => new vec3(1, 2, 3) }) } as SceneObject;
  const camera = { getTransform: () => ({ getWorldRotation: () => quat.quatIdentity(), getWorldPosition: () => vec3.zero() }) } as SceneObject;
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
  pill.apply({ ...ready, blocked: true, moving: true }, anchor, camera, 4);
  pill.apply({ ...ready, blocked: true, moving: true }, anchor, camera, 5);
  expect(text.text).toBe("Executing");
  expect(triangles.mock.calls.at(-1)![2]).toEqual([1, 1, 1, 1]);
});
