import * as THREE from "three";
import { expect, it } from "vitest";
import { WebXRARMarkerPresenter } from "../src/presentation/WebXRARMarkerPresenter";

const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
it("keeps only a sphere at the exact annotation location and a glass label, and updates titles on upsert", () => {
  const presenter = new WebXRARMarkerPresenter();
  presenter.apply({ id: "dock", x: 2, y: 0, z: 0, title: "Docking point" }, origin);
  const object = presenter.object.children[0];
  expect(object.getObjectByName("World marker circle")).toBeUndefined();
  expect(object.getObjectByName("World marker dotted connector")).toBeUndefined();
  expect(object.children).toHaveLength(2);
  const sphere = object.getObjectByName("World marker indicator")!;
  presenter.update([0, 1.6, 0], 0.05);
  object.updateWorldMatrix(true, true);
  expect(sphere.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([0, 0, -2]);
  expect(object.getObjectByName("World marker label")?.children.some(child => child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial)).toBe(true);
  presenter.update([0, 1.6, 0], 0.18);
  expect(object.scale.x).toBe(1);
  expect(object.position.z).toBe(-2);
  presenter.apply({ id: "dock", x: 3, y: 0, z: 0, title: "New destination" }, origin);
  expect(presenter.object.children).toHaveLength(1);
  expect((object.getObjectByName("World marker title") as unknown as { text: string }).text).toBe("New destination");
  expect(object.position.z).toBe(-3);
  presenter.remove("dock"); expect(presenter.object.children).toHaveLength(0);
  presenter.dispose();
});
