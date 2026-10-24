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
