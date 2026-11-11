import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { disposeTextResources } from "../src/presentation/TextResources";

it("disposes a fallback text canvas and its allocations", () => {
  const texture = new THREE.Texture(), material = new THREE.MeshBasicMaterial({ map: texture });
  const geometry = new THREE.PlaneGeometry();
  const checks = [texture, material, geometry].map(resource => vi.spyOn(resource, "dispose"));
  disposeTextResources(new THREE.Mesh(geometry, material));
  for (const check of checks) expect(check).toHaveBeenCalledOnce();
});

it("releases Troika's instance-owned base without disposing externally shared materials", () => {
  const shared = new THREE.MeshBasicMaterial(), own = new THREE.MeshBasicMaterial();
  const text = Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(), shared), { dispose: vi.fn(), _defaultMaterial: own });
  const ownDisposed = vi.spyOn(own, "dispose"), sharedDisposed = vi.spyOn(shared, "dispose");
  disposeTextResources(text);
  expect(text.dispose).toHaveBeenCalledOnce(); expect(ownDisposed).toHaveBeenCalledOnce();
  expect(sharedDisposed).not.toHaveBeenCalled();
});

import { Text } from "troika-three-text";
import { disposeObjectTrees } from "../src/manipulation/ObjectResources";
it("uses the same instance-material cleanup for text inside an object tree", () => {
  const root = new THREE.Group(), text = new Text(); root.add(text);
  // Force Troika to allocate its per-instance default material, as rendering does.
  void text.material;
  const owned = (text as unknown as { _defaultMaterial: THREE.Material })._defaultMaterial;
  const materialDispose = vi.spyOn(owned, "dispose"), textDispose = vi.spyOn(text, "dispose");
  disposeObjectTrees([root]);
  expect(textDispose).toHaveBeenCalledOnce();
  // The derived material invokes the base dispose function with a different receiver.
  expect(materialDispose.mock.contexts.filter(receiver => receiver === owned)).toHaveLength(1);
});
