import { expect, it } from "vitest";
import * as THREE from "three";
import { ViewerPanelPlacement } from "../src/presentation/ViewerPanelPlacement";
it("opens below eye level, follows translation and rotation, pins on grab, and recenters on reopening", () => {
  const placement = new ViewerPanelPlacement(), panel = new THREE.Group();
  const eye = new THREE.Vector3(0, 1.6, 0), rotation = new THREE.Quaternion();
  placement.begin(); placement.update(panel, eye, rotation, 0, true);
  expect(panel.position.toArray()).toEqual([0, 1.5, -0.9]);
  placement.update(panel, eye.clone().setX(1), rotation, 0.05);
  expect(panel.position.x).toBeGreaterThan(0); expect(panel.position.x).toBeLessThan(1);
  placement.pin(); const pinned = panel.position.clone();
  placement.update(panel, eye, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.5, 0.4)), 1);
  expect(panel.position).toEqual(pinned);
  placement.begin(); placement.update(panel, eye, rotation, 0, true);
  expect(panel.position.toArray()).toEqual([0, 1.5, -0.9]);
  expect(panel.rotation.z).toBeCloseTo(0);
});

it("smooths head movement consistently across frame rates", () => {
  const run = (fps: number) => {
    const placement = new ViewerPanelPlacement(), panel = new THREE.Group();
    const eye = new THREE.Vector3(0, 1.6, 0), orientation = new THREE.Quaternion();
    placement.update(panel, eye, orientation, 0, true);
    eye.x = 1;
    for (let frame = 0; frame < fps; frame++) placement.update(panel, eye, orientation, 1 / fps);
    return panel;
  };
  const a = run(30), b = run(90);
  expect(a.position.distanceTo(b.position)).toBeLessThan(1e-10);
  const placement = new ViewerPanelPlacement(), panel = new THREE.Group();
  placement.update(panel, new THREE.Vector3(0, 1.6, 0), new THREE.Quaternion(), 0, true);
  placement.update(panel, new THREE.Vector3(1, 1.6, 0), new THREE.Quaternion(), 0.05);
  expect(panel.position.x).toBeCloseTo(1 - Math.exp(-0.25), 7);
  expect(panel.position.x).toBeLessThan(0.25);
  const before = panel.quaternion.clone();
  const turned = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.5, 0));
  placement.update(panel, new THREE.Vector3(1, 1.6, 0), turned, 0.05);
  expect(panel.quaternion.angleTo(before)).toBeGreaterThan(0);
  expect(panel.quaternion.angleTo(before)).toBeLessThan(0.15);
});
