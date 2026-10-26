import { expect, it } from "vitest";
import * as THREE from "three";
import { WebXRNavGoalView } from "../src/navigation/WebXRNavGoalView";

it("dims the unselected marker independently of active goals and turns red on cancel", () => {
  const view = new WebXRNavGoalView();
  const ring = view.object.getObjectByName("NavigationCircle") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(ring.material.opacity).toBeCloseTo(0.35);
  view.setGoalActive(true);
  expect(ring.material.opacity).toBeCloseTo(0.35);
  view.setSelected(true); view.tick(1);
  expect(ring.material.opacity).toBeCloseTo(0.6);
  view.setFlash("cancelled", 0.2);
  const outcome = view.object.getObjectByName("Navigation outcome ring") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(outcome.material.color.getHex()).toBe(0xff453a);
  expect(outcome.geometry.drawRange.count).toBeGreaterThan(0);
  expect(outcome.geometry.drawRange.count).toBeLessThan(128 * 6);
  expect(view.object.getObjectByName("NavigationHeading")!.visible).toBe(false);
  view.setSelected(false);
  view.setFlash(null); view.tick(1);
  expect(ring.material.color.getHex()).toBe(0xffffff);
  expect(ring.material.opacity).toBeCloseTo(0.35);
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
  expect(ring.material.opacity).toBeGreaterThan(0.35); expect(ring.material.opacity).toBeLessThan(0.6);
  view.tick(1); expect(ring.material.opacity).toBeCloseTo(0.6); expect(ring.parent!.scale.x).toBeCloseTo(1.04);
  view.setInteraction(true, true); view.tick(1); expect(ring.material.opacity).toBeCloseTo(0.85);
  view.setInteraction(false, true); view.setHovered(false); view.tick(0.6);
  expect(ring.material.opacity).toBeCloseTo(1); expect(arrow.position.z).toBeLessThan(0); expect(ring.scale.x).toBeGreaterThan(1);
  expect(view.pose().position).toEqual([0, 0, 0]); expect(hit.scale.x).toBe(1);
  view.setCancelVisible(true); expect(view.object.getObjectByName("Navigation cancel connector")!.visible).toBe(true);
  view.setAiming(true); view.setCancelVisible(true); view.tick(1);
  expect(ring.material.opacity).toBeCloseTo(1); expect(ring.parent!.scale.x).toBeCloseTo(0.85);
  expect(view.cancelVisible()).toBe(false); expect(view.object.getObjectByName("Navigation cancel connector")!.visible).toBe(false);
  view.dispose();
});

it.each(["succeeded", "cancelled"] as const)("builds the %s circle and glyph before restoring the arrow", flash => {
  const view = new WebXRNavGoalView(); view.show(); view.setFlash(flash, 0);
  const ring = view.object.getObjectByName("Navigation outcome ring") as THREE.Mesh;
  const stroke = view.object.getObjectByName("Navigation outcome stroke 0")!;
  expect(ring.geometry.drawRange.count).toBe(0); expect(stroke.scale.x).toBe(0);
  view.setFlash(flash, 0.7); expect(ring.geometry.drawRange.count).toBe(768);
  expect(stroke.scale.x).toBeGreaterThan(0);
  view.setFlash(null); expect(ring.visible).toBe(false);
  expect(view.object.getObjectByName("NavigationHeading")!.visible).toBe(true); view.dispose();
});

it.each(["succeeded", "cancelled"] as const)("keeps the %s glyph flat and facing the moving viewer without changing the goal heading", flash => {
  const view = new WebXRNavGoalView(); view.show();
  view.setPose([1, 0, -2], [0, Math.sin(0.65), 0, Math.cos(0.65)]);
  view.setFlash(flash, 0.9);
  const arrow = view.object.getObjectByName("NavigationHeading")!;
  const circle = view.object.getObjectByName("NavigationCircle")!;
  const glyph = view.object.getObjectByName("Navigation outcome glyph")!;
  const before = view.pose();
  const arrowRotation = arrow.getWorldQuaternion(new THREE.Quaternion());
  const circleRotation = circle.getWorldQuaternion(new THREE.Quaternion());
  for (const eye of [new THREE.Vector3(3, 1.6, -1), new THREE.Vector3(-2, 1.6, -3)]) {
    view.update(eye, false); view.object.updateWorldMatrix(true, true);
    const top = new THREE.Vector3(0, 0, -1).applyQuaternion(glyph.getWorldQuaternion(new THREE.Quaternion()));
    const away = glyph.getWorldPosition(new THREE.Vector3()).sub(eye).setY(0).normalize();
    expect(top.dot(away)).toBeCloseTo(1);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(glyph.getWorldQuaternion(new THREE.Quaternion()));
    expect(normal.y).toBeCloseTo(1);
    expect(view.pose()).toEqual(before);
    expect(arrow.getWorldQuaternion(new THREE.Quaternion()).angleTo(arrowRotation)).toBeCloseTo(0);
    expect(circle.getWorldQuaternion(new THREE.Quaternion()).angleTo(circleRotation)).toBeCloseTo(0);
  }
  view.setFlash(null); view.update(new THREE.Vector3(10, 1.6, 5), false);
  expect(arrow.visible).toBe(true);
  expect(arrow.getWorldQuaternion(new THREE.Quaternion()).angleTo(arrowRotation)).toBeCloseTo(0);
  view.dispose();
});

it("keeps the animated checkmark elbow closed without adding a dot to the cross", () => {
  const view = new WebXRNavGoalView();
  const joint = view.object.getObjectByName("Navigation outcome stroke join") as THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  view.setFlash("succeeded", 0.1);
  expect(joint.visible).toBe(false);
  view.setFlash("succeeded", 1);
  expect(joint.visible).toBe(true);
  expect(joint.geometry.parameters.radius).toBeCloseTo(0.006);
  expect(joint.position.x).toBeCloseTo(-0.015);
  expect(joint.position.z).toBeCloseTo(0.055);
  expect(joint.material.color.getHex()).toBe(0x30d158);
  view.setFlash("cancelled", 1);
  expect(joint.visible).toBe(false);
  view.dispose();
});
