import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientTrackingOrigin } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import { ROBOT_LINE_STYLE } from "../../Assets/Scripts/DimOSARClient/presentation/WorldVisualStyle";

const { renderers } = vi.hoisted(() => ({ renderers: new Map<string, any>() }));
vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer", () => {
  class Renderer {
    object = { getTransform: () => ({ setWorldPosition() {}, setWorldRotation() {}, setWorldScale() {} }) };
    triangles = vi.fn();
    segments = vi.fn();
    setViewportHeight = vi.fn();
    hide = vi.fn();
    destroy = vi.fn();
    constructor(_parent: unknown, name: string) { renderers.set(name, this); }
  }
  return { WorldMeshRenderer: Renderer, AdaptiveStrokeRenderer: Renderer };
});
import { NavGoalPresenter } from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavGoalPresenter";

const origin: ClientTrackingOrigin = {
  position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0,
};
function harness() {
  const presenter = new NavGoalPresenter({} as SceneObject);
  return { presenter, dots: renderers.get("NavigationRouteDots"), ribbon: renderers.get("NavigationRouteRibbon") };
}
beforeEach(() => renderers.clear());

describe("native route presentation", () => {
  it("draws executing paths as a solid ribbon in Specs centimetres", () => {
    const { presenter, dots, ribbon } = harness();
    presenter.apply({ origin, executing: true, path: [[0, 0, 0, 0], [1, 0, 0, 0]] });
    expect(ribbon.triangles).toHaveBeenCalledOnce();
    const positions: number[] = ribbon.triangles.mock.calls[0][0];
    const z = positions.filter((_, index) => index % 3 === 2);
    // Rounded end caps extend both ends equally; the one-metre path stays centered at -50 cm.
    expect((Math.min(...z) + Math.max(...z)) / 2).toBeCloseTo(-50);
    expect(dots.hide).toHaveBeenCalled();
  });

  it("uses the robot bounds' dash pattern for advisory previews while another path executes", () => {
    const { presenter, dots, ribbon } = harness();
    presenter.apply({ origin, executing: true, preview: true, viewportHeight: 720,
      path: [[0, 0, 0, 0], [1, 0, 0, 0]] });
    expect(dots.segments).toHaveBeenCalledOnce();
    const [, width, , dash, gap, continuous] = dots.segments.mock.calls[0];
    expect(width).toBeCloseTo(ROBOT_LINE_STYLE.selectedWidthM * 100);
    expect(dash).toBeCloseTo(ROBOT_LINE_STYLE.dashM * 100);
    expect(gap).toBeCloseTo(ROBOT_LINE_STYLE.gapM * 100);
    expect(continuous).toBe(true);
    expect(dots.setViewportHeight).toHaveBeenCalledWith(720);
    expect(ribbon.triangles).not.toHaveBeenCalled();
    expect(ribbon.hide).toHaveBeenCalled();
  });

  it("clears both visuals when localization or a complete path is missing", () => {
    const { presenter, dots, ribbon } = harness();
    presenter.apply({ origin: null, path: [[0, 0, 0, 0], [1, 0, 0, 0]] });
    presenter.apply({ origin, path: [[0, 0, 0, 0]] });
    expect(dots.hide).toHaveBeenCalledTimes(2);
    expect(ribbon.hide).toHaveBeenCalledTimes(2);
    expect(dots.segments).not.toHaveBeenCalled();
    expect(ribbon.triangles).not.toHaveBeenCalled();
  });

  it("releases both native renderers on teardown", () => {
    const { presenter, dots, ribbon } = harness();
    presenter.destroy();
    expect(dots.destroy).toHaveBeenCalledOnce();
    expect(ribbon.destroy).toHaveBeenCalledOnce();
  });
});
