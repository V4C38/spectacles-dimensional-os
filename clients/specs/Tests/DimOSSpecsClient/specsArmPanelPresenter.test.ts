import { expect, it, vi } from "vitest";
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame", () => ({ Frame: class {} }));
import { SpecsArmPanelPresenter } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/SpecsArmPanelPresenter";
import { ARM_PANEL_STYLE } from "../../Assets/Scripts/DimOSARClient/presentation/PanelFrameStyle";
class Vector {
  constructor(public x = 0, public y = 0, public z = 0) {}
  add(other: Vector) { return new Vector(this.x + other.x, this.y + other.y, this.z + other.z); }
  uniformScale(n: number) { return new Vector(this.x * n, this.y * n, this.z * n); }
  static one() { return new Vector(1, 1, 1); }
}
it("attaches below a non-zero base, pins when moved, and resets to the current robot", () => {
  vi.stubGlobal("vec3", Vector);
  const position = vi.fn(), scale = vi.fn();
  const transform = { setWorldPosition: position, setWorldRotation: vi.fn(), setLocalScale: scale };
  const presenter = Object.assign(Object.create(SpecsArmPanelPresenter.prototype), {
    configured: true, configuring: false, pinned: false, height: .188,
    root: { enabled: false, getTransform: () => transform },
    frame: { content: { getTransform: () => ({ setLocalScale: vi.fn() }) } },
  });
  const rotation = { multiplyVec3: (p: Vector) => p };
  const camera = { getTransform: () => ({ getWorldRotation: () => rotation }) };
  let basePosition = new Vector(120, 80, -240);
  const base = { getTransform: () => ({ getWorldPosition: () => basePosition }) };
  try {
    presenter.update(base, camera, .188);
    expect(position).toHaveBeenLastCalledWith(new Vector(120, 80 - 13 - .188 * 50 * ARM_PANEL_STYLE.defaultScale * .75, -240));
    presenter.pinned = true; basePosition = new Vector(200, 90, -100);
    presenter.update(base, camera, .188); expect(position).toHaveBeenCalledOnce();
    presenter.reset(); presenter.height = .188;
    presenter.update(base, camera, .188); expect(position.mock.calls.at(-1)![0].x).toBe(200);
    presenter.update(null, camera, .188); expect(presenter.root.enabled).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
