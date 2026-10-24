import * as THREE from "three";
import { expect, it } from "vitest";
import { proximityToAffordance } from "../src/input/AffordanceProximity";

it("uses angular and physical edge distances with hysteresis, including rotated controls", () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.02)); mesh.position.set(0, 0, -1); mesh.updateMatrixWorld(true);
  const ray = (x: number) => new THREE.Ray(new THREE.Vector3(x, 0, 0), new THREE.Vector3(0, 0, -1));
  expect(proximityToAffordance(ray(0.14), mesh, false, 20)).not.toBeNull();
  expect(proximityToAffordance(ray(0.16), mesh, false, 20)).toBeNull();
  expect(proximityToAffordance(ray(0.16), mesh, true, 20)).not.toBeNull();
  expect(proximityToAffordance(ray(0.19), mesh, true, 20)).toBeNull();
  mesh.position.z = -0.1; mesh.updateMatrixWorld(true);
  expect(proximityToAffordance(ray(0.12), mesh, false, 20)).toBeNull();
  mesh.position.z = 1; mesh.updateMatrixWorld(true);
  expect(proximityToAffordance(ray(0), mesh, true, 20)).toBeNull();
});

it("uses the circular navigation affordance rather than its square bounding box", () => {
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.018, 48)); marker.updateMatrixWorld(true);
  const ray = (x: number, z: number) => new THREE.Ray(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
  expect(proximityToAffordance(ray(0.31, 0), marker, false, 20)).not.toBeNull();
  expect(proximityToAffordance(ray(0.23, 0.23), marker, false, 20)).toBeNull();
});
