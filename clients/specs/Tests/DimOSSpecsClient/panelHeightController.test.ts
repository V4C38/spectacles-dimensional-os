import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PanelHeightController } from "../../Assets/Scripts/DimOSSpecsClient/presentation/PanelHeightController";
class Vector {
  constructor(public x = 0, public y = 0, public z = 0) {}
  static up() { return new Vector(0, 1, 0); }
  add(v: Vector) { return new Vector(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v: Vector) { return new Vector(this.x - v.x, this.y - v.y, this.z - v.z); }
  uniformScale(s: number) { return new Vector(this.x * s, this.y * s, this.z * s); }
}
beforeEach(() => { vi.stubGlobal("vec3", Vector); vi.stubGlobal("vec2", Vector); });
afterEach(() => vi.unstubAllGlobals());
function harness() {
  let position = new Vector(), content = new Vector();
  let grab = () => {}, release = () => {};
  const frame = {
    transform: { getWorldPosition: () => position, setWorldPosition: (p: Vector) => { position = p; }, getWorldRotation: () => ({ multiplyVec3: (p: Vector) => p }) },
    onTranslationStart: { add: (fn: () => void) => { grab = fn; } }, onTranslationEnd: { add: (fn: () => void) => { release = fn; } },
    following: true, setFollowing(value: boolean) { this.following = value; },
    smoothFollow: { resize: vi.fn() }, border: 1, padding: new Vector(2, 2), innerSize: new Vector(86, 72),
  };
  const root = { getTransform: () => ({ setLocalPosition: (p: Vector) => { content = p; } }) };
  const controller = new PanelHeightController(frame as never, root as never, 0.4);
  return { frame, controller, position: () => position, content: () => content, grab: () => grab(), release: () => release() };
}
it("animates around a fixed top, retains width, and restores native following", () => {
  const h = harness(); h.controller.setVisible(true); h.controller.request(50);
  expect(h.frame.following).toBe(false);
  h.controller.tick(0.14);
  expect(h.controller.height).toBe(63);
  expect(h.position().y + h.controller.height * 0.2).toBeCloseTo(15.2);
  expect(h.position().y + h.content().y * 0.4).toBeCloseTo(0);
  h.controller.tick(0.14);
  expect(h.controller.height).toBe(50); expect(h.frame.innerSize.x).toBe(86);
  expect(h.frame.smoothFollow.resize).toHaveBeenLastCalledWith(36);
  expect(h.frame.following).toBe(true);
});
it("retargets without moving the top and settles hidden panels", () => {
  const h = harness(); h.controller.setVisible(true); h.controller.request(50); h.controller.tick(0.1);
  h.controller.request(70); h.controller.tick(0.28);
  expect(h.position().y + 70 * 0.2).toBeCloseTo(15.2);
  h.controller.request(55); h.controller.setVisible(false);
  expect(h.controller.height).toBe(55);
  h.controller.tick(1); expect(h.frame.following).toBe(false);
});
it("pauses for native grabbing and does not resume following after release", () => {
  const h = harness(); h.controller.setVisible(true); h.controller.request(50); h.controller.tick(0.1);
  h.grab(); const height = h.controller.height; h.controller.tick(1);
  expect(h.controller.height).toBe(height);
  h.release(); h.controller.tick(0.28);
  expect(h.controller.height).toBe(50); expect(h.frame.following).toBe(false);
});

it("keeps the native follow control usable through every height update", () => {
  const h = harness();
  let scale = new Vector(), position = new Vector();
  const button = { width: 3.25, getSceneObject: () => ({ getTransform: () => ({
    setLocalScale: (v: Vector) => { scale = v; }, setLocalPosition: (v: Vector) => { position = v; },
  }) }) };
  Object.assign(h.frame, { showFollowButton: true, followButton: button });
  h.controller.request(55);
  expect(button.width * scale.x).toBeCloseTo(7.2);
  expect(position.y + 3.6).toBeCloseTo(55 / 2 - 2);
  h.controller.setVisible(true); h.controller.request(68); h.controller.tick(0.14);
  expect(button.width * scale.x).toBeCloseTo(7.2);
  expect(position.y + 3.6).toBeCloseTo(h.controller.height / 2 - 2);
});
