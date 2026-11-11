import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ subscriptions: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("../mocks/UIKit.ts", () => {
  const event = () => ({ fire: () => {}, add(callback: () => void) {
    this.fire = callback;
    const unsubscribe = vi.fn(); fixture.subscriptions.push(unsubscribe); return unsubscribe;
  } });
  return {
    SnapOS2Styles: { Secondary: "secondary", Primary: "primary", Special: "special" }, COLOR_WHITE: {},
    createIconButton: (parent: any, name: string) => ({ sceneObject: parent.makeChild(name), labelText: {},
      button: { inactive: false, onTriggerDown: event(), onTriggerUp: event(),
        interactable: { onHoverEnter: event(), onHoverExit: event() } } }),
    createText: () => ({}), panelButtonLayer: vi.fn(), uiMaterialLayer: vi.fn(),
  };
});
vi.mock("../../Assets/Scripts/DimOSSpecsClient/manipulation/SpecsArmPanelPresenter", () => ({
  SpecsArmPanelPresenter: class {
    content: any;
    reset = vi.fn(); dispose = vi.fn();
    constructor(parent: any) { this.content = parent.makeChild("FrameContent"); }
  },
}));
vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer", () => ({
  WorldMeshRenderer: class {
    object: any; visual = {};
    constructor(parent: any) { this.object = parent.makeChild("Icon"); }
    triangles() {}
  },
}));
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider", () => ({
  Slider: class { static getTypeName() { return "Slider"; } },
}));
import { ArmControlsView } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/ArmControlsView";

it("routes arm commands through Core and releases native registrations", () => {
  fixture.subscriptions.length = 0;
  vi.stubGlobal("vec2", class { constructor(public x: number, public y: number) {} });
  vi.stubGlobal("HorizontalAlignment", { Center: 0, Left: 1 });
  vi.stubGlobal("Rect", { create: (...bounds: number[]) => bounds });
  const makeNode = (name = "root"): any => ({ name, makeChild: makeNode, setParent: vi.fn(), destroy: vi.fn(),
    getTransform: () => ({ setLocalPosition: vi.fn() }),
    createComponent: () => ({ onValueChange: { add: () => vi.fn() } }),
  });
  const previousScene = global.scene;
  (global as any).scene = { createSceneObject: makeNode };
  try {
    const intent = { stopped: false, canManipulate: true };
    const core = { interaction: { snapshot: () => intent }, action: vi.fn() };
    let enabled = true;
    const view = new ArmControlsView(makeNode(), core as never, () => enabled, vi.fn(), vi.fn());
    const press = (key: string) => (view.buttons.get(key)!.button.onTriggerDown as any).fire();
    press("estop"); expect(core.action).toHaveBeenLastCalledWith("estop");
    intent.stopped = true; press("estop"); expect(core.action).toHaveBeenLastCalledWith("resume");
    core.action.mockClear(); enabled = false; press("plan"); expect(core.action).not.toHaveBeenCalled();
    press("stop"); expect(core.action).toHaveBeenCalledWith("stop");
    view.dispose();
    expect(fixture.subscriptions.length).toBeGreaterThan(0);
    for (const unsubscribe of fixture.subscriptions) expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { (global as any).scene = previousScene; vi.unstubAllGlobals(); }
});
