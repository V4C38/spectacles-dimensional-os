import * as THREE from "three";

/** Troika owns glyph geometry and a per-instance default material; its font atlas is shared. */
export function disposeTextResources(object: THREE.Mesh | undefined): void {
  if (!object) return;
  const text = object as THREE.Mesh & { dispose?: () => void; _defaultMaterial?: THREE.Material };
  if (text.dispose) {
    text.dispose();
    // Troika intentionally leaves base materials to the caller. Dispose only its
    // instance-owned clone, never an externally supplied/shared base or font atlas.
    text._defaultMaterial?.dispose();
    return;
  }
  // XR Blocks can fall back to its own canvas mesh when SDF rendering is unavailable.
  object.geometry.dispose();
  const textures = new Set<THREE.Texture>();
  for (const material of new Set(Array.isArray(object.material) ? object.material : [object.material])) {
    const map = (material as THREE.MeshBasicMaterial).map;
    if (map) textures.add(map);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}
