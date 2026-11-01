import { ARM_VISUAL_STYLE as STYLE } from "@dimos-ar-client/manipulation/ManipulationVisuals";
import * as THREE from "three";

export function armMaterial(thin = false): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uColor: { value: new THREE.Color(STYLE.color) } },
    vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, ${STYLE.fill} * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  material.userData.armVariant = thin ? "tool" : "arm";
  return material;
}
