import * as THREE from "three";

export function indicatorMaterial(): THREE.ShaderMaterial {
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
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        gl_FragColor = vec4(mix(uCenterColor, vec3(1.0), rim), uOpacity);
        #include <colorspace_fragment>
      }`,
    uniforms: { uOpacity: { value: 1 }, uCenterColor: { value: new THREE.Color(0xb3b3b3) } },
    toneMapped: false,
  });
}
