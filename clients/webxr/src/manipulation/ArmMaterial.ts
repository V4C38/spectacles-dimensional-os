import * as THREE from "three";
import { fresnelMaterial } from "../presentation/PoseIndicatorMaterial";
/** Robot meshes and tool targets share the marker's Fresnel implementation. */
export function armMaterial(thin = false): THREE.ShaderMaterial {
  const material = fresnelMaterial({
    fill: thin ? 0.03 : 0.06,
    rim: thin ? 0.54 : 0.66,
    power: 2.5,
    color: 0xcbd9df,
    rimColor: 0xd9f0ff,
  });
  material.transparent = true;
  material.depthWrite = false;
  return material;
}
