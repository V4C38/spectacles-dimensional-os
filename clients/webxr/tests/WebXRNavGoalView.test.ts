import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { WebXRNavGoalView } from "../src/navigation/WebXRNavGoalView";
import { NAVIGATION_CANCEL_STYLE, ROBOT_LINE_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";

it("renders a full-size confirmed draft using the robot-box dash pattern in physical metres", () => {
  const normal = new WebXRNavGoalView(), draft = new WebXRNavGoalView();
  normal.setSelected(true); normal.tick(1);
  draft.setSelected(true); draft.setAiming(true); draft.tick(1);
  const dashed = draft.object.getObjectByName("Navigation draft circle") as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  expect(draft.circleBounds().radius).toBeCloseTo(normal.circleBounds().radius);
  expect(draft.circleBounds().radius).toBeCloseTo(0.2144 * 1.15);
  expect(dashed.visible).toBe(true); expect(dashed.geometry.instanceCount).toBe(128);
  expect(dashed.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1);
  const point = dashed.geometry.getAttribute("instanceStart");
  expect(Math.hypot(point.getX(0), point.getZ(0)) + ROBOT_LINE_STYLE.selectedWidthM / 2).toBeCloseTo(draft.circleBounds().radius);
  expect(dashed.material.uniforms.uWidth.value).toBe(ROBOT_LINE_STYLE.selectedWidthM);
  expect(dashed.material.uniforms.uDash.value).toBe(ROBOT_LINE_STYLE.dashM);
  expect(dashed.material.uniforms.uGap.value).toBe(ROBOT_LINE_STYLE.gapM);
  expect(draft.object.getObjectByName("NavigationCircle")!.visible).toBe(false);
  expect(draft.object.getObjectByName("NavigationHeading")!.visible).toBe(true);
  normal.dispose(); draft.dispose();
});

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
  view.setCancelVisible(true); view.tick(NAVIGATION_CANCEL_STYLE.revealS);
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
  view.setCancelVisible(true); view.tick(NAVIGATION_CANCEL_STYLE.revealS); expect(view.object.getObjectByName("Navigation cancel connector")!.visible).toBe(true);
  view.setAiming(true); view.setCancelVisible(true); view.tick(1);
  expect(ring.material.opacity).toBeCloseTo(1); expect(ring.parent!.scale.x).toBeCloseTo(1);
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

it("rises from the circle center at zero scale and grows the dotted connector until Cancel arrives", () => {
  const view = new WebXRNavGoalView(); view.show(); view.setCancelVisible(true);
  const button = view.object.getObjectByName("Navigation cancel button")!;
  const connector = view.object.getObjectByName("Navigation cancel connector") as THREE.Mesh;
  const ring = view.object.getObjectByName("NavigationCircle")!;
  expect(button.position.y).toBeCloseTo(ring.position.y); expect(button.scale.x).toBe(0);
  expect(connector.visible).toBe(false);
  expect(view.cancelObject.userData.rayDisabled).toBe(true);
  view.tick(NAVIGATION_CANCEL_STYLE.revealS / 2);
  expect(button.position.y).toBeCloseTo((0.015 + 0.38) / 2); expect(button.scale.x).toBeCloseTo(0.5);
  expect(connector.visible).toBe(true);
  expect(connector.geometry.getAttribute("instanceStart").getY(0)).toBeCloseTo(0.015);
  expect(connector.geometry.getAttribute("instanceEnd").getY(0)).toBeCloseTo(0.145);
  // Viewer billboarding/hover updates must not overwrite the reveal scale.
  view.update(new THREE.Vector3(1, 1.6, 0), true);
  expect(button.scale.x).toBeCloseTo(0.5);
  expect(view.cancelObject.userData.rayDisabled).toBe(true);
  view.setCancelVisible(true); view.tick(NAVIGATION_CANCEL_STYLE.revealS / 2);
  expect(button.position.y).toBeCloseTo(0.38); expect(button.scale.x).toBeCloseTo(1);
  expect(view.cancelObject.userData.rayDisabled).toBe(false);
  expect(connector.geometry.getAttribute("instanceEnd").getY(0)).toBeCloseTo(0.275);
  view.hide(); view.show(); view.setCancelVisible(true);
  expect(button.scale.x).toBe(0); expect(button.position.y).toBeCloseTo(0.015);
  view.dispose();
});

it("draws the small pre-commit probe with physical dashes exactly at the laser endpoint", () => {
  const view = new WebXRNavGoalView(0.06);
  view.setProbe([1, 0.2, -2]);
  const circle = view.probe.getObjectByName("Navigation probe circle") as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  expect(circle.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([1, 0.2, -2]);
  expect(circle.geometry.instanceCount).toBe(128);
  const start = circle.geometry.getAttribute("instanceStart");
  expect(Math.hypot(start.getX(0), start.getZ(0)) + ROBOT_LINE_STYLE.selectedWidthM / 2).toBeCloseTo(0.06);
  expect(circle.material.uniforms.uDash.value).toBe(ROBOT_LINE_STYLE.dashM);
  expect(circle.material.uniforms.uGap.value).toBe(ROBOT_LINE_STYLE.gapM);
  view.setSharedOpacity(0.6); expect(circle.material.uniforms.uOpacity.value).toBe(0.6);
  view.dispose();
});

it("makes only the preview arrow thinner and less opaque while retaining its length", () => {
  const normal = new WebXRNavGoalView(), preview = new WebXRNavGoalView();
  normal.setSelected(true); normal.tick(1);
  preview.setSelected(true); preview.setAiming(true); preview.tick(1);
  const arrow = normal.object.getObjectByName("NavigationHeading") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const draft = preview.object.getObjectByName("NavigationHeading") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  expect(draft.scale.x).toBeCloseTo(arrow.scale.x * 0.8);
  expect(draft.scale.y).toBeCloseTo(arrow.scale.y);
  expect(draft.material.opacity).toBeCloseTo(arrow.material.opacity * 0.8);
  preview.setAiming(false); preview.tick(1);
  expect(draft.scale.x).toBeCloseTo(arrow.scale.x); expect(draft.material.opacity).toBeCloseTo(arrow.material.opacity);
  normal.dispose(); preview.dispose();
});

it("gives Cancel an opaque red body with the same reduced thickness as panel controls", () => {
  const view = new WebXRNavGoalView();
  view.show(); view.setCancelVisible(true); view.tick(1);
  const body = view.cancelObject.getObjectByName("Surface thickness") as THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshBasicMaterial>;
  expect(body).toBeDefined();
  body.geometry.computeBoundingBox();
  expect(body.geometry.boundingBox!.min.z).toBeCloseTo(-0.003825, 7);
  expect(body.geometry.boundingBox!.max.z).toBeCloseTo(0, 7);
  expect(body.material.opacity).toBe(1);
  expect(body.material.depthWrite).toBe(true);
  const tint = view.cancelObject.material.uniforms.uTint.value as THREE.Color;
  expect(body.material.color.r).toBeCloseTo(tint.r * 0.75, 7);
  expect(body.material.color.g).toBeCloseTo(tint.g * 0.75, 7);
  expect(body.material.color.b).toBeCloseTo(tint.b * 0.75, 7);
  const originalRed = body.material.color.r;
  view.update(new THREE.Vector3(0, 1.6, 1), true);
  expect(body.material.color.r).toBeGreaterThan(originalRed);
  expect(body.material.opacity).toBe(1);
  const hits: THREE.Intersection[] = [];
  body.raycast(new THREE.Raycaster(), hits);
  expect(hits).toEqual([]);
  const geometryDispose = vi.spyOn(body.geometry, "dispose");
  const materialDispose = vi.spyOn(body.material, "dispose");
  view.dispose();
  expect(geometryDispose).toHaveBeenCalledOnce();
  expect(materialDispose).toHaveBeenCalledOnce();
});
