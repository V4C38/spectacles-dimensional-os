import { expect, it, vi } from "vitest";
import { Frame } from "../mocks/Frame";

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
    configureControlPanelFrame: vi.fn(), isFrameInitialized: (frame: Frame) => frame.initialized,
  };
});
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
import { ManipulationControlsView } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationControlsView";

it("routes arm commands through Core and releases native registrations", () => {
  fixture.subscriptions.length = 0;
  vi.stubGlobal("vec2", class { constructor(public x: number, public y: number) {} });
  vi.stubGlobal("HorizontalAlignment", { Center: 0, Left: 1 });
  vi.stubGlobal("Rect", { create: (...bounds: number[]) => bounds });
  const makeNode = (name = "root"): any => {
    let scale = vec3.one();
    const node = { name, enabled: true, makeChild: makeNode, setParent: vi.fn(), destroy: vi.fn(),
      getTransform: () => ({ setLocalPosition: vi.fn(),
        setLocalScale: (value: vec3) => { scale = value; }, getLocalScale: () => scale }),
      createComponent: (type: string) => {
        if (type === Frame.getTypeName()) {
          const frame = new Frame(); frame.sceneObject = node; return frame;
        }
        return { onValueChange: { add: () => vi.fn() } };
      },
    };
    return node;
  };
  const previousScene = global.scene;
  (global as any).scene = { createSceneObject: makeNode };
  try {
    const intent = { stopped: false, canManipulate: true };
    const core = { interaction: { snapshot: () => intent }, action: vi.fn() };
    let enabled = true;
    const view = new ManipulationControlsView(makeNode(), core as never, () => enabled, vi.fn(), vi.fn());
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
