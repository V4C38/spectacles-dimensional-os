import type { NavigationState as AppNavigationState } from "../../App/AppState";

// ================================================================
/** Pure navigation model: stored facts, derived presentation, event rule book. */
// ================================================================

export type NavPose = {
  position: vec3;
  rotation: quat;
};

export type ActiveGoal = {
  since: number;
  navigating: boolean;
};

export type GoalTrack = ActiveGoal | null;

export type NavEngineState = {
  armed: boolean;
  goal: GoalTrack;
  lastNavStatusTime: number;
  lastNavStatusResyncTime: number;
  navStatusResyncCooldownS: number;
};

export const GOAL_SEND_INTERVAL_S = 0.35;
export const GOAL_SEND_MIN_DISTANCE_CM = 20.0;
export const GOAL_FORCE_NOOP_DISTANCE_CM = 2.0;

export const NAV_STATUS_STALE_TIMEOUT_S = 8.0;
export const NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S = 2.0;
export const NAV_STATUS_RESYNC_MAX_COOLDOWN_S = 8.0;
export const NAV_STATUS_LOCAL_RECOVERY_S = 16.0;

export type NavPhase =
  | { kind: "idle" }
  | { kind: "placing"; pose: NavPose }
  | { kind: "committed"; pose: NavPose; navigating: boolean; since: number };

export type NavLiveContext = {
  placementActive: boolean;
  activelyDragging: boolean;
  markerExists: boolean;
  outcomeAnimating: boolean;
  outcomeLabel?: "Cancelled" | "Failed" | null;
  markerPose?: NavPose | null;
};

export type CapabilityView = {
  cancelAvailable: boolean;
  sessionActive: boolean;
};

export type NavMarkerViewState = {
  visible: boolean;
  circleIdle: boolean;
  heading: quat;
  button: { role: "cancel"; enabled: boolean; label: string } | null;
  /** Non-null while playing cancel/fail outcome animation. */
  outcomeLabel: string | null;
};

export type NavViewState = {
  marker: NavMarkerViewState;
  path: { visible: boolean } | null;
  placement: { dragEnabled: boolean; followRobot: boolean };
  appNavigationState: AppNavigationState;
  shouldStreamGoal: boolean;
};

export type PlacementInteractionPolicy = {
  dragEnabled: boolean;
  followRobot: boolean;
};

export type NavigationEvent =
  | { kind: "arm" }
  | { kind: "disarm" }
  | {
      kind: "goalCommitRequested";
      sendToBridge: boolean;
      pose: NavPose;
    }
  | { kind: "navigating" }
  | { kind: "navStatusGoalReached" }
  | { kind: "navStatusGoalFailed" }
  | { kind: "navStatusRecovering" }
  | { kind: "cancelRequested" }
  | { kind: "estopRequested" }
  | { kind: "disconnect" }
  | { kind: "staleRecovery" }
  | { kind: "outcomeAnimationFinished" };

export type NavigationEffect =
  | { kind: "syncAppNavigationState" }
  | { kind: "syncMarkerPresentation" }
  | { kind: "sendNavGoal"; pose: NavPose }
  | { kind: "sendCancelGoal" }
  | { kind: "clearPath" }
  | { kind: "resetNavigationOutcome" }
  | { kind: "destroyMarker" }
  | { kind: "respawnMarkerAt"; pose?: NavPose; animated?: boolean }
  | { kind: "reanchorMarkerToRobot" }
  | { kind: "setPlacementInteraction"; policy: PlacementInteractionPolicy }
  | { kind: "beginOutcomeAnimation"; label: "Cancelled" | "Failed" }
  | { kind: "stopPlacement" };

export type NavigationModelResult = {
  state: NavEngineState;
  effects: NavigationEffect[];
};

export function createInitialNavEngineState(now: number = 0): NavEngineState {
  return {
    armed: false,
    goal: null,
    lastNavStatusTime: now - NAV_STATUS_STALE_TIMEOUT_S,
    lastNavStatusResyncTime: now - NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
    navStatusResyncCooldownS: NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
  };
}

function poseDistanceCm(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function shouldSendStreamGoal(
  now: number,
  lastSendTime: number,
  position: vec3,
  lastSentGoal: { position: vec3 } | null,
  force: boolean,
): boolean {
  if (force) {
    if (
      lastSentGoal &&
      poseDistanceCm(lastSentGoal.position, position) < GOAL_FORCE_NOOP_DISTANCE_CM
    ) {
      return false;
    }
    return true;
  }
  if (now - lastSendTime < GOAL_SEND_INTERVAL_S) {
    return false;
  }
  if (!lastSentGoal) {
    return true;
  }
  return poseDistanceCm(lastSentGoal.position, position) >= GOAL_SEND_MIN_DISTANCE_CM;
}

export function deriveNavPhase(
  state: NavEngineState,
  live: NavLiveContext,
): NavPhase {
  if (!state.armed || !live.markerExists) {
    return { kind: "idle" };
  }
  const pose = live.markerPose ?? {
    position: new vec3(0, 0, 0),
    rotation: quat.quatIdentity(),
  };
  if (state.goal !== null) {
    return {
      kind: "committed",
      pose,
      navigating: state.goal.navigating,
      since: state.goal.since,
    };
  }
  return { kind: "placing", pose };
}

function resolveMarkerButton(
  state: NavEngineState,
  live: NavLiveContext,
  caps: CapabilityView,
): NavMarkerViewState["button"] {
  if (!live.placementActive && state.goal === null) {
    return null;
  }
  if (live.activelyDragging) {
    return null;
  }
  return {
    role: "cancel",
    enabled: true,
    label: caps.cancelAvailable ? "Cancel" : "Cancel\nUnavailable",
  };
}

export function deriveViewState(
  state: NavEngineState,
  live: NavLiveContext,
  caps: CapabilityView,
): NavViewState | null {
  if (!state.armed) {
    return null;
  }

  const phase = deriveNavPhase(state, live);
  const markerVisible = live.markerExists && phase.kind !== "idle";
  const heading = live.markerPose?.rotation ?? quat.quatIdentity();
  const navigating = state.goal?.navigating ?? false;
  const outcomeLabel =
    live.outcomeAnimating && live.outcomeLabel ? live.outcomeLabel : null;

  const placement: PlacementInteractionPolicy = (() => {
    if (live.outcomeAnimating) {
      return { dragEnabled: false, followRobot: false };
    }
    if (state.goal === null) {
      return {
        dragEnabled: true,
        followRobot: !live.placementActive,
      };
    }
    return {
      dragEnabled: true,
      followRobot: false,
    };
  })();

  let appNavigationState: AppNavigationState = "off";
  if (caps.sessionActive) {
    if (navigating) {
      appNavigationState = "navigating";
    } else if (live.placementActive) {
      appNavigationState = "placingGoal";
    } else {
      appNavigationState = "armed";
    }
  }

  const shouldStreamGoal = live.placementActive;
  const renderPath = state.goal !== null || live.placementActive;

  return {
    marker: {
      visible: markerVisible,
      circleIdle: outcomeLabel === null && !live.placementActive,
      heading,
      button:
        markerVisible && outcomeLabel === null
          ? resolveMarkerButton(state, live, caps)
          : null,
      outcomeLabel,
    },
    path: renderPath ? { visible: true } : null,
    placement,
    appNavigationState,
    shouldStreamGoal,
  };
}

export function shouldRenderNavigationPath(view: NavViewState | null): boolean {
  return Boolean(view?.path?.visible);
}

export function deriveAppNavigationState(
  view: NavViewState | null,
): AppNavigationState {
  return view?.appNavigationState ?? "off";
}

export function touchNavStatus(state: NavEngineState, now: number): NavEngineState {
  return {
    ...state,
    lastNavStatusTime: now,
    navStatusResyncCooldownS: NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
  };
}

export function checkNavLifecycleStaleness(
  state: NavEngineState,
  now: number = 0,
): "ok" | "request_resync" | "recover_local" {
  if (state.goal === null) {
    return "ok";
  }
  const elapsed = now - state.lastNavStatusTime;
  if (elapsed < NAV_STATUS_STALE_TIMEOUT_S) {
    return "ok";
  }
  if (now - state.lastNavStatusResyncTime >= state.navStatusResyncCooldownS) {
    return "request_resync";
  }
  if (now - state.goal.since >= NAV_STATUS_LOCAL_RECOVERY_S) {
    return "recover_local";
  }
  return "ok";
}

export function bumpNavResyncCooldown(state: NavEngineState, now: number): NavEngineState {
  return {
    ...state,
    lastNavStatusResyncTime: now,
    navStatusResyncCooldownS: Math.min(
      state.navStatusResyncCooldownS * 2.0,
      NAV_STATUS_RESYNC_MAX_COOLDOWN_S,
    ),
  };
}

function clearGoal(state: NavEngineState): NavEngineState {
  return { ...state, goal: null };
}

function startGoal(state: NavEngineState, now: number, navigating: boolean): NavEngineState {
  return {
    ...state,
    goal: { since: now, navigating },
    lastNavStatusTime: now,
  };
}

function markNavigating(state: NavEngineState, now: number): NavEngineState {
  if (state.goal === null) {
    return state;
  }
  return {
    ...state,
    goal: { since: state.goal.since, navigating: true },
    lastNavStatusTime: now,
  };
}

function derivePlacementInteractionPolicy(
  state: NavEngineState,
  placementActive: boolean,
): PlacementInteractionPolicy {
  const view = deriveViewState(
    state,
    {
      placementActive,
      activelyDragging: false,
      markerExists: true,
      outcomeAnimating: false,
    },
    { cancelAvailable: true, sessionActive: state.armed },
  );
  return view?.placement ?? { dragEnabled: false, followRobot: false };
}

export function applyNavigationEvent(
  state: NavEngineState,
  event: NavigationEvent,
  now: number = 0,
): NavigationModelResult {
  const effects: NavigationEffect[] = [];
  let next: NavEngineState = { ...state };

  const push = (...items: NavigationEffect[]): void => {
    effects.push(...items);
  };

  switch (event.kind) {
    case "arm": {
      next.armed = true;
      next.goal = null;
      push(
        { kind: "clearPath" },
        { kind: "syncAppNavigationState" },
        { kind: "syncMarkerPresentation" },
        {
          kind: "setPlacementInteraction",
          policy: derivePlacementInteractionPolicy(next, false),
        },
      );
      break;
    }
    case "disarm": {
      next = clearGoal({ ...next, armed: false });
      next.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;
      push(
        { kind: "stopPlacement" },
        { kind: "destroyMarker" },
        { kind: "clearPath" },
        { kind: "syncAppNavigationState" },
      );
      break;
    }
    case "goalCommitRequested": {
      const starting = next.goal === null;
      if (starting) {
        next = startGoal(next, now, false);
      } else {
        next = { ...next, lastNavStatusTime: now };
      }
      if (starting) {
        push({ kind: "resetNavigationOutcome" });
      }
      if (event.sendToBridge) {
        push({ kind: "sendNavGoal", pose: event.pose });
      }
      push({ kind: "syncAppNavigationState" }, { kind: "syncMarkerPresentation" });
      break;
    }
    case "navigating": {
      if (next.goal !== null) {
        next = markNavigating(next, now);
        push({ kind: "syncAppNavigationState" }, { kind: "syncMarkerPresentation" });
      }
      break;
    }
    case "navStatusGoalReached": {
      if (next.goal === null) {
        break;
      }
      next = clearGoal(next);
      push(
        { kind: "clearPath" },
        { kind: "reanchorMarkerToRobot" },
        { kind: "syncAppNavigationState" },
        { kind: "syncMarkerPresentation" },
      );
      break;
    }
    case "navStatusGoalFailed":
    case "staleRecovery": {
      if (next.goal === null) {
        break;
      }
      next = clearGoal(next);
      push(
        { kind: "clearPath" },
        { kind: "beginOutcomeAnimation", label: "Failed" },
        { kind: "syncAppNavigationState" },
      );
      break;
    }
    case "navStatusRecovering": {
      if (next.goal === null) {
        break;
      }
      next = clearGoal(next);
      push(
        { kind: "clearPath" },
        { kind: "respawnMarkerAt", animated: true },
        { kind: "syncAppNavigationState" },
        { kind: "syncMarkerPresentation" },
      );
      break;
    }
    case "cancelRequested":
    case "estopRequested": {
      next = clearGoal(next);
      push(
        { kind: "clearPath" },
        { kind: "beginOutcomeAnimation", label: "Cancelled" },
        { kind: "syncAppNavigationState" },
      );
      break;
    }
    case "outcomeAnimationFinished": {
      push({ kind: "syncAppNavigationState" }, { kind: "syncMarkerPresentation" });
      break;
    }
    case "disconnect": {
      next = clearGoal({ ...next, armed: false });
      next.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;
      push(
        { kind: "stopPlacement" },
        { kind: "destroyMarker" },
        { kind: "clearPath" },
        { kind: "syncAppNavigationState" },
      );
      break;
    }
    default:
      break;
  }

  return { state: next, effects };
}
