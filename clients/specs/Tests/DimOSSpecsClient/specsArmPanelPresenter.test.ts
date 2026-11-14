import { expect, it, vi } from "vitest";
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider", () => ({ Slider: class {} }));
import { SpecsArmPanelPresenter } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationControlsView";
import { Frame } from "../mocks/Frame";


it("initializes Frame on an enabled host before hiding it or using its native button setters", () => {
  const objects: any[] = [];
  const makeObject = (name: string): any => {
    let scale = vec3.one();
    const object = { name, enabled: true, setParent: vi.fn(), destroy: vi.fn(),
      getTransform: () => ({ setLocalScale: (value: vec3) => { scale = value; }, getLocalScale: () => scale }),
      createComponent: () => { const frame = new Frame(); frame.sceneObject = object; return frame; },
    };
    objects.push(object); return object;
  };
  vi.stubGlobal("scene", { createSceneObject: makeObject });
  try {
    const presenter = new SpecsArmPanelPresenter(makeObject("parent"));
    expect(presenter.frame.initialized).toBe(true);
    expect((presenter.frame as unknown as Frame).listenersDuringInitialize).toBe(0);
    expect(presenter.root.enabled).toBe(false);
    expect(presenter.frame.showCloseButton).toBe(false);
    expect(presenter.frame.showFollowButton).toBe(false);
    expect(presenter.frame.allowScaling).toBe(false);
    // SUK initialize schedules its default hide tween; setting the flag afterward
    // leaves that tween running even when the arm presenter enables the root.
    (presenter.frame as unknown as Frame).finishAnimations();
    presenter.root.enabled = true;
    expect(presenter.frame.opacity).toBe(1);
    expect(presenter.frame.isVisible).toBe(true);
    expect(presenter.frame.roundedRectangle.renderMeshVisual.enabled).toBe(true);
    expect(presenter.content.setParent).toHaveBeenCalledWith(presenter.frame.content);
    presenter.dispose();
    expect(presenter.root.destroy).toHaveBeenCalledOnce();
    expect((presenter.frame as unknown as Frame).onTranslationStart.size).toBe(0);
    expect((presenter.frame as unknown as Frame).onScalingUpdate.size).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

import { ARM_PANEL_STYLE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";
class Vector {
  constructor(public x = 0, public y = 0, public z = 0) {}
  add(other: Vector) { return new Vector(this.x + other.x, this.y + other.y, this.z + other.z); }
  sub(other: Vector) { return new Vector(this.x - other.x, this.y - other.y, this.z - other.z); }
  get length() { return Math.hypot(this.x,this.y,this.z); }
  normalize() { const n = this.length || 1; return new Vector(this.x/n,this.y/n,this.z/n); }
  static up() { return new Vector(0,1,0); }
  uniformScale(n: number) { return new Vector(this.x * n, this.y * n, this.z * n); }
  static one() { return new Vector(1, 1, 1); }
}
it("attaches below a non-zero base, pins when moved, and resets to the current robot", () => {
  vi.stubGlobal("vec3", Vector);
  let panelPosition = new Vector();
  const position = vi.fn((p: Vector) => { panelPosition = p; }), scale = vi.fn();
  const transform = { getWorldPosition: () => panelPosition, setWorldPosition: position, setWorldRotation: vi.fn(), setLocalScale: scale };
  const presenter = Object.assign(Object.create(SpecsArmPanelPresenter.prototype), {
    configured: true, configuring: false, pinned: false, height: .188,
    root: { enabled: false, getTransform: () => transform },
    frame: { content: { getTransform: () => ({ setLocalScale: vi.fn() }) } },
  });
  const rotation = { multiplyVec3: (p: Vector) => p };
  const lookAt = vi.fn(() => rotation);
  vi.stubGlobal("quat", { lookAt });
  const camera = { getTransform: () => ({ getWorldPosition: () => new Vector(120,80,0), getWorldRotation: () => { throw new Error("head roll must not be copied"); } }) };
  let basePosition = new Vector(120, 80, -240);
  const base = { getTransform: () => ({ getWorldPosition: () => basePosition }) };
  try {
    presenter.update(base, camera, .188);
    expect(lookAt).toHaveBeenCalledWith(expect.anything(), new Vector(0,1,0));
    expect(position).toHaveBeenLastCalledWith(new Vector(120, 80 - 13 - .188 * 50 * ARM_PANEL_STYLE.defaultScale * .75, -240));
    presenter.pinned = true; basePosition = new Vector(200, 90, -100);
    presenter.update(base, camera, .188); expect(position).toHaveBeenCalledOnce();
    presenter.reset(); presenter.height = .188;
    presenter.update(base, camera, .188); expect(position.mock.calls.at(-1)![0].x).toBe(200);
    presenter.update(null, camera, .188); expect(presenter.root.enabled).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
