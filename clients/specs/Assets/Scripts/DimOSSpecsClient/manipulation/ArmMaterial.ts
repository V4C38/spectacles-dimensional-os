import type { ManipulationPose } from "../../DimOSARClient/manipulation/ManipulationTypes";
import { ARM_VISUAL_STYLE } from "../../DimOSARClient/manipulation/ManipulationVisuals";
import { clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
export const ARM_MATERIAL = requireAsset("../../../Materials/ArmFresnel.mat") as Material;

export function configureArmMaterial(material: Material, opacity = 1): void {
  const pass = material.mainPass as Pass & { fill: number; edgeOpacity: number; power: number; twoSided: boolean };
  pass.fill = pass.edgeOpacity = ARM_VISUAL_STYLE.fill * opacity;
  // Negative power selects the flat surface branch; the measured sphere retains Fresnel.
  pass.power = -1;
  pass.twoSided = false;
}

export const ARM_SURFACE_MATERIAL = requireAsset("../../../Materials/ArmSurface.mat") as Material;
const surfaceValues = new WeakMap<Material, string>();
export function configureArmSurface(material: Material, opacity: number, color: number): void {
  const key = `${opacity}:${color}`;
  if (surfaceValues.get(material) === key) return;
  const pass = material.mainPass as any;
  pass.opacityScale = ARM_VISUAL_STYLE.fill * opacity;
  pass.colorR = ((color >> 16) & 255) / 255;
  pass.colorG = ((color >> 8) & 255) / 255;
  pass.colorB = (color & 255) / 255;
  surfaceValues.set(material, key);
}

const POINT_UNIFORMS = [
  "pointDelta00", "pointDelta01", "pointDelta02", "pointDelta10", "pointDelta11",
  "pointDelta12", "pointDelta20", "pointDelta21", "pointDelta22",
  "pointDeltaX", "pointDeltaY", "pointDeltaZ", "pointFloor", "pointBoost", "pointVisibility",
] as const;

/** Difference of rigid transforms, in the same centimetre basis as the static arm meshes. */
export function armDisplacementCoefficients(measured: ManipulationPose, proposed: ManipulationPose): number[] {
  const rotation = ([x, y, z, w]: readonly number[]) => [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
  const a = clientTrackingToSpecsPose(measured), b = clientTrackingToSpecsPose(proposed);
  const ra = rotation(a.orientation), rb = rotation(b.orientation);
  return [...ra.map((value, i) => value - rb[i]), ...a.position.map((value, i) => value - b.position[i])];
}

/** A constant-size fade replaces thousands of vertex-alpha edits and MeshBuilder rebuilds. */
export class ArmOpacityUniforms {
  private values = new Array<number>(POINT_UNIFORMS.length).fill(0);
  private target = new Array<number>(POINT_UNIFORMS.length).fill(0);
  private initialized = false;
  private readonly uploaded = new WeakMap<Material, number[]>();

  sample(measured: ManipulationPose, proposed: ManipulationPose,
    style: { pointVisible: boolean; floor: number; displacementBoost: number },
    refresh: boolean, elapsed: number): void {
    if (refresh || !this.initialized) {
      this.target.splice(0, 12, ...armDisplacementCoefficients(measured, proposed));
      // Begin at the current displacement; visibility itself fades in smoothly.
      if (!this.initialized) this.values.splice(0, 12, ...this.target.slice(0, 12));
      this.initialized = true;
    }
    this.target[12] = style.floor;
    this.target[13] = style.displacementBoost;
    this.target[14] = style.pointVisible ? 1 : 0;
    const gain = 1 - Math.exp(-Math.max(0, Math.min(0.1, elapsed)) / 0.12);
    for (let i = 0; i < this.values.length; i++) {
      const next = this.values[i] + (this.target[i] - this.values[i]) * gain;
      this.values[i] = Math.abs(next - this.target[i]) < 0.000001 ? this.target[i] : next;
    }
  }

  apply(material: Material): void {
    let previous = this.uploaded.get(material);
    if (!previous) { previous = []; this.uploaded.set(material, previous); }
    const pass = material.mainPass as unknown as Record<string, number>;
    POINT_UNIFORMS.forEach((name, i) => {
      if (previous[i] === this.values[i]) return;
      pass[name] = previous[i] = this.values[i];
    });
  }
}
