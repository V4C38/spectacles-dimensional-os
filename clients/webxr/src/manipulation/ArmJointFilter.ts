import type { ManipulationModel } from "@dimos-ar-client/manipulation/ManipulationTypes";
import { jointDelta } from "./JointMotion";

/** Presentation only. Never substitute these values for measured control feedback. */
export class ArmJointFilter {
  private values: Record<string, number> = {};
  private key = "";
  private time: number | null = null;

  reset(): void {
    this.values = {};
    this.time = null;
  }

  sample(
    model: ManipulationModel,
    measured: Record<string, number>,
    key: string,
    now: number,
  ): Record<string, number> {
    if (key !== this.key || this.time == null || now - this.time > 0.5) {
      this.reset();
      this.key = key;
    }
    const alpha =
      this.time == null
        ? 1
        : 1 - Math.exp(-Math.max(0, now - this.time) / 0.05);
    this.time = now;
    const kinds = new Map(
      model.joints.map((joint) => [joint.name, joint.kind]),
    );
    for (const [name, value] of Object.entries(measured)) {
      if (!Number.isFinite(value)) continue;
      const previous = this.values[name] ?? value;
      this.values[name] =
        previous +
        alpha * jointDelta(previous, value, kinds.get(name) === "continuous");
    }
    return { ...this.values };
  }
}
