import type { ReadonlyFacts } from "../ClientContracts";
import { type ClientTrackingOrigin, clientTrackingToOdomPose, odomToClientTrackingPose } from "../localization/ClientTracking";

import type { ManipulationPose } from "./ManipulationTypes";
import { composePose, inversePose } from "./ModelKinematics";

/** Full-pose grab capture in client-tracking metres. */
export class ManipulationGesture {
  private input: ReadonlyFacts<ManipulationPose> | null = null;
  private offset: ManipulationPose | null = null;
  private displayed: ManipulationPose | null = null;

  begin(input: ReadonlyFacts<ManipulationPose>, target: ReadonlyFacts<ManipulationPose>, _now: number): void {
    this.input = input;
    this.offset = composePose(inversePose(input), target);
    this.displayed = { position: [...target.position], orientation: [...target.orientation] };
  }

  hold(input: ReadonlyFacts<ManipulationPose>, _now: number): ReadonlyFacts<ManipulationPose> | null {
    if (!this.offset || !this.displayed) return null;
    this.input = input;
    this.displayed = composePose(input, this.offset);
    return this.displayed;
  }

  rebase(previous: ReadonlyFacts<ClientTrackingOrigin>, next: ReadonlyFacts<ClientTrackingOrigin>): void {
    if (!this.displayed || !this.input) return;
    this.displayed = odomToClientTrackingPose(clientTrackingToOdomPose(this.displayed, previous), next);
    this.offset = composePose(inversePose(this.input), this.displayed);
  }

  end(): void { this.offset = null; this.displayed = null; }
}

/** One captured drag and an independently authorized secondary gripper press. */
export class ManipulationInputCapture {
  private readonly eventLog: {source: string; reason: string}[] = [];
  get events(): readonly Readonly<{source: string; reason: string}>[] { return this.eventLog; }
  private record(source: string, reason: string): void {
    this.eventLog.push({source, reason});
    if (this.eventLog.length > 32) this.eventLog.shift();
  }
  private source: string | null = null;
  private readonly presses = new Set<string>();
  get owner(): string | null { return this.source; }
  begin(source: string): boolean {
    if (this.source !== null) return false;
    this.source = source;
    return true;
  }
  pressGripper(source: string): boolean {
    if (this.source === source || this.presses.has(source)) return false;
    this.presses.add(source);
    return true;
  }
  release(source: string, reason = "input released"): boolean {
    this.presses.delete(source);
    if (this.source !== source) return false;
    this.record(source, reason);
    this.source = null;
    return true;
  }
  reset(reason = "input disabled"): void { if (this.source) this.record(this.source, reason); this.source = null; this.presses.clear(); }
}


/** A held pinch entering another collider is not a new selection press. */
export class ManipulationPressEdges {
  private readonly held = new Set<string>();
  observe(source: string, pressed: boolean): boolean {
    if (!pressed) { this.held.delete(source); return false; }
    if (this.held.has(source)) return false;
    this.held.add(source);
    return true;
  }
}
