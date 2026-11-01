import { ARM_FRESNEL_STYLE as STYLE, WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import * as THREE from "three";
import { fresnelMaterial } from "../presentation/PoseIndicatorMaterial";
/** Soft dotted silhouettes; the faint surface keeps the arm readable through dash gaps. */
export function armMaterial(thin = false): THREE.ShaderMaterial {
  const material = fresnelMaterial({
    fill: thin ? STYLE.toolFill : STYLE.fill,
    rim: thin ? STYLE.toolEdgeOpacity - STYLE.toolFill : STYLE.edgeOpacity - STYLE.fill,
    power: STYLE.power,
    color: STYLE.color,
    rimColor: STYLE.rimColor,
  });
  material.uniforms.uDash = { value: WORLD_DASH_STYLE.dashM };
  material.uniforms.uGap = { value: WORLD_DASH_STYLE.gapM };
  material.fragmentShader = material.fragmentShader.replace(
    "varying vec3 vNormal;",
    "uniform float uDash; uniform float uGap; varying vec3 vNormal;",
  ).replace(
    "      void main() {",
    `      float contourCoverage(vec3 position, vec3 normal, vec3 view) {
        vec3 tangent = cross(normal, view);
        float along = abs(tangent.x) > abs(tangent.y) ? position.x : position.y;
        float period = uDash + uGap;
        float pixel = max(length(dFdx(position)), length(dFdy(position)));
        float aa = max(fwidth(along), 0.00001);
        float phase = mod(along, period);
        float distance = min(phase, period - phase);
        float dash = 1.0 - smoothstep(uDash * 0.5 - aa, uDash * 0.5 + aa, distance);
        float solid = 1.0 - smoothstep(6.0, 10.0, period / max(pixel, 0.00001));
        return mix(dash, 1.0, solid);
      }
      void main() {`,
  ).replace(
    "rim * uRim",
    "rim * uRim * contourCoverage(-vView, normalize(vNormal), normalize(vView))",
  );
  material.userData.armVariant = thin ? "tool" : "arm";
  material.transparent = true;
  material.depthWrite = false;
  return material;
}
