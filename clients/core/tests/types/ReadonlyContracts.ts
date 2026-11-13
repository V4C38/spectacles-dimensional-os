import { robotDeadzoneRadiusM } from "../../src/navigation/NavigationInteraction";
import type { ARModuleSessionState } from "../../src/websocket/ARModuleSession";
import type { InteractionAuthorityPort } from "../../src/ClientContracts";
import type { ManipulationInteraction } from "../../src/manipulation/ManipulationController";
import type { ClientTrackingOriginStore } from "../../src/localization/ClientTracking";

// Compiled by typecheck, never executed. These mutations must remain illegal even
// when observation getters retain their nested references for frame coherence.
function rejectObservationMutations(
  view: ARModuleSessionState,
  authority: InteractionAuthorityPort,
  manipulation: ManipulationInteraction,
  origins: ClientTrackingOriginStore,
): void {
  if (view.pose) {
    // @ts-expect-error observed coordinates are readonly tuples
    view.pose.position[0] = 1;
  }
  if (view.interaction) {
    // @ts-expect-error a consumer cannot append authoritative targets
    view.interaction.targets.push(view.interaction.targets[0]);
    // @ts-expect-error nested target tuples cannot mutate retained facts
    view.interaction.targets[0].orientation[0] = 1;
  }
  const target = authority.snapshot().rawTarget;
  if (target) {
    // @ts-expect-error snapshots cannot expose a mutable target tuple
    target.position[0] = 1;
  }
  if (manipulation.plan) {
    // @ts-expect-error plans expose readonly trajectory arrays
    manipulation.plan.trajectory[0].positions.push(1);
  }
  // @ts-expect-error diagnostics are observations, not the mutable log
  manipulation.captureEvents.pop();
  if (manipulation.previewJoints) {
    // @ts-expect-error joint previews cannot mutate an owned draft
    manipulation.previewJoints.shoulder = 1;
  }
  if (origins.T_odom_client) {
    // @ts-expect-error retained alignment origin tuples are readonly
    origins.T_odom_client.position[0] = 1;
  }
}
void rejectObservationMutations;

// Native robot observations expose a readonly footprint; pure policy accepts it.
robotDeadzoneRadiusM([.7, .5] as const);
