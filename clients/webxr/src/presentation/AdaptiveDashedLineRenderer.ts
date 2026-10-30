import * as THREE from "three";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";

/** Camera-facing strokes with a pixel floor and an antialiased dash-to-solid distance transition. */
export class AdaptiveDashedLineRenderer {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly viewport = new THREE.Vector4();

  constructor(widthM: number = WORLD_DASH_STYLE.widthM, dashM: number = WORLD_DASH_STYLE.dashM, gapM: number = WORLD_DASH_STYLE.gapM) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      uniforms: { uViewport: { value: new THREE.Vector2(1, 1) }, uWidth: { value: widthM }, uNearWidthScale: { value: WORLD_DASH_STYLE.nearWidthScale }, uDash: { value: dashM }, uGap: { value: gapM }, uOpacity: { value: 0.7 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `
        attribute vec3 instanceStart; attribute vec3 instanceEnd; attribute float instanceDistance;
        uniform vec2 uViewport; uniform float uWidth;
        uniform float uDash; uniform float uGap; uniform float uNearWidthScale;
        varying float vAcross; varying float vDistance; varying float vPixelM; varying float vHalfWidth;
        void main() {
          vec3 a = (modelViewMatrix * vec4(instanceStart, 1.0)).xyz;
          vec3 b = (modelViewMatrix * vec4(instanceEnd, 1.0)).xyz;
          vec4 ca = projectionMatrix * vec4(a, 1.0), cb = projectionMatrix * vec4(b, 1.0);
          vec2 direction = (cb.xy / max(abs(cb.w), 0.0001) - ca.xy / max(abs(ca.w), 0.0001)) * uViewport;
          vec2 normal = vec2(-direction.y, direction.x) / max(length(direction), 0.0001);
          vec3 p = mix(a, b, position.y);
          float pixelM = 2.0 * mix(1.0, max(0.001, -p.z), abs(projectionMatrix[2][3])) / max(0.0001, abs(projectionMatrix[1][1]) * uViewport.y);
          float resolutionBlend = 1.0 - smoothstep(6.0, 10.0, (uDash + uGap) / max(pixelM, 0.00001));
          float widthScale = mix(uNearWidthScale, 1.0, resolutionBlend);
          float halfWidth = max(uWidth, 2.0 * pixelM) * widthScale * 0.5;
          vec4 clip = projectionMatrix * vec4(p, 1.0);
          clip.xy += normal * position.x * (halfWidth / pixelM + 1.0) * 2.0 / uViewport * clip.w;
          gl_Position = clip;
          vAcross = position.x * (halfWidth + pixelM);
          vDistance = instanceDistance + position.y * length(instanceEnd - instanceStart);
          vPixelM = pixelM; vHalfWidth = halfWidth;
        }`,
      fragmentShader: `
        uniform float uDash; uniform float uGap; uniform float uOpacity;
        varying float vAcross; varying float vDistance; varying float vPixelM; varying float vHalfWidth;
        void main() {
          float period = max(0.0001, uDash + uGap);
          float phase = mod(vDistance, period);
          float along = min(phase, period - phase);
          float cap = max(0.0, along - max(0.0, uDash * 0.5 - vHalfWidth));
          float aa = max(vPixelM * 0.65, fwidth(vAcross));
          float dash = 1.0 - smoothstep(-aa, aa, length(vec2(vAcross, cap)) - vHalfWidth);
          float solid = 1.0 - smoothstep(-aa, aa, abs(vAcross) - vHalfWidth);
          float blend = 1.0 - smoothstep(6.0, 10.0, period / max(vPixelM, 0.00001));
          float coverage = mix(dash, solid, blend);
          if (coverage < 0.001) discard;
          gl_FragColor = vec4(vec3(1.0), uOpacity * coverage);
          #include <colorspace_fragment>
        }`,
    });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = "Adaptive dashed line";
    this.object.frustumCulled = false;
    this.object.raycast = () => {};
    this.object.onBeforeRender = renderer => {
      renderer.getCurrentViewport(this.viewport);
      material.uniforms.uViewport.value.set(Math.max(1, this.viewport.z), Math.max(1, this.viewport.w));
    };
  }

  setStyle(widthM: number, opacity: number): void {
    this.object.material.uniforms.uWidth.value = widthM;
    this.object.material.uniforms.uOpacity.value = opacity;
    this.object.material.opacity = opacity;
  }

  setSegments(points: readonly Vec3[], continuous = false): void {
    const count = Math.floor(points.length / 2);
    let geometry = this.object.geometry;
    if (geometry.instanceCount !== count && geometry.getAttribute("instanceStart")) {
      // Three caches an instanced geometry's initial GPU capacity. Retire that cache
      // when a path grows or shrinks, including a later regrowth.
      const next = new THREE.InstancedBufferGeometry();
      next.setAttribute("position", geometry.getAttribute("position"));
      next.setIndex(geometry.index);
      geometry.dispose(); this.object.geometry = geometry = next;
    }
    if (geometry.instanceCount !== count || !geometry.getAttribute("instanceStart")) {
      geometry.setAttribute("instanceStart", new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute("instanceEnd", new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute("instanceDistance", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
      geometry.instanceCount = count;
    }
    const start = geometry.getAttribute("instanceStart"), end = geometry.getAttribute("instanceEnd"), distance = geometry.getAttribute("instanceDistance");
    let offset = 0;
    for (let i = 0; i < count; i++) {
      start.setXYZ(i, ...points[i * 2]); end.setXYZ(i, ...points[i * 2 + 1]); distance.setX(i, continuous ? offset : 0);
      offset += Math.hypot(...points[i * 2].map((v, axis) => v - points[i * 2 + 1][axis]));
    }
    start.needsUpdate = end.needsUpdate = distance.needsUpdate = true;
  }

  dispose(): void { this.object.removeFromParent(); this.object.geometry.dispose(); this.object.material.dispose(); }
}
