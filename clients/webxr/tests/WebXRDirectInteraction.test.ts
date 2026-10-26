import * as THREE from "three";
import { expect, it } from "vitest";
import { WebXRDirectInteraction } from "../src/input/WebXRDirectInteraction";
import { registerRayTarget } from "../src/input/XRBlocksRayInteraction";
import type * as xb from "xrblocks";

it("resolves physical proximity on transformed shapes, retains a target and never switches capture modes", () => {
  const direct = new WebXRDirectInteraction(), scene = new THREE.Group(), source = new THREE.Group() as xb.SelectEvent["target"];
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.01)), b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.01));
  registerRayTarget(a); registerRayTarget(b); a.position.x = 0.2; b.position.x = 0.4; scene.add(a, b);
  direct.setPoint(source, new THREE.Vector3(0.2, 0, 0.02));
  expect(direct.resolve(source, scene, () => true)?.object).toBe(a);
  direct.capture(source, a); direct.setPoint(source, new THREE.Vector3(0.2, 0, 0.04));
  expect(direct.resolve(source, scene, () => true)?.object).toBe(a);
  direct.setPoint(source, new THREE.Vector3(0.4, 0, 0.02));
  expect(direct.resolve(source, scene, () => true)).toBeUndefined(); expect(direct.isDirect(source)).toBe(true);
  direct.cancel(); expect(direct.resolve(source, scene, () => true)?.object).toBe(b);
  direct.setPoint(source, null); expect(direct.hasLostCapture()).toBe(false);
  direct.capture(source, a); direct.setPoint(source, new THREE.Vector3(0.2, 0, 0));
  expect(direct.resolve(source, scene, () => true)).toBeUndefined();
  direct.cancel(); direct.resolve(source, scene, () => true); direct.capture(source, a);
  direct.setPoint(source, null); expect(direct.hasLostCapture()).toBe(true);
  direct.reset(); expect(direct.isDirect(source)).toBe(false);
});

it("rejects disabled targets and resolves menu before world targets", () => {
  const direct = new WebXRDirectInteraction(), scene = new THREE.Group(), source = new THREE.Group() as xb.SelectEvent["target"];
  const robot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5)), menu = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1));
  registerRayTarget(robot); registerRayTarget(menu); robot.userData.rayPriority = 20; scene.add(robot, menu);
  direct.setPoint(source, new THREE.Vector3(0, 0, 0.01));
  expect(direct.resolve(source, scene, () => true)?.object).toBe(menu);
  menu.userData.rayDisabled = true;
  expect(direct.resolve(source, scene, () => true)?.object).toBe(robot);
  expect(direct.resolve(source, scene, () => false)).toBeUndefined();
});

it("samples hand pinch centers and controller grip tips and detects missing joint tracking", () => {
  const direct = new WebXRDirectInteraction();
  const hand = new THREE.Group() as xb.SelectEvent["target"], controller = new THREE.Group() as xb.SelectEvent["target"];
  hand.inputSource = { hand: new Map([["index-finger-tip", "index"], ["thumb-tip", "thumb"]]) as unknown as XRHand };
  controller.inputSource = { gripSpace: {} as XRSpace };
  let tracked = true;
  const frame = {
    getJointPose: (joint: string) => tracked ? { transform: { position: { x: joint === "index" ? 0.02 : 0, y: 1, z: -0.2 } } } : null,
    getPose: () => ({ transform: { position: { x: 0, y: 1, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }),
  } as unknown as XRFrame;
  direct.sample(frame, {} as XRReferenceSpace, [hand, controller]);
  expect(direct.point(hand)?.toArray()).toEqual([0.01, 1, -0.2]);
  expect(direct.point(controller)?.toArray()).toEqual([0, 1, -0.06]);
  tracked = false; direct.sample(frame, {} as XRReferenceSpace, [hand, controller]);
  expect(direct.point(hand)).toBeUndefined();
});

it("keeps index fingertip contact available when the thumb is untracked", () => {
  const direct = new WebXRDirectInteraction(), hand = new THREE.Group() as xb.SelectEvent["target"];
  hand.inputSource = { hand: new Map([["index-finger-tip", "index"]]) as unknown as XRHand };
  const frame = { getJointPose: () => ({ transform: { position: { x: 1, y: 2, z: 3 } } }) } as unknown as XRFrame;
  direct.sample(frame, {} as XRReferenceSpace, [hand]);
  expect(direct.indexTip(hand)?.toArray()).toEqual([1, 2, 3]);
  expect(direct.point(hand)?.toArray()).toEqual([1, 2, 3]);
});
