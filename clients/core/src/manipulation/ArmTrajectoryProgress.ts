import type { ManipulationPlan } from "./ManipulationTypes";
import { jointDelta } from "./JointMotion";

/** A monotonic local projection in joint space, so Cartesian crossings cannot skip ahead. */
export class ArmTrajectoryProgress {
  private key = "";
  private segment = 0;
  private fraction = 0;
  time = 0;

  reset(): void {
    this.key = "";
    this.segment = this.fraction = this.time = 0;
  }

  advance(
    plan: ManipulationPlan,
    measured: Record<string, number>,
    continuous: ReadonlySet<string>,
    operation: string,
  ): number {
    const key = `${operation}:${plan.plan_id}`;
    if (key !== this.key) {
      this.reset();
      this.key = key;
    }
    if (!plan.joint_names.every((name) => Number.isFinite(measured[name])))
      return this.time;
    let best = Infinity;
    for (let i = this.segment; i < plan.trajectory.length - 1; i++) {
      const a = plan.trajectory[i],
        b = plan.trajectory[i + 1];
      const direction = plan.joint_names.map((name, j) =>
        jointDelta(a.positions[j], b.positions[j], continuous.has(name)),
      );
      const offset = plan.joint_names.map((name, j) =>
        jointDelta(a.positions[j], measured[name], continuous.has(name)),
      );
      const length = direction.reduce((sum, value) => sum + value * value, 0);
      // A stationary segment cannot establish progress from feedback.
      if (length < 1e-12) continue;
      const projection =
        offset.reduce((sum, value, j) => sum + value * direction[j], 0) /
        length;
      const fraction = Math.max(
        i === this.segment ? this.fraction : 0,
        Math.min(1, projection),
      );
      const error = offset.reduce(
        (sum, value, j) => sum + (value - fraction * direction[j]) ** 2,
        0,
      );
      if (error > best + 1e-8) break;
      if (error < best - 1e-10) {
        best = error;
        this.segment = i;
        this.fraction = fraction;
        this.time = Math.max(this.time, a.time + fraction * (b.time - a.time));
      }
    }
    return this.time;
  }
}
