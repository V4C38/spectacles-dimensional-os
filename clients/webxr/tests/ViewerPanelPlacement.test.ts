import { expect, it } from "vitest";
import * as THREE from "three";
import { ViewerPanelPlacement } from "../src/presentation/ViewerPanelPlacement";
it("opens centered, follows translation and rotation, pins on grab, and recenters on reopening", () => {
  const placement = new ViewerPanelPlacement(), panel = new THREE.Group();
  const eye = new THREE.Vector3(0, 1.6, 0), rotation = new THREE.Quaternion();
  placement.begin(); placement.update(panel, eye, rotation, 0, true);
  expect(panel.position.toArray()).toEqual([0, 1.6, -0.9]);
  placement.update(panel, eye.clone().setX(1), rotation, 0.05);
  expect(panel.position.x).toBeGreaterThan(0); expect(panel.position.x).toBeLessThan(1);
  placement.pin(); const pinned = panel.position.clone();
  placement.update(panel, eye, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.5, 0.4)), 1);
  expect(panel.position).toEqual(pinned);
  placement.begin(); placement.update(panel, eye, rotation, 0, true);
  expect(panel.position.toArray()).toEqual([0, 1.6, -0.9]);
  expect(panel.rotation.z).toBeCloseTo(0);
});
