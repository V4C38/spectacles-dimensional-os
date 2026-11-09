import { expect, it, vi } from "vitest";
import { WebXRManipulationController } from "../src/manipulation/WebXRManipulationController";
vi.mock("../src/manipulation/ManipulationRenderer", () => ({ ManipulationRenderer: class {} }));
const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
function fixture(navigation: boolean, manipulation: boolean) {
  const state = { available: true, model: { revision: "cached-arm" } };
  const capabilities = { navigation: { available: navigation },
    manipulation: { available: manipulation }, localization: { available: true } };
  const view = { connection: "ready", capabilities: capabilities as typeof capabilities | null,
    manipulation: state };
  const interaction = { retainingFeedback: false, available: true, groupId: "arm", snapshot: () => ({}), end: vi.fn() };
  const core = { tick: vi.fn(), suspend: vi.fn() };
  const renderer = { controlsView: {}, apply: vi.fn(), handle: { collider: { userData: { rayDisabled: false } },
    visual: { material: { uniforms: { uCenterColor: { value: { setHex() {} } } } } } } };
  let currentOrigin: typeof origin | null = origin;
  const controller = Object.assign(Object.create(WebXRManipulationController.prototype), {
    session: { view: () => view, collaboration: { snapshot: () => ({ blocked: false }) } },
    interaction, core, renderer, origin: () => currentOrigin, lastOrigin: origin,
    gesture: { end: vi.fn() }, now: () => 100,
  }) as WebXRManipulationController;
  return { controller, core, renderer, interaction, view, state, loseOrigin: () => { currentOrigin = null; } };
}
it.each([[true, false], [false, true], [true, true], [false, false]])(
  "uses only manipulation capability for the cached arm (navigation=%s, manipulation=%s)", (navigation, manipulation) => {
    const f = fixture(navigation, manipulation);
    f.controller.tick(true);
    expect(f.core.tick).toHaveBeenLastCalledWith(manipulation);
    expect(f.renderer.apply.mock.calls.at(-1)![0].origin).toBe(manipulation ? origin : null);
    expect(f.renderer.handle.collider.userData.rayDisabled).toBe(!manipulation);
  },
);
it("hides a cached arm and retires held intent when the blueprint loses manipulation", () => {
  const f = fixture(false, true);
  f.controller.tick(true);
  f.interaction.retainingFeedback = true;
  f.view.manipulation.available = false;
  f.view.capabilities!.manipulation.available = false;
  f.view.capabilities!.navigation.available = true;
  f.controller.tick(true);
  expect(f.core.suspend).toHaveBeenCalledOnce();
  expect(f.interaction.end).toHaveBeenCalledOnce();
  expect(f.renderer.apply.mock.calls.at(-1)![0].origin).toBeNull();
  expect(f.renderer.apply.mock.calls.at(-1)![0].state.model).toBe(f.state.model);
});
it("retains the arm on feedback loss while its capability remains available", () => {
  const f = fixture(true, true);
  f.interaction.retainingFeedback = true;
  f.view.manipulation.available = false;
  f.loseOrigin();
  f.controller.tick(false);
  expect(f.core.suspend).not.toHaveBeenCalled();
  expect(f.renderer.apply.mock.calls.at(-1)![0].origin).toBe(origin);
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
  expect(f.renderer.apply.mock.calls.at(-1)![0].origin).toBe(origin);
});
