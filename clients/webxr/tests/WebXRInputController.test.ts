// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  class AudioContextStub {
    destination = {};
    createGain() { return { connect() {}, gain: { value: 1 } }; }
  }
  Object.defineProperty(window, "AudioContext", { value: AudioContextStub, configurable: true });
});
import * as THREE from "three";
import * as xb from "xrblocks";
import { WebXRInputController } from "../src/input/WebXRInputController";

function fixture() {
  const client = { manipulation: { end: vi.fn(), interrupt: vi.fn(), action: vi.fn() }, loseInput: vi.fn(), emergencyStop: vi.fn() };
  const controller = new WebXRInputController(client as never, new THREE.Group(), {
    tracking: () => true, session: () => ({ visibilityState: "visible" }) as XRSession,
  });
  const internal = controller as any;
  internal.interaction = { hit: vi.fn(), direct: { cancel() {} }, releaseCaptures() {}, dispose() {} };
  internal.mainMenu = { isEmergencyTarget: () => true, endManipulation() {}, dispose() {}, panel: new THREE.Group() };
  return { controller, internal, client };
}

it("interrupts another source's capture with one emergency stop on press", () => {
  const f = fixture();
  const left = new THREE.Group(), right = new THREE.Group();
  left.userData.id = 1; right.userData.id = 2;
  f.internal.capture.press(left, {});
  f.internal.worldHold = left;
  f.internal.interaction.hit.mockReturnValue({ object: new THREE.Mesh(), point: new THREE.Vector3() });
  f.controller.onSelectStart({ target: right });
  expect(f.internal.capture.owner).toBeNull();
  expect(f.internal.worldHold).toBeNull();
  expect(f.client.loseInput.mock.invocationCallOrder[0]).toBeLessThan(f.client.emergencyStop.mock.invocationCallOrder[0]);
  f.controller.onSelectEnd({ target: right });
  expect(f.client.emergencyStop).toHaveBeenCalledOnce();
  f.controller.dispose();
});

it("preserves native touch release ordering and retires authorization before a cancelled release", () => {
  const f = fixture();
  const events: string[] = [];
  const source = new THREE.Group(); source.userData.id = 1;
  const contact = { object: new THREE.Mesh(), point: new THREE.Vector3(), distance: 0 };
  f.internal.input = { defaultOnSelectStart: () => events.push("input-start"), defaultOnSelectEnd: () => events.push("input-end"),
    intersectionsForController: { set: () => events.push("contact") } };
  const start = vi.spyOn(xb.core.user, "onSelectStart").mockImplementation(() => { events.push("sdk-start"); });
  const end = vi.spyOn(xb.core.user, "onSelectEnd").mockImplementation(() => { events.push("sdk-end"); });
  vi.spyOn(f.controller, "onSelectStart").mockImplementation(() => { events.push("app-start"); });
  vi.spyOn(f.controller, "onSelectEnd").mockImplementation(() => { events.push("app-end"); });
  try {
    f.internal.dispatchTouch(source, contact, true, false);
    expect(events).toEqual(["input-start", "contact", "sdk-start", "app-start"]);
    events.length = 0;
    f.internal.dispatchTouch(source, contact, false, false);
    expect(events).toEqual(["input-end", "contact", "sdk-start", "sdk-end", "app-end"]);
    f.internal.capture.press(source, contact.object);
    end.mockImplementation(() => { expect(f.internal.capture.owner).toBeNull(); });
    f.internal.dispatchTouch(source, contact, false, true);
    expect(f.client.loseInput).toHaveBeenCalled();
  } finally { start.mockRestore(); end.mockRestore(); f.controller.dispose(); }
});


it("lets Stop interrupt a different hand capture before dispatching the stop action", () => {
  const f = fixture();
  const left = new THREE.Group(), right = new THREE.Group();
  f.internal.capture.press(left, {});
  f.internal.mainMenu.isEmergencyTarget = () => false;
  f.internal.canInteract = () => true;
  const stop = new THREE.Mesh(); stop.userData.manipulationAction = "stop";
  f.internal.interaction.hit.mockReturnValue({object: stop, point: new THREE.Vector3()});
  f.controller.onSelectStart({target: right});
  expect(f.internal.capture.owner).toBeNull();
  expect(f.client.manipulation.interrupt).not.toHaveBeenCalled();
  expect(f.client.manipulation.action).toHaveBeenCalledWith("stop");
  expect(f.client.emergencyStop).not.toHaveBeenCalled();
  f.controller.dispose();
});

it("lets the other hand toggle the gripper without ending the owner's drag", () => {
  const f = fixture();
  f.internal.mainMenu.isEmergencyTarget = () => false;
  const owner = new THREE.Group(), other = new THREE.Group();
  owner.userData.id = 1; other.userData.id = 2;
  (other as any).inputSource = { hand: {}, handedness: "left" };
  f.internal.capture.press(owner, {}); f.internal.manipulationHold = owner;
  f.internal.canInteract = () => true;
  const button = new THREE.Mesh(); button.userData.manipulationAction = "gripper";
  f.internal.interaction.hit.mockReturnValue({ object: button, point: new THREE.Vector3() });
  (f.client.manipulation as any).action = vi.fn();
  f.controller.onSelectStart({ target: other });
  f.controller.onSelectStart({ target: other });
  expect((f.client.manipulation as any).action).toHaveBeenCalledOnce();
  expect((f.client.manipulation as any).action).toHaveBeenCalledWith("gripper");
  f.controller.onSelectEnd({ target: other });
  expect(f.internal.capture.owner).toBe(owner);
  expect(f.internal.manipulationHold).toBe(owner);
  expect(f.client.manipulation.end).not.toHaveBeenCalled();
  f.controller.dispose();
});
