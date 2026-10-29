import * as THREE from "three";

export function fresnelMaterial(
  options: {
    fill?: number;
    rim?: number;
    power?: number;
    color?: number;
    rimColor?: number;
  } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = -view.xyz;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform vec3 uCenterColor;
      uniform float uOpacity;
      uniform float uFill; uniform float uRim; uniform float uPower; uniform vec3 uRimColor;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), uPower);
        gl_FragColor = vec4(mix(uCenterColor, uRimColor, rim), uOpacity * clamp(uFill + rim * uRim, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
    uniforms: {
      uOpacity: { value: 1 },
      uCenterColor: { value: new THREE.Color(options.color ?? 0xb3b3b3) },
      uRimColor: { value: new THREE.Color(options.rimColor ?? 0xffffff) },
      uFill: { value: options.fill ?? 1 },
      uRim: { value: options.rim ?? 0 },
      uPower: { value: options.power ?? 2 },
    },
    toneMapped: false,
  });
}

export function indicatorMaterial(): THREE.ShaderMaterial {
  return fresnelMaterial();
}
