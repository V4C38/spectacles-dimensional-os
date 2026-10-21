import * as THREE from "three";

const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vViewNormal = normalize(transformedNormal);
    vViewPosition = mvPosition.xyz;
  }
`;

// Silhouette glow: faces turned toward the viewer fade out, edges stay bright.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    float facing = abs(dot(normalize(vViewNormal), normalize(-vViewPosition)));
    float edge = pow(1.0 - facing, 2.2);
    gl_FragColor = vec4(uColor, uOpacity * (0.06 + edge * 0.94));
    #include <colorspace_fragment>
  }
`;

const STYLED = "dimosHandStyled";

export class HandStyle {
  private readonly material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 0.85 } },
    transparent: true,
    depthWrite: false,
  });
  // A depth-only pass first, so only the nearest hand surface shows its edges.
  private readonly depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });

  /** Hand meshes load asynchronously, so this is safe to call every frame. */
  apply(hands: readonly THREE.Object3D[]): void {
    for (const hand of hands) {
      hand.traverse(object => {
        if (!(object instanceof THREE.SkinnedMesh) || object.userData[STYLED]) return;
        object.userData[STYLED] = true;
        const depth = new THREE.SkinnedMesh(object.geometry, this.depthMaterial);
        depth.userData[STYLED] = true;
        depth.bind(object.skeleton, object.bindMatrix);
        depth.position.copy(object.position);
        depth.quaternion.copy(object.quaternion);
        depth.scale.copy(object.scale);
        depth.frustumCulled = object.frustumCulled = false;
        depth.renderOrder = 900;
        object.renderOrder = 901;
        object.material = this.material;
        object.parent?.add(depth);
      });
    }
  }

  dispose(): void {
    this.material.dispose();
    this.depthMaterial.dispose();
  }
}
