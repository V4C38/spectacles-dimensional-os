import * as THREE from "three";
import { Text } from "troika-three-text";

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
      if (part instanceof Text) part.dispose();
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
