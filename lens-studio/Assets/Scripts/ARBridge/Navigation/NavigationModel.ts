import type {
  NavigationState,
  NavTerminalOutcome,
  WireNavigationState,
} from "../../App/AppState";
import type { NavStallReason, WireGoalSource } from "../Network/Protocol";

// ================================================================
/** Pure navigation model: stored facts, derived presentation, event rule book. */
// ================================================================

export type NavPose = {
  position: vec3;
  rotation: quat;
};

export type GoalTrack = {
  since: number;
  source: WireGoalSource;
  position?: [number, number, number];
  orientation?: [number, number, number, number];
} | null;

export type NavPresentationLatch =
  | { kind: "none" }
  | { kind: "resolved"; label: "Cancelled" | "Failed" };

export type NavigationSession = {
  navSessionActive: boolean;
  wireState: WireNavigationState | null;
  goal: GoalTrack;
  presentation: NavPresentationLatch;
  lastNavStatusTime: number;
  lastNavStatusResyncTime: number;
  navStatusResyncCooldownS: number;
};

export type NavigationInputs = {
  placementActive: boolean;
  activelyDragging: boolean;
  markerExists: boolean;
  markerPose: NavPose | null;
  cancelAvailable: boolean;
};

export const GOAL_SEND_INTERVAL_S = 0.35;
export const GOAL_SEND_MIN_DISTANCE_CM = 20.0;
export const GOAL_FORCE_NOOP_DISTANCE_CM = 2.0;

export const NAV_STATUS_STALE_TIMEOUT_S = 8.0;
export const NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S = 2.0;
export const NAV_STATUS_RESYNC_MAX_COOLDOWN_S = 8.0;
export const NAV_STATUS_LOCAL_RECOVERY_S = 16.0;

export type NavMarkerViewState = {
  visible: boolean;
  active: boolean;
  heading: quat;
  button: { role: "cancel"; enabled: boolean; label: string } | null;
  outcomeLabel: string | null;
};

export type NavigationEvent =
  | { kind: "sessionOn" }
  | { kind: "sessionOff" }
  | {
      kind: "commitGoal";
      sendToBridge: boolean;
      pose: NavPose;
    }
  | {
      kind: "navStatus";
      state: WireNavigationState;
      outcome?: NavTerminalOutcome;
      retryable?: boolean;
      stall_reason?: NavStallReason;
      goal?: {
        source: WireGoalSource;
        position: [number, number, number];
        orientation: [number, number, number, number];
      };
    }
  | { kind: "cancelRequested" }
  | { kind: "estopRequested" }
  | { kind: "disconnect" }
  | { kind: "watchdogFailed" }
  | { kind: "pathReceived" }
  | { kind: "presentationCleared" }
  | { kind: "resolvedPresentationFinished" };

export type NavigationEffect =
  | { kind: "sendNavGoal"; pose: NavPose }
  | { kind: "sendCancelGoal" };

export type NavigationModelResult = {
  state: NavigationSession;
  wireEffects: NavigationEffect[];
};

export function createInitialNavigationSession(now: number = 0): NavigationSession {
  return {
    navSessionActive: false,
    wireState: null,
    goal: null,
    presentation: { kind: "none" },
    lastNavStatusTime: now - NAV_STATUS_STALE_TIMEOUT_S,
    lastNavStatusResyncTime: now - NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
    navStatusResyncCooldownS: NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
  };
}

/** @deprecated Use createInitialNavigationSession */
export const createInitialNavEngineState = createInitialNavigationSession;

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

export function deriveNavigationState(
  session: NavigationSession,
  inputs: NavigationInputs,
): NavigationState {
  if (!session.navSessionActive) {
    return "disabled";
  }
  if (session.presentation.kind === "resolved") {
    return "resolved";
  }
  if (inputs.placementActive && session.wireState !== "navigating") {
    return "navIntent";
  }
  if (session.wireState !== null) {
    return session.wireState;
  }
  if (session.goal !== null || inputs.placementActive) {
    return "navIntent";
  }
  return "idle";
}

export function markerActive(state: NavigationState): boolean {
  return state === "navIntent" || state === "navigating";
}

export function shouldRenderNavigationPath(navigationState: NavigationState): boolean {
  return markerActive(navigationState);
}

export function shouldSuppressTerminalNavState(live: {
  placementActive: boolean;
  activelyDragging: boolean;
  markerMovedSinceLastGoal: boolean;
}): boolean {
  return (
    live.placementActive &&
    (live.activelyDragging || live.markerMovedSinceLastGoal)
  );
}

export type RetryableNavIntentAction =
  | "holdNavIntent"
  | "holdNavigating"
  | "clearGoal";

export function resolveRetryableNavIntent(
  session: NavigationSession,
  suppressTerminal: boolean,
): RetryableNavIntentAction {
  if (suppressTerminal) {
    return "holdNavIntent";
  }
  if (session.wireState === "navigating") {
    return "holdNavigating";
  }
  return "clearGoal";
}

export function shouldSkipStaleLocalRecovery(
  session: NavigationSession,
  bridgePathWaypointCount: number,
): boolean {
  return session.wireState === "navigating" && bridgePathWaypointCount >= 2;
}

export function deriveMarkerViewState(
  session: NavigationSession,
  inputs: NavigationInputs,
  navigationState: NavigationState,
): NavMarkerViewState | null {
  if (!session.navSessionActive || !inputs.markerExists) {
    return null;
  }

  const active = markerActive(navigationState);
  const outcomeLabel =
    session.presentation.kind === "resolved"
      ? session.presentation.label
      : null;
  const heading = inputs.markerPose?.rotation ?? quat.quatIdentity();

  return {
    visible: navigationState !== "disabled",
    active: outcomeLabel === null && active,
    heading,
    button:
      outcomeLabel === null && active && !inputs.activelyDragging
        ? {
            role: "cancel",
            enabled: true,
            label: inputs.cancelAvailable ? "Cancel" : "Cancel\nUnavailable",
          }
        : null,
    outcomeLabel,
  };
}

export function idleAnchorEnabled(navigationState: NavigationState): boolean {
  return navigationState === "idle";
}

export function dragEnabledForState(navigationState: NavigationState): boolean {
  return (
    navigationState === "idle" ||
    navigationState === "navIntent" ||
    navigationState === "navigating"
  );
}

export function touchNavStatus(session: NavigationSession, now: number): NavigationSession {
  return {
    ...session,
    lastNavStatusTime: now,
    navStatusResyncCooldownS: NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
  };
}

export function checkNavLifecycleStaleness(
  session: NavigationSession,
  now: number = 0,
): "ok" | "request_resync" | "recover_local" {
  if (session.goal === null) {
    return "ok";
  }
  const elapsed = now - session.lastNavStatusTime;
  if (elapsed < NAV_STATUS_STALE_TIMEOUT_S) {
    return "ok";
  }
  if (now - session.lastNavStatusResyncTime >= session.navStatusResyncCooldownS) {
    return "request_resync";
  }
  if (now - session.goal.since >= NAV_STATUS_LOCAL_RECOVERY_S) {
    return "recover_local";
  }
  return "ok";
}

export function bumpNavResyncCooldown(session: NavigationSession, now: number): NavigationSession {
  return {
    ...session,
    lastNavStatusResyncTime: now,
    navStatusResyncCooldownS: Math.min(
      session.navStatusResyncCooldownS * 2.0,
      NAV_STATUS_RESYNC_MAX_COOLDOWN_S,
    ),
  };
}

function clearGoal(session: NavigationSession): NavigationSession {
  return { ...session, goal: null };
}

function startGoal(session: NavigationSession, now: number): NavigationSession {
  return {
    ...session,
    goal: { since: now, source: "user" },
    lastNavStatusTime: now,
  };
}

function applyNavStatusEvent(
  session: NavigationSession,
  event: Extract<NavigationEvent, { kind: "navStatus" }>,
  now: number,
): NavigationSession {
  let next: NavigationSession = {
    ...session,
    wireState: event.state,
  };

  if (event.state === "navIntent" && event.retryable) {
    return clearGoal(next);
  }
  if (event.state === "resolved" && event.outcome === "succeeded") {
    return { ...clearGoal(next), wireState: "idle" };
  }
  if (event.state === "resolved" && event.outcome === "failed") {
    return {
      ...clearGoal(next),
      presentation: { kind: "resolved", label: "Failed" },
    };
  }
  if (event.state === "idle") {
    return { ...clearGoal(next), wireState: "idle" };
  }
  if (event.goal) {
    next = {
      ...next,
      goal: {
        since: session.goal?.since ?? now,
        source: event.goal.source,
        position: event.goal.position,
        orientation: event.goal.orientation,
      },
    };
  }
  return next;
}

export function applyNavigationEvent(
  session: NavigationSession,
  event: NavigationEvent,
  now: number = 0,
): NavigationModelResult {
  const wireEffects: NavigationEffect[] = [];
  let next: NavigationSession = { ...session };

  const push = (...items: NavigationEffect[]): void => {
    wireEffects.push(...items);
  };

  switch (event.kind) {
    case "sessionOn": {
      next.navSessionActive = true;
      next.goal = null;
      next.wireState = null;
      next.presentation = { kind: "none" };
      break;
    }
    case "sessionOff": {
      next = clearGoal({
        ...next,
        navSessionActive: false,
        wireState: null,
        presentation: { kind: "none" },
      });
      next.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;
      break;
    }
    case "commitGoal": {
      const starting = next.goal === null;
      if (starting) {
        next = startGoal(next, now);
      } else {
        next = {
          ...next,
          lastNavStatusTime: now,
          goal: {
            since: next.goal!.since,
            source: "user",
            // Keep prior wire pose until the next nav_status confirms the new goal.
            position: next.goal!.position,
            orientation: next.goal!.orientation,
          },
        };
      }
      if (event.sendToBridge) {
        push({ kind: "sendNavGoal", pose: event.pose });
      }
      break;
    }
    case "navStatus": {
      next = applyNavStatusEvent(next, event, now);
      break;
    }
    case "cancelRequested": {
      next = {
        ...clearGoal(next),
        wireState: "idle",
        presentation: { kind: "resolved", label: "Cancelled" },
      };
      push({ kind: "sendCancelGoal" });
      break;
    }
    case "estopRequested": {
      next = {
        ...clearGoal(next),
        wireState: "idle",
        presentation: { kind: "resolved", label: "Cancelled" },
      };
      break;
    }
    case "pathReceived": {
      next = touchNavStatus(next, now);
      if (next.goal !== null) {
        next = { ...next, wireState: "navigating" };
      }
      break;
    }
    case "presentationCleared": {
      if (next.presentation.kind === "resolved") {
        next.presentation = { kind: "none" };
      }
      break;
    }
    case "watchdogFailed": {
      if (next.goal === null) {
        break;
      }
      next = {
        ...clearGoal(next),
        wireState: "idle",
        presentation: { kind: "resolved", label: "Failed" },
      };
      break;
    }
    case "resolvedPresentationFinished": {
      next.presentation = { kind: "none" };
      if (next.wireState === "resolved") {
        next.wireState = "idle";
      }
      break;
    }
    case "disconnect": {
      next = clearGoal({
        ...next,
        navSessionActive: false,
        wireState: null,
        presentation: { kind: "none" },
      });
      next.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;
      break;
    }
    default:
      break;
  }

  return { state: next, wireEffects };
}
