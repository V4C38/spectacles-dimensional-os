import { armMotionContext, ArmJointFilter } from "./ArmJointFilter";
import { manipulationObservedJoints, manipulationProposedJoints } from "./ManipulationPresentation";
import { linkPoses } from "./ModelKinematics";
import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { ManipulationModel, ManipulationState, ManipulationGroup, ManipulationPlan } from "./ManipulationTypes";

/** Pose sampling only; host geometry, opacity and playback ownership remain separate. */
export class ArmPresentationSampler {
  private readonly measuredFilter = new ArmJointFilter();
  private readonly proposedFilter = new ArmJointFilter(0.15, 0.25);
  private context = "";
  private previousSolution: object | null = null;
  private solutionSequence = 0;

  reset(): void { this.measuredFilter.reset(); this.proposedFilter.reset(); this.context = ""; }
  hold(now: number): void { this.measuredFilter.hold(now); this.proposedFilter.hold(now); }

  sample(input: {
    model: ManipulationModel; state: ManipulationState; group: ManipulationGroup | undefined;
    origin: ClientTrackingOrigin; now: number; selected: boolean; dragging: boolean;
    rejected: boolean; solution: Record<string, number> | null; opening: number | null | undefined;
    plan: ManipulationPlan | null; playback: { playing: boolean; time: number };
  }) {
    const { model, state, group, origin, now, selected, solution, plan, playback } = input;
    const context = armMotionContext(model.revision, group?.id ?? null, origin);
    const contextChanged = context !== this.context;
    if (contextChanged) { this.reset(); this.context = context; }
    const observed = group ? state.observations?.[group.id] : undefined;
    const observedValues = manipulationObservedJoints(model, state, group);
    const filtered = this.measuredFilter.sample(model, observedValues, context, now, .1,
      observed?.measured_at ?? undefined, observed?.joint_velocities);
    const values = manipulationProposedJoints(model, group, observedValues, input);
    if (solution !== this.previousSolution) { this.previousSolution = solution; this.solutionSequence++; }
    const source = selected ? `${plan?.plan_id ?? this.solutionSequence}` : `${this.solutionSequence}`;
    const proposed = playback.playing
      ? this.proposedFilter.playback(model, values, context, now, playback.time)
      : this.proposedFilter.sample(model, values, context, now, .1, source);
    return { observedValues, measured: linkPoses(model, filtered), proposed: linkPoses(model, proposed), contextChanged };
  }
}
