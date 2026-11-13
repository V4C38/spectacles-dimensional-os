import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import { clientTrackingToOdomPose, odomToClientTrackingPose } from "../localization/clientTrackingTransforms";
import type { ManipulationPose } from "./ManipulationTypes";
import { composePose, inversePose } from "./ModelKinematics";

/** Full-pose grab capture in client-tracking metres. */
export class ManipulationGesture {
  private input: ManipulationPose | null = null;
  private offset: ManipulationPose | null = null;
  private displayed: ManipulationPose | null = null;

  begin(input: ManipulationPose, target: ManipulationPose, _now: number): void {
    this.input = input;
    this.offset = composePose(inversePose(input), target);
    this.displayed = { position: [...target.position], orientation: [...target.orientation] };
  }

  hold(input: ManipulationPose, _now: number): ManipulationPose | null {
    if (!this.offset || !this.displayed) return null;
    this.input = input;
    this.displayed = composePose(input, this.offset);
    return this.displayed;
  }

  rebase(previous: ClientTrackingOrigin, next: ClientTrackingOrigin): void {
    if (!this.displayed || !this.input) return;
    this.displayed = odomToClientTrackingPose(clientTrackingToOdomPose(this.displayed, previous), next);
    this.offset = composePose(inversePose(this.input), this.displayed);
  }

  end(): void { this.offset = null; this.displayed = null; }
}
