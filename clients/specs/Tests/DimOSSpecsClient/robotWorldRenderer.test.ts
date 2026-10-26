import { expect, it, vi } from "vitest";
import { RobotWorldRenderer } from "../../Assets/Scripts/DimOSSpecsClient/presentation/RobotWorldRenderer";

it("retires robot picking and outlines when disconnect clears the description", () => {
  // Native scene allocation is exercised by the CLAD review. Keep this regression
  // focused on the connected -> disconnected model boundary that crashed Preview.
  const colliderRoot = { enabled: true, getTransform: () => ({ setLocalPosition: vi.fn() }) };
  const outline = { hide: vi.fn() }, circle = { hide: vi.fn() }, connector = { hide: vi.fn() };
  const renderer = Object.assign(Object.create(RobotWorldRenderer.prototype), {
    colliderRoot, collider: { shape: {} }, outline, circle, connector,
  }) as RobotWorldRenderer;
  renderer.setRobot({ display_name: "Go2", body_bounds_m: [0.7, 0.5, 0.55], footprint_m: [0.7, 0.5], base_height_m: 0.33 });
  renderer.setSelected(true);
  expect(colliderRoot.enabled).toBe(true);
  expect(() => renderer.setRobot(null)).not.toThrow();
  expect(colliderRoot.enabled).toBe(false);
  expect(outline.hide).toHaveBeenCalled(); expect(circle.hide).toHaveBeenCalled(); expect(connector.hide).toHaveBeenCalled();
});
