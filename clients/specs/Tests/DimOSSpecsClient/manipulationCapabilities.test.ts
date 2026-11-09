import { expect, it, vi } from "vitest";
import { SpecsManipulationController } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/SpecsManipulationController";
vi.mock("../../Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationRenderer", () => ({ ManipulationRenderer: class {} }));
vi.mock("SpectaclesInteractionKit.lspkg/Providers/TargetProvider/TargetProvider", () => ({ default: {} }));
const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
function fixture(navigation: boolean, manipulation: boolean) {
  const state = { available: true, model: { revision: "cached-arm" } };
  const capabilities = { navigation: { available: navigation },
    manipulation: { available: manipulation }, localization: { available: true } };
  const view = { connection: "ready", capabilities: capabilities as typeof capabilities | null,
    manipulation: state };
  const interaction = { retainingFeedback: false, available: true, dragging: false };
  const core = { interaction, tick: vi.fn(), suspend: vi.fn() };
  const renderer = { apply: vi.fn() };
  const input = { reset: vi.fn(), tick: vi.fn(), updateCursor: vi.fn(), capture: { owner: null } };
  let currentOrigin: typeof origin | null = origin;
  const controller = Object.assign(Object.create(SpecsManipulationController.prototype), {
    session: { view: () => view }, core, renderer, input,
    origin: () => currentOrigin, lastOrigin: origin,
  }) as SpecsManipulationController;
  return { controller, core, renderer, interaction, input, view, state, loseOrigin: () => { currentOrigin = null; } };
}
it.each([[true, false], [false, true], [true, true], [false, false]])(
  "uses only manipulation capability for the cached arm (navigation=%s, manipulation=%s)", (navigation, manipulation) => {
    const f = fixture(navigation, manipulation);
    f.controller.tick(true);
    expect(f.core.tick).toHaveBeenLastCalledWith(manipulation);
    expect(f.renderer.apply.mock.calls.at(-1)![1]).toBe(manipulation ? origin : null);
    expect(f.input.tick).toHaveBeenLastCalledWith(manipulation);
  },
);
it("hides cached arm feedback and clears input when the blueprint loses manipulation", () => {
  const f = fixture(false, true);
  f.controller.tick(true);
  f.interaction.retainingFeedback = true;
  f.view.manipulation.available = false;
  f.view.capabilities!.manipulation.available = false;
  f.view.capabilities!.navigation.available = true;
  f.controller.tick(true);
  expect(f.core.suspend).toHaveBeenCalledOnce();
  expect(f.input.reset).toHaveBeenCalledOnce();
  expect(f.renderer.apply.mock.calls.at(-1)![1]).toBeNull();
  expect(f.renderer.apply.mock.calls.at(-1)![0].model).toBe(f.state.model);
});
it("retains the arm on feedback loss while its capability remains available", () => {
  const f = fixture(true, true);
  f.interaction.retainingFeedback = true;
  f.view.manipulation.available = false;
  f.loseOrigin();
  f.controller.tick(false);
  expect(f.core.suspend).not.toHaveBeenCalled();
  expect(f.renderer.apply.mock.calls.at(-1)![1]).toBe(origin);
});

it("retains the arm through transient unknown capabilities during reconnect", () => {
  const f = fixture(false, true);
  f.controller.tick(true);
  f.interaction.retainingFeedback = true;
  f.view.manipulation.available = false;
  f.view.connection = "disconnected";
  f.view.capabilities = null;
  f.loseOrigin();
  f.controller.tick(false);
  expect(f.core.suspend).not.toHaveBeenCalled();
  expect(f.renderer.apply.mock.calls.at(-1)![1]).toBe(origin);
});
