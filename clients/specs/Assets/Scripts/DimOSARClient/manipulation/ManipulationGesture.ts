import type { ManipulationPose } from "./ManipulationTypes";
import { composePose, inversePose } from "./ModelKinematics";

/** Full-pose grab capture in client-tracking metres. */
export class ManipulationGesture {
  private offset: ManipulationPose | null = null;
  private displayed: ManipulationPose | null = null;

  begin(input: ManipulationPose, target: ManipulationPose, _now: number): void {
    this.offset = composePose(inversePose(input), target);
    this.displayed = { position: [...target.position], orientation: [...target.orientation] };
  }

  hold(input: ManipulationPose, _now: number): ManipulationPose | null {
    if (!this.offset || !this.displayed) return null;
    this.displayed = composePose(input, this.offset);
    return this.displayed;
  }

  end(): void { this.offset = null; this.displayed = null; }
}
