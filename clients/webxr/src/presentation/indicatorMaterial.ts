import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vObjectPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    vObjectPosition = position;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = view.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * view;
  }
`;

// Port of the Specs AnimatedNoiseWaves look: a rim-lit white shell with two
// scrolling noise layers, the back layer dimmer to read as depth.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vObjectPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  void main() {
    vec3 p = normalize(vObjectPosition);
    float facing = abs(dot(normalize(vViewNormal), normalize(-vViewPosition)));
    float rim = pow(1.0 - facing, 2.0);
    float waves = noise(p * 2.5 + vec3(0.0, uTime * 0.6, 0.0)) * 0.6 + noise(p * 5.0 - vec3(uTime * 0.4, 0.0, 0.0)) * 0.4;
    float band = smoothstep(0.45, 0.75, waves);
    float layer = gl_FrontFacing ? 1.0 : 0.45;
    float alpha = clamp(uOpacity * (0.2 + rim * 0.8 + band * 0.35) * layer, 0.0, 1.0);
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

export function indicatorMaterial(color = 0xffffff, opacity = 0.9): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
