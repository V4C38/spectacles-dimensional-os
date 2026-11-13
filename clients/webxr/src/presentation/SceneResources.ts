import regular from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import semibold from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import * as THREE from "three";
import { Text } from "troika-three-text";

// Troika parses woff but not woff2.
export const UI_FONT_REGULAR = regular;
export const UI_FONT_SEMIBOLD = semibold;

// Troika's render-time sync does not fire for these meshes in XR, so sync explicitly.
// It typesets in a worker, which unit test environments lack.
export function syncText(...texts: Text[]): void {
  if (typeof Worker === "undefined") return;
  for (const text of texts) text.sync();
}

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

/** Cloned model nodes share geometry and line materials. Dispose each resource once. */
export function disposeObjectTrees(
  roots: readonly THREE.Object3D[],
  extraMaterials: Iterable<THREE.Material> = [],
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set(extraMaterials);
  const textures = new Set<THREE.Texture>();
  for (const root of roots) {
    root.traverse((part) => {
      if (part instanceof Text) disposeTextResources(part);
      else if (part instanceof THREE.Mesh || part instanceof THREE.Line) {
        geometries.add(part.geometry);
        for (const material of Array.isArray(part.material)
          ? part.material
          : [part.material]) {
          materials.add(material);
        }
      }
    });
    root.removeFromParent();
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  });
  textures.forEach((texture) => texture.dispose());
}
