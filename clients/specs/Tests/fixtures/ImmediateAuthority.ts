import { CollaborationController } from "../../Assets/Scripts/DimOSARClient/replication/CollaborationController";
import type { InteractionKind, InteractionPose, InteractionSettings, InteractionState, InteractionTarget } from "../../Assets/Scripts/DimOSARClient/replication/CollaborationTypes";

/** In-process server boundary; production CollaborationController still grants, predicts and retires. */
export function immediateAuthority(options: {
  now?: () => number;
  ready?: () => boolean;
  onCommit?: (pose: InteractionPose) => void;
  onState?: (state: InteractionState) => void;
} = {}) {
  const now = options.now ?? (() => 0);
  const commands: Record<string, any>[] = [];
  const state: InteractionState & { target: InteractionTarget | null } = {
    motion_busy: false,
    following_tail: null,
    type: "interaction_state", epoch: "test-epoch", revision: 0,
    mode: "manual", authority: null, target: null, targets: [], preview: null, active_goal: null };
  let serial = 0;
  const collaboration = new CollaborationController({ ready: options.ready ?? (() => true),
    clientId: () => "test-client", now, send: text => {
      const request = JSON.parse(text);
      commands.push(request);
      let status: "accepted" | "busy" | "stale" = "accepted";
      let lease: string | undefined;
      if (request.epoch !== state.epoch) status = "stale";
      else if (request.action === "acquire") {
        if (state.authority) status = "busy";
        else {
          lease = `test-lease-${++serial}`;
          state.authority = { client_id: "test-client", source_id: request.source_id,
            acquisition_id: request.acquisition_id, lease_id: lease, kind: request.kind,
            group_id: request.group_id, held: true, expires_at: now() + 1, sequence: -1 };
          updateTarget(request, -1);
        }
      } else if (request.action === "mode") state.mode = request.mode;
      else if (request.action === "cancel_acquire") {
        if (state.authority?.acquisition_id === request.acquisition_id) state.authority = null;
      } else if (request.action === "cancel") {
        if (state.authority?.kind === "navigation_planning") {
          state.targets = state.targets!.filter(target => target.domain !== "navigation");
          state.target = null;
        }
        state.authority = null;
      } else if (state.authority && request.lease_id === state.authority.lease_id) {
        lease = state.authority.lease_id;
        if (request.action === "renew") state.authority.expires_at = now() + 1;
        else {
          updateTarget(request, request.sequence);
          state.authority.sequence = request.sequence;
          if (request.action === "release" && state.authority.kind === "navigation_planning") state.authority.held = false;
          else if (request.action === "release" || request.action === "confirm") {
            if (state.target?.domain === "navigation") {
              state.target = { ...state.target, phase: "committed" };
              replaceTarget(state.target);
              const [x, y, z, w] = state.target.orientation;
              state.active_goal = { type: "nav_goal", pose: [...state.target.position,
                Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))], path_poses: [], ts: now() };
              options.onCommit?.(state.target);
            }
            state.authority = null;
            lease = undefined;
          }
        }
      } else if (request.action !== "snapshot") status = "stale";
      state.revision++;
      publish();
      collaboration.accept({ type: "interaction_result", request_id: request.request_id,
        epoch: state.epoch, revision: state.revision, status, code: request.action,
        ...(lease ? { lease_id: lease } : {}) });
    } });
  function replaceTarget(target: InteractionTarget) {
    state.targets = [...state.targets!.filter(t => t.domain !== target.domain || t.group_id !== target.group_id), target];
  }
  function updateTarget(request: Record<string, any>, sequence: number) {
    const authority = state.authority;
    if (!authority || !request.position || !request.orientation) return;
    const domain = authority.kind.startsWith("manipulation") ? "manipulation" : "navigation";
    const previous = state.targets!.find(t => t.domain === domain && t.group_id === authority.group_id);
    const speed = request.speed_scale ?? previous?.speed_scale ?? .5;
    const gripper = request.gripper ?? previous?.gripper;
    const unchanged = previous && JSON.stringify(previous.position) === JSON.stringify(request.position) &&
      JSON.stringify(previous.orientation) === JSON.stringify(request.orientation) &&
      previous.speed_scale === speed && previous.gripper === gripper;
    const target: InteractionTarget = { position: [request.position[0], request.position[1], request.position[2]],
      orientation: [request.orientation[0], request.orientation[1], request.orientation[2], request.orientation[3]], domain,
      group_id: authority.group_id ?? undefined, speed_scale: speed,
      ...(request.gripper === undefined && previous?.gripper === undefined ? {} : { gripper: request.gripper ?? previous?.gripper }),
      revision: unchanged ? previous.revision : (previous?.revision ?? 0) + 1, phase: authority.kind.endsWith("planning") ? "draft" : "live",
      sequence, sample_ts: now() };
    state.target = target;
    replaceTarget(target);
  }
  function publish() {
    const { target: _activeTarget, ...snapshot } = state;
    collaboration.apply({ ...snapshot, authority: state.authority ? { ...state.authority } : null });
    options.onState?.(snapshot);
  }
  publish();
  return { collaboration, commands, state,
    tick: () => collaboration.tick(),
    publish: () => { state.revision++; publish(); },
    begin: (kind: InteractionKind, pose?: InteractionPose, settings?: InteractionSettings) =>
      collaboration.begin(kind, "fixture-input", pose, settings),
  };
}
