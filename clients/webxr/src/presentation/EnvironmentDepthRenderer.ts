import * as THREE from "three";
import { reportDiagnostic } from "../diagnostics/BrowserDiagnostics";

type ProjectedDepth = XRWebGLDepthInformation & {
  isValid?: boolean;
  depthNear?: number;
  depthFar?: number;
};
type DepthUniforms = {
  environmentDepthEnabled: { value: boolean };
  environmentDepthTexture: { value: THREE.Texture | null };
  environmentDepthViewport: { value: THREE.Vector4 };
  environmentDepthTransform: { value: THREE.Matrix4 };
  environmentDepthLayer: { value: number };
};

/** Host-only projected environment depth, explicitly attached to bounds and paths. */
export class EnvironmentDepthRenderer {
  private readonly materials = new Map<
    THREE.Material,
    {
      uniforms: DepthUniforms;
      compile: THREE.Material["onBeforeCompile"];
      key: THREE.Material["customProgramCacheKey"];
    }
  >();
  private readonly objects = new Map<
    THREE.Object3D,
    THREE.Object3D["onBeforeRender"]
  >();
  private samples: { depth: ProjectedDepth; texture: THREE.ExternalTexture }[] =
    [];
  private session: XRSession | null = null;
  private originalDepthMesh: (() => THREE.Mesh | null) | null = null;
  private reported = "";
  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  static sessionOptions(options: XRSessionInit = {}): XRSessionInit {
    return {
      ...options,
      optionalFeatures: [
        ...new Set([...(options.optionalFeatures ?? []), "depth-sensing"]),
      ],
      depthSensing: {
        usagePreference: ["gpu-optimized"],
        dataFormatPreference: ["float32"],
        matchDepthView: true,
      } as XRDepthStateInit,
    };
  }

  update(frame: XRFrame, viewer: XRViewerPose, roots: THREE.Object3D[]): void {
    if (!frame.session) return;
    if (this.session !== frame.session) {
      this.reset();
      this.session = frame.session;
      // Three's built-in depth mesh affects every depth-tested visual. Disable
      // that global prepass; selective material injection below is intentional.
      this.originalDepthMesh = this.renderer.xr.getDepthSensingMesh;
      this.renderer.xr.getDepthSensingMesh = () => null;
    }
    const previous = this.samples;
    this.samples = [];
    if (frame.session.depthUsage === "gpu-optimized") {
      const binding = this.renderer.xr.getBinding();
      for (const view of viewer.views) {
        const depth = binding?.getDepthInformation(
          view,
        ) as ProjectedDepth | null;
        if (
          !depth?.texture ||
          depth.isValid === false ||
          depth.textureType !== "texture-array" ||
          depth.depthNear === undefined
        ) {
          this.samples = [];
          break;
        }
        this.samples.push({
          depth,
          texture: new THREE.ExternalTexture(depth.texture),
        });
      }
    }
    previous.forEach((sample) => sample.texture.dispose());
    const status = this.samples.length ? "available" : "unavailable";
    if (status !== this.reported) {
      reportDiagnostic("environment-depth", { status });
      this.reported = status;
    }
    const liveObjects = new Set<THREE.Object3D>(),
      liveMaterials = new Set<THREE.Material>();
    roots.forEach((root) =>
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line))
          return;
        if (object.userData.environmentDepth !== true) return;
        liveObjects.add(object);
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((material) => liveMaterials.add(material));
        this.attach(object);
      }),
    );
    for (const [material, entry] of this.materials) {
      if (!liveMaterials.has(material)) {
        material.onBeforeCompile = entry.compile;
        material.customProgramCacheKey = entry.key;
        material.needsUpdate = true;
        this.materials.delete(material);
      } else
        entry.uniforms.environmentDepthEnabled.value = this.samples.length > 0;
    }
    for (const [object, before] of this.objects)
      if (!liveObjects.has(object)) {
        object.onBeforeRender = before;
        this.objects.delete(object);
      }
  }

  private attach(object: THREE.Mesh | THREE.Line): void {
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (this.materials.has(material)) continue;
      const uniforms: DepthUniforms = {
        environmentDepthEnabled: { value: false },
        environmentDepthTexture: { value: null },
        environmentDepthViewport: { value: new THREE.Vector4(0, 0, 1, 1) },
        environmentDepthTransform: { value: new THREE.Matrix4() },
        environmentDepthLayer: { value: 0 },
      };
      const compile = material.onBeforeCompile,
        key = material.customProgramCacheKey;
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader =
          `uniform bool environmentDepthEnabled;
uniform sampler2DArray environmentDepthTexture;
uniform vec4 environmentDepthViewport;
uniform mat4 environmentDepthTransform;
uniform float environmentDepthLayer;
` +
          shader.fragmentShader.replace(
            "void main() {",
            `void main() {
 if (environmentDepthEnabled) {
   vec2 uv = (gl_FragCoord.xy - environmentDepthViewport.xy) / environmentDepthViewport.zw;
   vec4 depthUV = environmentDepthTransform * vec4(uv, 0.0, 1.0);
   vec2 coord = depthUV.xy / depthUV.w;
   if (all(greaterThanEqual(coord, vec2(0.0))) && all(lessThanEqual(coord, vec2(1.0)))) {
     float realDepth = texture(environmentDepthTexture, vec3(coord, environmentDepthLayer)).r;
     if (realDepth > 0.0 && realDepth < 1.0 && gl_FragCoord.z > realDepth + 0.00015) discard;
   }
 }
`,
          );
      };
      material.customProgramCacheKey = () =>
        key.call(material) + ":environment-depth-v1";
      material.needsUpdate = true;
      this.materials.set(material, { uniforms, compile, key });
    }
    if (this.objects.has(object)) return;
    const before = object.onBeforeRender;
    this.objects.set(object, before);
    object.onBeforeRender = (
      renderer,
      scene,
      camera,
      geometry,
      material,
      group,
    ) => {
      before.call(object, renderer, scene, camera, geometry, material, group);
      const eyes = this.renderer.xr.getCamera().cameras;
      const index = Math.max(
        0,
        eyes.findIndex((eye) => eye === camera),
      );
      const sample = this.samples[index],
        entry = this.materials.get(material);
      if (!entry) return;
      entry.uniforms.environmentDepthEnabled.value = !!sample;
      if (!sample) return;
      entry.uniforms.environmentDepthTexture.value = sample.texture;
      entry.uniforms.environmentDepthLayer.value = index;
      entry.uniforms.environmentDepthTransform.value.fromArray(
        sample.depth.normDepthBufferFromNormView.matrix,
      );
      const viewport = (
        camera as THREE.PerspectiveCamera & { viewport?: THREE.Vector4 }
      ).viewport;
      if (viewport)
        entry.uniforms.environmentDepthViewport.value.copy(viewport);
    };
  }
  reset(): void {
    for (const sample of this.samples) sample.texture.dispose();
    this.samples = [];
    for (const entry of this.materials.values())
      entry.uniforms.environmentDepthEnabled.value = false;
    if (this.originalDepthMesh)
      this.renderer.xr.getDepthSensingMesh = this.originalDepthMesh;
    this.originalDepthMesh = null;
    this.session = null;
    this.reported = "";
  }
  dispose(): void {
    this.reset();
    for (const [material, entry] of this.materials) {
      material.onBeforeCompile = entry.compile;
      material.customProgramCacheKey = entry.key;
      material.needsUpdate = true;
    }
    for (const [object, before] of this.objects) object.onBeforeRender = before;
    this.materials.clear();
    this.objects.clear();
  }
}
