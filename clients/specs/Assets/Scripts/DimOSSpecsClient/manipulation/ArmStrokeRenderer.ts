import { AdaptiveStrokeRenderer } from "../presentation/WorldMeshRenderer";
import type { ManipulationPose } from "../../DimOSARClient/manipulation/ManipulationTypes";
const MATERIAL = requireAsset("../../../Materials/ArmStroke.mat") as Material;

/** Static link-local endpoints; only pose uniforms change during rigid motion. */
export class ArmStrokeRenderer extends AdaptiveStrokeRenderer {
  geometryUploads = 0;
  private boundsSet = false;
  private poseKey = "";
  private styleKey = "";
  constructor(parent: SceneObject, name: string) { super(parent, name, MATERIAL); }
  segments(...args: Parameters<AdaptiveStrokeRenderer["segments"]>): void {
    this.styleKey = "";
    super.segments(...args);
  }
  upload(vertices: number[], indices: readonly number[]): void {
    this.geometryUploads++;
    for (let i = 0; i < vertices.length; i += 22) {
      vertices[i + 15] = vertices[i + 11] * Math.hypot(vertices[i + 12] - vertices[i], vertices[i + 13] - vertices[i + 1], vertices[i + 14] - vertices[i + 2]);
    }
    if (!this.boundsSet && vertices.length) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < vertices.length; i += 22) for (const offset of [0, 12]) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertices[i + offset + axis]);
        max[axis] = Math.max(max[axis], vertices[i + offset + axis]);
      }
      const pass = this.material.mainPass as any;
      pass.frustumCullMode = FrustumCullMode.UserDefinedAABB;
      pass.frustumCullMin = new vec3(min[0] - 3, min[1] - 3, min[2] - 3);
      pass.frustumCullMax = new vec3(max[0] + 3, max[1] + 3, max[2] + 3);
      this.boundsSet = true;
    }
    super.upload(vertices, indices);
  }
  style(width: number, opacity: number, color: readonly [number, number, number] = [1, 1, 1], start = 0): void {
    const key = `${width}:${opacity}:${color}:${start}`;
    if (this.styleKey === key) return;
    super.style(width, opacity, color, start); this.styleKey = key;
  }
  pose(pose: ManipulationPose): void {
    const key = JSON.stringify(pose);
    if (key === this.poseKey) return;
    this.poseKey = key;
    const pass = this.material.mainPass as any;
    [pass.positionX, pass.positionY, pass.positionZ] = pose.position;
    [pass.rotationX, pass.rotationY, pass.rotationZ, pass.rotationW] = pose.orientation;
    const t = this.object.getTransform();
    t.setWorldPosition(new vec3(...pose.position));
    t.setWorldRotation(new quat(pose.orientation[3], pose.orientation[0], pose.orientation[1], pose.orientation[2]));
  }
}
