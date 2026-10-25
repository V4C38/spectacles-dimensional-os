import * as THREE from "three";
import { expect, it } from "vitest";
import { MenuAnchorController } from "../src/input/MenuAnchorController";

it.each(["left", "right"] as const)("follows the summoning %s source and freezes on detach", handedness => {
  const anchor = new MenuAnchorController(), panel = new THREE.Group();
  const source = { handedness } as XRInputSource;
  const eye = new THREE.Vector3(0, 1.6, 0), sourcePosition = new THREE.Vector3(-0.2, 1.1, -0.3);
  anchor.attach(source, sourcePosition, eye, new THREE.Quaternion(), panel);
  expect(anchor.source).toBe(source);
  for (let i = 0; i < 60; i++) anchor.update(sourcePosition, eye, panel, 1 / 60);
  const start = panel.position.clone();
  anchor.update(sourcePosition.clone().add(new THREE.Vector3(0.2, 0, 0)), eye, panel, 1);
  expect(panel.position.x - start.x).toBeCloseTo(0.2);
  // Head movement changes readability, not the panel position.
  const moved = panel.position.clone();
  anchor.update(sourcePosition.clone().add(new THREE.Vector3(0.2, 0, 0)), eye.clone().add(new THREE.Vector3(0.4, 0, 0)), panel, 1);
  expect(panel.position.distanceTo(moved)).toBeLessThan(1e-6);
  anchor.detach();
  const pinned = panel.position.clone(), rotation = panel.quaternion.clone();
  anchor.update(new THREE.Vector3(3, 2, 1), eye, panel, 1);
  expect(panel.position).toEqual(pinned); expect(panel.quaternion.toArray()).toEqual(rotation.toArray());
  expect(anchor.source).toBeNull();
});

it("faces a moving viewer in yaw and pitch without roll or moving a pinned setup panel", () => {
  const anchor = new MenuAnchorController(), panel = new THREE.Group(); panel.position.set(0, 1, -0.5);
  const position = panel.position.clone();
  anchor.faceViewer(new THREE.Vector3(0.5, 1.8, 0), panel, 0.5);
  const angles = new THREE.Euler().setFromQuaternion(panel.quaternion, "YXZ");
  expect(Math.abs(angles.x)).toBeGreaterThan(0); expect(Math.abs(angles.y)).toBeGreaterThan(0); expect(angles.z).toBeCloseTo(0);
  expect(panel.position).toEqual(position);
});

it("raises palm menus another 8 cm without changing controller placement", () => {
  const eye = new THREE.Vector3(0, 1.6, 0), position = new THREE.Vector3(0, 1, -0.3);
  for (const hand of [false, true]) {
    const anchor = new MenuAnchorController(), panel = new THREE.Group();
    const source = { hand: hand ? {} : undefined } as XRInputSource;
    anchor.attach(source, position, eye, new THREE.Quaternion(), panel);
    anchor.update(position, eye, panel, 1);
    expect(panel.position.y - position.y).toBeCloseTo(hand ? 0.20 : 0.12);
    expect(panel.position.z - position.z).toBeCloseTo(-0.18);
  }
});
