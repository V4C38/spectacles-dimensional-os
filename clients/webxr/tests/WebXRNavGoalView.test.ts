import { expect, it } from "vitest";
import * as THREE from "three";
import { WebXRNavGoalView } from "../src/navigation/WebXRNavGoalView";

it("dims the idle marker, fills it for an active goal and turns red on cancel", () => {
  const view = new WebXRNavGoalView();
  const ring = view.object.getObjectByName("NavigationCircle") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(ring.material.opacity).toBe(0.5);
  view.setGoalActive(true);
  expect(ring.material.opacity).toBe(1);
  view.setFlash("cancelled");
  expect(ring.material.color.getHex()).toBe(0xff453a);
  view.setFlash(null);
  expect(ring.material.color.getHex()).toBe(0xffffff);
  expect(ring.material.opacity).toBe(0.5);
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
