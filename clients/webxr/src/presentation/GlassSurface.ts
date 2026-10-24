import * as THREE from "three";
import { roundedSurfaceGeometry, surfaceBacking } from "./RoundedSurfaceGeometry";
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

  resize(width: number, height: number): void {
    const size = this.material.uniforms.uSize.value as THREE.Vector2;
    if (size.x === width && size.y === height) return;
    this.geometry.dispose();
    this.geometry = new THREE.PlaneGeometry(width, height);
    this.material.uniforms.uSize.value.set(width, height);
    this.material.uniforms.uRadius.value = cornerRadius(width, height);
    if (this.backing) {
      this.backing.geometry.dispose();
      this.backing.geometry = roundedSurfaceGeometry(width, height, this.material.uniforms.uRadius.value, this.thickness);
    }
  }

  setOpacity(opacity: number): void { this.material.uniforms.uOpacity.value = opacity; if (this.backing) this.backing.material.opacity = 0.9 * opacity; }

  setTint(color: string, alpha?: number): void {
    this.material.uniforms.uTint.value.set(color);
    if (alpha !== undefined) this.material.uniforms.uAlpha.value = alpha;
  }

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
