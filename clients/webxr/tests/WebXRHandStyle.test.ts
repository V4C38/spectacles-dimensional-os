import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { WebXRHandStyle } from "../src/input/WebXRHandStyle";

it("restores borrowed SDK meshes and permits styling again after teardown", () => {
  const hand = new THREE.Group();
  const material = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const geometry = new THREE.BoxGeometry();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(new THREE.Skeleton([]));
  mesh.frustumCulled = true; mesh.renderOrder = 7; hand.add(mesh);
  const borrowed = [geometry, ...material].map(resource => vi.spyOn(resource, "dispose"));
  const style = new WebXRHandStyle();
  style.apply([hand]); style.apply([hand]);
  expect(hand.children).toHaveLength(2);
  const depth = hand.children.find(child => child !== mesh) as THREE.SkinnedMesh;
  const owned = [(mesh as THREE.SkinnedMesh).material as THREE.Material, depth.material as THREE.Material]
    .map(resource => vi.spyOn(resource, "dispose"));
  style.dispose(); style.dispose();
  expect(hand.children).toEqual([mesh]);
  expect(mesh.material).toBe(material);
  expect(mesh.frustumCulled).toBe(true); expect(mesh.renderOrder).toBe(7);
  for (const spy of borrowed) expect(spy).not.toHaveBeenCalled();
  for (const spy of owned) expect(spy).toHaveBeenCalledOnce();
  const next = new WebXRHandStyle(); next.apply([hand]);
  expect(hand.children).toHaveLength(2);
  expect(mesh.material).not.toBe(material); next.dispose();
  geometry.dispose(); for (const item of material) item.dispose();
});
