// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import "./fixtures/xrEnvironment";

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
  f.controller.gestures.authorize(left, {});
  f.controller.gestures.begin({ kind: "navigation", source: left, fromMarker: true });
  f.internal.interaction.hit.mockReturnValue({ object: new THREE.Mesh(), point: new THREE.Vector3() });
  f.controller.onSelectStart({ target: right });
  expect(f.controller.gestures.owner).toBeNull();
  expect(f.controller.gestures.worldHold).toBeNull();
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
    f.controller.gestures.authorize(source, contact.object);
    end.mockImplementation(() => { expect(f.controller.gestures.owner).toBeNull(); });
    f.internal.dispatchTouch(source, contact, false, true);
    expect(f.client.loseInput).toHaveBeenCalled();
  } finally { start.mockRestore(); end.mockRestore(); f.controller.dispose(); }
});


it("lets Stop interrupt a different hand capture before dispatching the stop action", () => {
  const f = fixture();
  const left = new THREE.Group(), right = new THREE.Group();
  f.controller.gestures.authorize(left, {});
  f.internal.mainMenu.isEmergencyTarget = () => false;
  f.internal.canInteract = () => true;
  const stop = new THREE.Mesh(); stop.userData.manipulationAction = "stop";
  f.internal.interaction.hit.mockReturnValue({object: stop, point: new THREE.Vector3()});
  f.controller.onSelectStart({target: right});
  expect(f.controller.gestures.owner).toBeNull();
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
  f.controller.gestures.authorize(owner, {}); f.controller.gestures.begin({ kind: "arm", source: owner });
  f.internal.canInteract = () => true;
  const button = new THREE.Mesh(); button.userData.manipulationAction = "gripper";
  f.internal.interaction.hit.mockReturnValue({ object: button, point: new THREE.Vector3() });
  (f.client.manipulation as any).action = vi.fn();
  f.controller.onSelectStart({ target: other });
  f.controller.onSelectStart({ target: other });
  expect((f.client.manipulation as any).action).toHaveBeenCalledOnce();
  expect((f.client.manipulation as any).action).toHaveBeenCalledWith("gripper");
  f.controller.onSelectEnd({ target: other });
  expect(f.controller.gestures.owner).toBe(owner);
  expect(f.controller.gestures.manipulationHold).toBe(owner);
  expect(f.client.manipulation.end).not.toHaveBeenCalled();
  f.controller.dispose();
});

it("retires semantic capture on suspend without suspending domain owners twice", () => {
  const f = fixture();
  const owner = new THREE.Group();
  f.controller.gestures.authorize(owner, {});
  f.controller.gestures.begin({ kind: "navigation", source: owner, fromMarker: true });
  f.controller.gestures.finish("suspend", { releaseMechanisms: vi.fn(), notifyDomain: f.client.loseInput });
  expect(f.controller.gestures.owner).toBeNull();
  expect(f.controller.holdingWorld).toBeNull();
  expect(f.client.loseInput).not.toHaveBeenCalled();
  f.controller.dispose();
});

it("does not replay a held press after losing its source", () => {
  const f = fixture();
  expect(f.controller.gestures.observePress("left", true)).toBe(true);
  f.controller.gestures.finish("source-lost", { releaseMechanisms: vi.fn(), notifyDomain: f.client.loseInput });
  expect(f.controller.gestures.observePress("left", true)).toBe(false);
  f.controller.gestures.observePress("left", false);
  expect(f.controller.gestures.observePress("left", true)).toBe(true);
  f.controller.dispose();
});

it("rejects starting a semantic gesture for another input owner's authorization", () => {
  const f = fixture();
  const owner = new THREE.Group(), other = new THREE.Group();
  f.controller.gestures.authorize(owner, {});
  expect(f.controller.gestures.begin({ kind: "navigation", source: other, fromMarker: false })).toBe(false);
  expect(f.controller.holdingWorld).toBeNull();
  expect(f.controller.gestures.owner).toBe(owner);
  f.controller.dispose();
});

it("disposes safely before SDK initialization and releases resources only once", () => {
  const client = { loseInput: vi.fn() };
  const controller = new WebXRInputController(client as never, new THREE.Group(), {
    tracking: () => false, session: () => null,
  });
  const geometry = vi.spyOn(controller.floor.geometry, "dispose");
  const material = vi.spyOn(controller.floor.material as THREE.Material, "dispose");
  expect(() => { controller.dispose(); controller.dispose(); }).not.toThrow();
  expect(client.loseInput).toHaveBeenCalledOnce();
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
});

it("restores SDK hooks after initialization fails and keeps teardown idempotent", () => {
  const originalRaycast = vi.fn();
  const input = { performRaycastOnScene: originalRaycast, raycaster: new THREE.Raycaster() };
  const client = { loseInput: vi.fn() };
  const controller = new WebXRInputController(client as never, {
    add: () => { throw new Error("scene unavailable"); },
  } as never, { tracking: () => false, session: () => null });
  const geometry = vi.spyOn(controller.floor.geometry, "dispose");
  expect(() => controller.init({ input: input as never })).toThrow("scene unavailable");
  expect(input.performRaycastOnScene).not.toBe(originalRaycast);
  expect(() => { controller.dispose(); controller.dispose(); }).not.toThrow();
  expect(input.performRaycastOnScene).toBe(originalRaycast);
  expect(client.loseInput).toHaveBeenCalledOnce();
  expect(geometry).toHaveBeenCalledOnce();
});
