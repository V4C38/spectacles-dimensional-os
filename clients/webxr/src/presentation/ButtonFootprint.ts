import * as THREE from "three";

/** A soft shadow on the supporting plane, sized and offset in physical metres. */
export class ButtonFootprint extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  constructor(private readonly width: number, private readonly height: number, private readonly radius: number) {
    super(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec2 uPlaneSize;
        uniform vec2 uSize;
        uniform float uRadius;
        uniform float uBlur;
        uniform float uOpacity;
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * uPlaneSize;
          vec2 q = abs(p) - uSize * 0.5 + uRadius;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
          float edge = max(uBlur, fwidth(d));
          float coverage = 1.0 - smoothstep(-edge, edge, d);
          if (coverage <= 0.0) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.14 * coverage * uOpacity * uStrength);
          #include <colorspace_fragment>
        }
      `,
      uniforms: {
        uPlaneSize: { value: new THREE.Vector2() },
        uSize: { value: new THREE.Vector2() },
        uRadius: { value: 0 },
        uBlur: { value: 0.00008 },
        uOpacity: { value: 1 },
        uStrength: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }));
    this.name = "Button footprint";
    this.raycast = () => {};
  }

  setLift(metres: number, worldScale: THREE.Vector3): void {
    const lift = Math.max(0, metres);
    this.visible = lift > 0.000001;
    this.material.uniforms.uStrength.value = Math.min(1, lift / 0.003);
    const spread = lift * 0.15;
    const blur = 0.00008 + lift * 0.18;
    const width = this.width * worldScale.x + spread * 2;
    const height = this.height * worldScale.y + spread * 2;
    // Leave room outside the silhouette so the blurred edge never clips to the quad.
    const planeWidth = width + blur * 4, planeHeight = height + blur * 4;
    this.scale.set(planeWidth / Math.max(1e-6, worldScale.x), planeHeight / Math.max(1e-6, worldScale.y), 1);
    this.position.x = lift * 0.1 / Math.max(1e-6, worldScale.x);
    this.position.y = -lift * 0.22 / Math.max(1e-6, worldScale.y);
    this.material.uniforms.uPlaneSize.value.set(planeWidth, planeHeight);
    this.material.uniforms.uSize.value.set(width, height);
    this.material.uniforms.uRadius.value = Math.min(this.radius * Math.min(worldScale.x, worldScale.y) + spread, width / 2, height / 2);
    this.material.uniforms.uBlur.value = blur;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
