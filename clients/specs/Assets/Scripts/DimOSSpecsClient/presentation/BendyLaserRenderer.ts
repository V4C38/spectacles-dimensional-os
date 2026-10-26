import { CURSOR_LASER_STYLE, type LaserFrame } from "./CursorLaserGeometry";

const LASER_MATERIAL = requireAsset("../../../Materials/BendyLaser.mat") as Material;
const RADIAL_SEGMENTS = 6;
const LENGTH_SEGMENTS = 32;

export interface LaserVisual {
  apply(frame: LaserFrame): void;
  hide(): void;
  destroy(): void;
}

/** Fixed tube topology. The vertex shader bends both layers; only uniforms change per frame. */
export class BendyLaserRenderer implements LaserVisual {
  readonly object: SceneObject;
  readonly layers: { visual: RenderMeshVisual; pass: Pass }[] = [];

  constructor(parent: SceneObject, name: string) {
    this.object = global.scene.createSceneObject(name);
    this.object.setParent(parent);
    const transform = this.object.getTransform();
    transform.setWorldPosition(vec3.zero()); transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());
    const geometry = laserTubeGeometry();
    const builder = new MeshBuilder([{ name: "position", components: 3 }, { name: "normal", components: 3 },
      { name: "color", components: 4 }, { name: "texture0", components: 2 }]);
    builder.topology = MeshTopology.Triangles; builder.indexType = MeshIndexType.UInt16;
    builder.appendVerticesInterleaved(geometry.vertices); builder.appendIndices(geometry.indices);
    if (!builder.isValid()) throw new Error("Invalid laser tube mesh");
    builder.updateMesh();
    for (const outline of [true, false]) {
      const child = global.scene.createSceneObject(outline ? "Outline" : "Beam");
      child.setParent(this.object);
      const visual = child.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      visual.mesh = builder.getMesh(); visual.mainMaterial = LASER_MATERIAL.clone();
      visual.meshShadowMode = MeshShadowMode.None;
      // SIK's native cursor renders at 100 and remains above the added tube.
      visual.setRenderOrder(outline ? 98 : 99);
      const pass = visual.mainMaterial.mainPass;
      pass.blendMode = BlendMode.Normal; pass.depthWrite = false; pass.depthTest = false;
      pass.twoSided = false;
      pass.frustumCullMode = FrustumCullMode.UserDefinedAABB;
      pass.radius = outline ? CURSOR_LASER_STYLE.outlineRadiusCm : CURSOR_LASER_STYLE.radiusCm;
      pass.tipRadius = outline ? CURSOR_LASER_STYLE.outlineTipRadiusCm : CURSOR_LASER_STYLE.tipRadiusCm;
      pass.brightness = outline ? 17 / 255 : 1;
      this.layers.push({ visual, pass });
    }
    this.hide();
  }

  apply(frame: LaserFrame): void {
    this.object.getTransform().setWorldPosition(new vec3(...frame.start));
    // A quadratic curve stays inside the convex hull of its control points.
    // Native bounds must cover the deformed tube rather than its unit placeholder mesh.
    const control = frame.control.map((v, axis) => v - frame.start[axis]);
    const end = frame.end.map((v, axis) => v - frame.start[axis]);
    const minimum = control.map((v, axis) => Math.min(0, v, end[axis]) - 0.3);
    const maximum = control.map((v, axis) => Math.max(0, v, end[axis]) + 0.3);
    for (let i = 0; i < this.layers.length; i++) {
      const pass = this.layers[i].pass;
      pass.startX = frame.start[0]; pass.startY = frame.start[1]; pass.startZ = frame.start[2];
      pass.controlX = control[0]; pass.controlY = control[1]; pass.controlZ = control[2];
      pass.endX = end[0]; pass.endY = end[1]; pass.endZ = end[2];
      pass.opacity = frame.opacity * (i === 0 ? 0.6 : 1);
      pass.frustumCullMin = new vec3(minimum[0], minimum[1], minimum[2]);
      pass.frustumCullMax = new vec3(maximum[0], maximum[1], maximum[2]);
    }
    this.object.enabled = true;
  }

  hide(): void { this.object.enabled = false; }
  destroy(): void { this.object.destroy(); }
}

export function laserTubeGeometry(): { vertices: number[]; indices: number[] } {
  const vertices: number[] = [], indices: number[] = [];
  for (let row = 0; row <= LENGTH_SEGMENTS; row++) {
    for (let ring = 0; ring <= RADIAL_SEGMENTS; ring++) {
      const t = row / LENGTH_SEGMENTS, u = ring / RADIAL_SEGMENTS;
      // Placeholder positions form a unit tube; apply() supplies the shader-deformed native bounds.
      vertices.push(Math.cos(u * Math.PI * 2), t, Math.sin(u * Math.PI * 2), 0, 1, 0, 1, 1, 1, 1, u, t);
      if (row && ring) {
        const v = row * (RADIAL_SEGMENTS + 1) + ring, previous = v - RADIAL_SEGMENTS - 1;
        indices.push(previous - 1, previous, v - 1, v - 1, previous, v);
      }
    }
  }
  return { vertices, indices };
}
