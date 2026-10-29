import * as THREE from "three";
import { fresnelMaterial } from "../presentation/PoseIndicatorMaterial";
/** Robot meshes and tool targets share the marker's Fresnel implementation. */
export function armMaterial(thin = false): THREE.ShaderMaterial {
  const material = fresnelMaterial({
    fill: thin ? 0.12 : 0.22,
    rim: thin ? 0.45 : 0.5,
    power: 1.8,
    color: 0xcbd9df,
    rimColor: 0xd9f0ff,
  });
  material.transparent = true;
  material.depthWrite = false;
  return material;
}
