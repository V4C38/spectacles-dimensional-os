import * as THREE from "three";
import { cornerRadius } from "./DimOSARDesign";

export type GlassOptions = {
  width: number;
  height: number;
  radius?: number;
  thickness?: number;
  tint?: string;
  alpha?: number;
  rim?: number;
  rimWidth?: number;
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    vUv = uv;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = view.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * view;
  }
`;

// Passthrough is not readable from WebGL, so glass is approximated in one pass:
// tinted fill, top-lit rim, and a fresnel lift at grazing angles.
const fragmentShader = /* glsl */ `
  uniform vec2 uSize;
  uniform float uRadius;
  uniform vec3 uTint;
  uniform float uAlpha;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uRim;
  uniform float uRimWidth;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = roundedBox(p, uSize * 0.5, uRadius);
    float aa = max(fwidth(d), 1e-5);
    float coverage = clamp(0.5 - d / aa, 0.0, 1.0);
    if (coverage <= 0.0) discard;
    float fresnel = pow(1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPosition))), 3.0);
    float rim = (1.0 - smoothstep(0.0, uRimWidth, -d)) * mix(0.3, 1.0, vUv.y);
    float alpha = clamp(uAlpha + uHover * 0.1 + fresnel * 0.12, 0.0, 1.0);
    vec3 fill = uTint * mix(0.82, 1.18, vUv.y) + vec3(uHover * 0.12);
    vec3 light = vec3(rim * uRim + fresnel * 0.06);
    float outAlpha = clamp(alpha + rim * uRim * 0.5, 0.0, 1.0);
    // Straight alpha: encoding premultiplied color to sRGB would inflate faint fills.
    gl_FragColor = vec4((fill * alpha + light) / max(outAlpha, 1e-4), outAlpha * coverage * uOpacity);
    #include <colorspace_fragment>
  }
`;

export function glassMaterial(options: GlassOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uSize: { value: new THREE.Vector2(options.width, options.height) },
      uRadius: { value: Math.min(options.radius ?? cornerRadius(options.width, options.height), options.width / 2, options.height / 2) },
      uTint: { value: new THREE.Color(options.tint ?? "#161618") },
      uAlpha: { value: options.alpha ?? 0.72 },
      uOpacity: { value: 1 },
      uHover: { value: 0 },
      uRim: { value: options.rim ?? 0.22 },
      uRimWidth: { value: options.rimWidth ?? Math.min(options.width, options.height) * 0.04 },
    },
    transparent: true,
    // Panels occlude other UI behind them; the discard keeps rounded corners clear.
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

export class GlassSurface extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  private hoverTarget = 0;
  private readonly backing: ReturnType<typeof surfaceBacking> | null;
  private readonly thickness: number;

  constructor(options: GlassOptions) {
    super(new THREE.PlaneGeometry(options.width, options.height), glassMaterial(options));
    this.thickness = options.thickness ?? 0;
    this.backing = this.thickness ? surfaceBacking(options.width, options.height, options.radius ?? cornerRadius(options.width, options.height), this.thickness) : null;
    if (this.backing) this.add(this.backing);
  }

  resize(width: number, height: number, radius = cornerRadius(width, height)): void {
    const size = this.material.uniforms.uSize.value as THREE.Vector2;
    radius = Math.min(radius, width / 2, height / 2);
    if (size.x === width && size.y === height && this.material.uniforms.uRadius.value === radius) return;
    this.geometry.dispose();
    this.geometry = new THREE.PlaneGeometry(width, height);
    this.material.uniforms.uSize.value.set(width, height);
    this.material.uniforms.uRadius.value = radius;
    if (this.backing) {
      this.backing.geometry.dispose();
      this.backing.geometry = roundedSurfaceGeometry(width, height, this.material.uniforms.uRadius.value, this.thickness);
    }
  }

  setWorldThickness(metres: number): void {
    if (this.backing && this.thickness) this.backing.scale.z = metres / Math.max(1e-6, this.thickness * this.getWorldScale(new THREE.Vector3()).z);
  }

  setOpacity(opacity: number): void { this.material.uniforms.uOpacity.value = opacity; if (this.backing) this.backing.material.opacity = 0.9 * opacity; }

  setHover(amount: number): void { this.hoverTarget = amount; }

  hover(): number { return this.material.uniforms.uHover.value; }

  step(alpha = 0.25): void {
    const uniform = this.material.uniforms.uHover;
    uniform.value += (this.hoverTarget - uniform.value) * alpha;
  }

  dispose(): void {
    this.backing?.geometry.dispose(); this.backing?.material.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Back and side faces sit behind the existing glass front, leaving picking unchanged. */
export function roundedSurfaceGeometry(width: number, height: number, radius: number, thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const w = width / 2, h = height / 2, r = Math.min(radius, w, h);
  shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w, h - r); shape.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w + r, h); shape.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w, -h + r); shape.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  const extrusion = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -thickness);
  // The shader is the front face. A duplicate cap only microns behind it causes depth fighting.
  const normal = extrusion.getAttribute("normal");
  const indices: number[] = [];
  for (let i = 0; i < normal.count; i += 3) {
    if (normal.getZ(i) > 0.99 && normal.getZ(i + 1) > 0.99 && normal.getZ(i + 2) > 0.99) continue;
    indices.push(i, i + 1, i + 2);
  }
  extrusion.clearGroups(); extrusion.setIndex(indices);
  return extrusion;
}

export function surfaceBacking(width: number, height: number, radius: number, thickness: number): THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(roundedSurfaceGeometry(width, height, radius, thickness), new THREE.MeshBasicMaterial({ color: "#252528", transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  mesh.name = "Surface thickness"; mesh.raycast = () => {};
  return mesh;
}

/** Opaque button bodies stay in the UI render queue so page fades keep working. */
export function buttonSurfaceBacking(width: number, height: number, radius: number, thickness: number): ReturnType<typeof surfaceBacking> {
  const mesh = surfaceBacking(width, height, radius, thickness);
  mesh.material.opacity = 1;
  mesh.material.depthWrite = true;
  return mesh;
}

export function tintButtonBacking(backing: ReturnType<typeof surfaceBacking>, tint: THREE.Color, hover = 0): void {
  // Follow the face's animated tint and hover light, with a slightly darker side wall.
  backing.material.color.copy(tint).addScalar(hover * 0.12).multiplyScalar(0.75);
}

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
