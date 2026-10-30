import type { ManipulationPose } from "./ManipulationTypes";
import { composePose, inversePose } from "./ModelKinematics";

/** Full-pose grab capture in client-tracking metres. */
export class ManipulationGesture {
  private offset: ManipulationPose | null = null;
  private displayed: ManipulationPose | null = null;
  private previousTime = 0;

  begin(input: ManipulationPose, target: ManipulationPose, now: number): void {
    this.offset = composePose(inversePose(input), target);
    this.displayed = { position: [...target.position], orientation: [...target.orientation] };
    this.previousTime = now;
  }

  hold(input: ManipulationPose, now: number): ManipulationPose | null {
    if (!this.offset || !this.displayed) return null;
    const target = composePose(input, this.offset);
    const alpha = 1 - Math.exp(-14 * Math.max(0, Math.min(0.1, now - this.previousTime)));
    this.previousTime = now;
    const a = this.displayed.orientation;
    let b = target.orientation;
    let dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
    if (dot < 0) { b = b.map(v => -v) as typeof b; dot = -dot; }
    const angle = Math.acos(Math.min(1, dot));
    const denominator = Math.sin(angle);
    const left = denominator > 1e-6 ? Math.sin((1 - alpha) * angle) / denominator : 1 - alpha;
    const right = denominator > 1e-6 ? Math.sin(alpha * angle) / denominator : alpha;
    const rotation = a.map((v, i) => v * left + b[i] * right) as typeof a;
    const length = Math.hypot(...rotation);
    this.displayed = {
      position: this.displayed.position.map((v, i) => v + (target.position[i] - v) * alpha) as typeof target.position,
      orientation: rotation.map(v => v / length) as typeof rotation,
    };
    return this.displayed;
  }

  end(): void { this.offset = null; this.displayed = null; }
}
