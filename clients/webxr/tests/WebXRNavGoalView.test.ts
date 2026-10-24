import { expect, it } from "vitest";
import * as THREE from "three";
import { WebXRNavGoalView } from "../src/navigation/WebXRNavGoalView";

it("dims the unselected marker independently of active goals and turns red on cancel", () => {
  const view = new WebXRNavGoalView();
  const ring = view.object.getObjectByName("NavigationCircle") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(ring.material.opacity).toBeCloseTo(0.25);
  view.setGoalActive(true);
  expect(ring.material.opacity).toBeCloseTo(0.25);
  view.setSelected(true); view.tick(1);
  expect(ring.material.opacity).toBeCloseTo(0.5);
  view.setFlash("cancelled");
  expect(ring.material.color.getHex()).toBe(0xff453a);
  view.setSelected(false);
  view.setFlash(null); view.tick(1);
  expect(ring.material.color.getHex()).toBe(0xffffff);
  expect(ring.material.opacity).toBeCloseTo(0.25);
  view.dispose();
});

it("shows the round cancel button above the goal facing the viewer regardless of heading", () => {
  const view = new WebXRNavGoalView();
  view.show();
  view.setCancelVisible(true);
  expect(view.cancelVisible()).toBe(true);
  view.setPose([0, 0, -2], [0, Math.sin(1.1), 0, Math.cos(1.1)]);
  const eye = new THREE.Vector3(1, 1.6, 0);
  view.update(eye, false);
  view.object.updateMatrixWorld(true);
  const center = view.cancelObject.getWorldPosition(new THREE.Vector3());
  expect(center.y).toBeGreaterThan(0.3);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(view.cancelObject.getWorldQuaternion(new THREE.Quaternion()));
  const toEye = eye.clone().sub(center).setY(0).normalize();
  expect(facing.dot(toEye)).toBeCloseTo(1, 5);
  expect(facing.y).toBeCloseTo(0, 5);
  view.hide();
  expect(view.cancelVisible()).toBe(false);
  view.dispose();
});

it("animates idle, hover, drag and following states without moving the hit surface or goal", () => {
  const view = new WebXRNavGoalView(); view.show();
  const ring = view.object.getObjectByName("NavigationCircle") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const arrow = view.object.getObjectByName("NavigationHeading")!;
  const hit = view.object.getObjectByName("Navigation hit surface")!;
  view.setHovered(true); view.tick(0.03);
  expect(ring.material.opacity).toBeGreaterThan(0.25); expect(ring.material.opacity).toBeLessThan(0.5);
  view.tick(1); expect(ring.material.opacity).toBeCloseTo(0.5); expect(ring.parent!.scale.x).toBeCloseTo(1.04);
  view.setInteraction(true, true); view.tick(1); expect(ring.material.opacity).toBeCloseTo(0.75);
  view.setInteraction(false, true); view.setHovered(false); view.tick(0.6);
  expect(ring.material.opacity).toBeCloseTo(1); expect(arrow.position.z).toBeLessThan(0); expect(ring.scale.x).toBeGreaterThan(1);
  expect(view.pose().position).toEqual([0, 0, 0]); expect(hit.scale.x).toBe(1);
  view.setCancelVisible(true); expect(view.object.getObjectByName("Navigation cancel connector")!.visible).toBe(true);
  view.setAiming(true); view.setCancelVisible(true); view.tick(1);
  expect(ring.material.opacity).toBeCloseTo(0.25); expect(ring.parent!.scale.x).toBeCloseTo(0.85);
  expect(view.cancelVisible()).toBe(false); expect(view.object.getObjectByName("Navigation cancel connector")!.visible).toBe(false);
  view.dispose();
});
