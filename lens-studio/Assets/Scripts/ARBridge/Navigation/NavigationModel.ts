import type { NavigationState as AppNavigationState } from "../../App/AppState";

// ================================================================
/** Pure navigation model: stored facts, derived presentation, event rule book. */
// ================================================================

export type NavGoalMode = "single" | "continuous";
export type NavGoalSource = "user" | "remote";

export type NavGoalConfig = {
  mode: NavGoalMode;
  source: NavGoalSource;
  interactive: boolean;
  force?: boolean;
};

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
  activeConfig: NavGoalConfig | null;
  goal: GoalTrack;
  lastNavStatusTime: number;
  lastNavStatusResyncTime: number;
  navStatusResyncCooldownS: number;
  lastLocalGoalPose: NavPose | null;
};

export const NAV_GOAL_ECHO_SUPPRESS_DISTANCE_CM = 25.0;
export const GOAL_SEND_INTERVAL_S = 0.35;
export const GOAL_SEND_MIN_DISTANCE_CM = 20.0;
export const GOAL_FORCE_NOOP_DISTANCE_CM = 2.0;

export const NAV_STATUS_STALE_TIMEOUT_S = 8.0;
export const NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S = 2.0;
export const NAV_STATUS_RESYNC_MAX_COOLDOWN_S = 8.0;
export const NAV_STATUS_LOCAL_RECOVERY_S = 16.0;

export type NavigationGoalMode = NavGoalMode;

export type NavPhase =
  | { kind: "idle" }
  | { kind: "placing"; pose: NavPose }
  | { kind: "committed"; pose: NavPose; navigating: boolean; since: number }
  | { kind: "outcome"; label: "Cancelled" | "Failed"; prev: NavPose | null };

export type GoalCommitKind = "confirm" | "stream" | "direct";

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
  confirmAvailable: boolean;
  sessionActive: boolean;
};

export type NavMarkerViewState = {
  visible: boolean;
  style: "seeking" | "preview" | "navigating" | "outcome";
  heading: quat;
  button: { role: "confirm" | "cancel"; enabled: boolean; label: string } | null;
  outcomeLabel: string | null;
  scanAnimation: boolean;
  arrowSpeed: number;
  /** Circle_Seeking mesh (single-mode seeking/outcome). */
  portalCircleVisible: boolean;
  /** Circle_Navigating mesh (continuous mode). */
  navigatingCircleVisible: boolean;
};

export type NavViewState = {
  marker: NavMarkerViewState;
  path: { style: "preview" | "navigating" } | null;
  placement: { dragEnabled: boolean; followRobot: boolean };
  appNavigationState: AppNavigationState;
  shouldRequestPreview: boolean;
  shouldStreamGoal: boolean;
  goalCommitVia: GoalCommitKind | null;
};

export type PlacementInteractionPolicy = {
  dragEnabled: boolean;
  followRobot: boolean;
};

export type NavigationEvent =
  | { kind: "arm"; config: NavGoalConfig }
  | { kind: "disarm" }
  | { kind: "configChanged"; config: NavGoalConfig }
  | {
      kind: "goalCommitRequested";
      config: NavGoalConfig;
      commitKind: GoalCommitKind;
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
  | { kind: "outcomeAnimationFinished" }
  | {
      kind: "navGoalUpdate";
      source: "xr" | "agent";
      pose: NavPose;
      active: boolean;
    };

export type NavigationEffect =
  | { kind: "syncAppNavigationState" }
  | { kind: "syncMarkerPresentation" }
  | { kind: "sendNavGoal"; pose: NavPose }
  | { kind: "sendCancelGoal" }
  | { kind: "clearPath" }
  | { kind: "resetNavigationOutcome" }
  | { kind: "destroyMarker" }
  | { kind: "respawnMarkerAt"; pose?: NavPose; animated?: boolean }
  | { kind: "ensureMarkerAt"; pose: NavPose; config: NavGoalConfig }
  | { kind: "setPlacementInteraction"; policy: PlacementInteractionPolicy }
  | { kind: "beginOutcomeAnimation"; label: "Cancelled" | "Failed" }
  | { kind: "stopPlacement" };

export type NavigationModelResult = {
  state: NavEngineState;
  effects: NavigationEffect[];
};

export const NAV_GOAL_MODE_LABELS: Record<NavigationGoalMode, string> = {
  single: "Single Goal",
  continuous: "Continuous Movement",
};

export function createInitialNavEngineState(now: number = 0): NavEngineState {
  return {
    activeConfig: null,
    goal: null,
    lastNavStatusTime: now - NAV_STATUS_STALE_TIMEOUT_S,
    lastNavStatusResyncTime: now - NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
    navStatusResyncCooldownS: NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
    lastLocalGoalPose: null,
  };
}

export function nextNavigationGoalMode(mode: NavigationGoalMode): NavigationGoalMode {
  return mode === "single" ? "continuous" : "single";
}

export function isContinuousNavigationMode(mode: NavigationGoalMode): boolean {
  return mode === "continuous";
}

export function manualNavGoalConfig(mode: NavigationGoalMode): NavGoalConfig {
  return { mode, source: "user", interactive: true };
}

export function directNavGoalConfig(mode: NavGoalMode = "single"): NavGoalConfig {
  return { mode, source: "user", interactive: false };
}

export function isInteractiveSession(state: NavEngineState): boolean {
  return state.activeConfig?.interactive === true;
}

export function remoteNavGoalConfig(): NavGoalConfig {
  return { mode: "single", source: "remote", interactive: false };
}

function poseDistanceCm(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function shouldIgnoreNavGoalUpdate(
  state: NavEngineState,
  source: "xr" | "agent",
  pose: NavPose,
): boolean {
  if (source !== "xr") {
    return false;
  }
  if (state.activeConfig?.source === "user") {
    return true;
  }
  if (
    state.lastLocalGoalPose &&
    poseDistanceCm(state.lastLocalGoalPose.position, pose.position) <
      NAV_GOAL_ECHO_SUPPRESS_DISTANCE_CM
  ) {
    return true;
  }
  return false;
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
  if (live.outcomeAnimating && live.outcomeLabel) {
    return {
      kind: "outcome",
      label: live.outcomeLabel,
      prev: live.markerPose ?? null,
    };
  }
  if (!state.activeConfig || !live.markerExists) {
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

function isNavigatingDisplay(
  config: NavGoalConfig,
  goal: GoalTrack,
): boolean {
  if (!goal) {
    return false;
  }
  if (config.mode === "single" || config.force) {
    return true;
  }
  return goal.navigating;
}

function isAwaitingConfirm(
  config: NavGoalConfig,
  goal: GoalTrack,
  placementActive: boolean,
): boolean {
  return (
    config.mode === "single" &&
    config.interactive &&
    placementActive &&
    goal === null
  );
}

function markerStyleFromPhase(
  phase: NavPhase,
  config: NavGoalConfig,
  placementActive: boolean,
): NavMarkerViewState["style"] {
  if (phase.kind === "outcome") {
    return "outcome";
  }
  if (phase.kind === "committed") {
    if (isNavigatingDisplay(config, { since: phase.since, navigating: phase.navigating })) {
      return "navigating";
    }
    return "preview";
  }
  if (phase.kind === "placing") {
    return placementActive ? "preview" : "seeking";
  }
  return "seeking";
}

function resolveMarkerButton(
  style: NavMarkerViewState["style"],
  config: NavGoalConfig,
  caps: CapabilityView,
  activelyDragging: boolean,
): NavMarkerViewState["button"] {
  if (style === "seeking" || style === "outcome") {
    return null;
  }
  if (activelyDragging) {
    return null;
  }
  if (style === "preview") {
    if (config.mode === "continuous") {
      return {
        role: "cancel",
        enabled: caps.cancelAvailable,
        label: caps.cancelAvailable ? "Cancel" : "Cancel\nUnavailable",
      };
    }
    return {
      role: "confirm",
      enabled: caps.confirmAvailable,
      label: caps.confirmAvailable ? "Confirm" : "Confirm\nUnavailable",
    };
  }
  return {
    role: "cancel",
    enabled: caps.cancelAvailable,
    label: caps.cancelAvailable ? "Cancel" : "Cancel\nUnavailable",
  };
}

export function deriveViewState(
  state: NavEngineState,
  live: NavLiveContext,
  caps: CapabilityView,
): NavViewState | null {
  const config = state.activeConfig;
  if (!config) {
    return null;
  }

  const phase = deriveNavPhase(state, live);
  const markerVisible = live.markerExists && phase.kind !== "idle";
  const style = markerVisible ? markerStyleFromPhase(phase, config, live.placementActive) : "seeking";
  const heading = live.markerPose?.rotation ?? quat.quatIdentity();
  const continuous = config.mode === "continuous";
  const navigating = style === "navigating";
  const preview = style === "preview";

  const placement: PlacementInteractionPolicy = (() => {
    if (!config.interactive || live.outcomeAnimating) {
      return { dragEnabled: false, followRobot: false };
    }
    if (state.goal === null) {
      return {
        dragEnabled: true,
        followRobot: !live.placementActive,
      };
    }
    return {
      dragEnabled: continuous && config.interactive,
      followRobot: false,
    };
  })();

  let appNavigationState: AppNavigationState = "off";
  if (caps.sessionActive) {
    if (navigating) {
      appNavigationState = "navigating";
    } else if (config.interactive && live.placementActive) {
      appNavigationState = "placingGoal";
    } else if (config.interactive) {
      appNavigationState = "armed";
    }
  }

  const shouldStreamGoal =
    config.interactive &&
    continuous &&
    live.placementActive;

  const shouldRequestPreview =
    config.interactive &&
    isAwaitingConfirm(config, state.goal, live.placementActive);

  let goalCommitVia: GoalCommitKind | null = null;
  if (!config.interactive) {
    goalCommitVia = "direct";
  } else if (isAwaitingConfirm(config, state.goal, live.placementActive)) {
    goalCommitVia = "confirm";
  } else if (shouldStreamGoal) {
    goalCommitVia = "stream";
  }

  const renderPath =
    state.goal !== null ||
    (config.interactive && live.placementActive);

  const pathStyle: "preview" | "navigating" | null = !renderPath
    ? null
    : navigating
      ? "navigating"
      : preview || live.placementActive
        ? "preview"
        : null;

  return {
    marker: {
      visible: markerVisible,
      style,
      heading,
      button: markerVisible ? resolveMarkerButton(style, config, caps, live.activelyDragging) : null,
      outcomeLabel: phase.kind === "outcome" ? phase.label : null,
      scanAnimation: navigating,
      arrowSpeed: navigating ? 1 : 0,
      portalCircleVisible: continuous || style !== "navigating",
      navigatingCircleVisible:
        style === "navigating" || (continuous && style !== "outcome"),
    },
    path: pathStyle ? { style: pathStyle } : null,
    placement,
    appNavigationState,
    shouldRequestPreview,
    shouldStreamGoal,
    goalCommitVia,
  };
}

export function goalCommitAllowed(
  view: NavViewState | null,
  via: GoalCommitKind,
): boolean {
  if (!view) {
    return false;
  }
  if (via === "direct") {
    return view.goalCommitVia === "direct";
  }
  if (via === "confirm") {
    return view.goalCommitVia === "confirm";
  }
  return view.goalCommitVia === "stream";
}

export function shouldRequestPreviewOnTargetChange(view: NavViewState | null): boolean {
  return view?.shouldRequestPreview === true;
}

export function shouldRenderNavigationPath(view: NavViewState | null): boolean {
  return Boolean(view?.path);
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

function shouldRespawnAtRobotOnSuccess(config: NavGoalConfig): boolean {
  return config.interactive;
}

function shouldDeleteMarkerOnSuccess(config: NavGoalConfig): boolean {
  return !config.interactive;
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
  outcomeAnimating: boolean,
): PlacementInteractionPolicy {
  const view = deriveViewState(
    state,
    { placementActive, activelyDragging: false, markerExists: true, outcomeAnimating },
    { cancelAvailable: true, confirmAvailable: true, sessionActive: state.activeConfig !== null },
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
      next.activeConfig = event.config;
      next.goal = null;
      push(
        { kind: "clearPath" },
        { kind: "syncAppNavigationState" },
        { kind: "syncMarkerPresentation" },
        {
          kind: "setPlacementInteraction",
          policy: derivePlacementInteractionPolicy(next, false, false),
        },
      );
      break;
    }
    case "disarm": {
      next = clearGoal({ ...next, activeConfig: null });
      next.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;
      push(
        { kind: "stopPlacement" },
        { kind: "destroyMarker" },
        { kind: "clearPath" },
        { kind: "syncAppNavigationState" },
      );
      break;
    }
    case "configChanged": {
      const hadGoal = next.goal !== null;
      if (hadGoal) {
        push({ kind: "sendCancelGoal" }, { kind: "clearPath" });
        next = clearGoal(next);
      }
      next.activeConfig = event.config;
      if (next.activeConfig?.interactive) {
        push({ kind: "respawnMarkerAt", animated: false });
      }
      push(
        { kind: "syncAppNavigationState" },
        { kind: "syncMarkerPresentation" },
        {
          kind: "setPlacementInteraction",
          policy: derivePlacementInteractionPolicy(next, false, false),
        },
      );
      break;
    }
    case "goalCommitRequested": {
      next.activeConfig = event.config;
      const starting = next.goal === null;
      if (starting) {
        next = startGoal(next, now, false);
      } else if (event.commitKind === "stream") {
        next = { ...next, lastNavStatusTime: now };
      }
      if (starting || event.commitKind === "confirm" || event.commitKind === "direct") {
        push({ kind: "resetNavigationOutcome" });
      }
      if (event.sendToBridge) {
        push({ kind: "sendNavGoal", pose: event.pose });
        next = { ...next, lastLocalGoalPose: event.pose };
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
      push({ kind: "clearPath" });
      const config = next.activeConfig;
      if (config && shouldRespawnAtRobotOnSuccess(config)) {
        push({ kind: "respawnMarkerAt", animated: false });
      } else if (config && shouldDeleteMarkerOnSuccess(config)) {
        push({ kind: "destroyMarker" }, { kind: "stopPlacement" });
        next.activeConfig = null;
      }
      push({ kind: "syncAppNavigationState" }, { kind: "syncMarkerPresentation" });
      break;
    }
    case "navStatusGoalFailed":
    case "staleRecovery": {
      if (next.goal === null) {
        break;
      }
      next = clearGoal(next);
      push(
        { kind: "sendCancelGoal" },
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
    case "disconnect": {
      next = clearGoal({ ...next, activeConfig: null });
      next.navStatusResyncCooldownS = NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S;
      push(
        { kind: "stopPlacement" },
        { kind: "destroyMarker" },
        { kind: "clearPath" },
        { kind: "syncAppNavigationState" },
      );
      break;
    }
    case "outcomeAnimationFinished": {
      push({ kind: "syncAppNavigationState" }, { kind: "syncMarkerPresentation" });
      break;
    }
    case "navGoalUpdate": {
      if (shouldIgnoreNavGoalUpdate(next, event.source, event.pose)) {
        break;
      }
      if (!event.active) {
        if (next.activeConfig?.source === "remote") {
          next = clearGoal({ ...next, activeConfig: null });
          push(
            { kind: "stopPlacement" },
            { kind: "destroyMarker" },
            { kind: "clearPath" },
            { kind: "syncAppNavigationState" },
          );
        }
        break;
      }
      const config = remoteNavGoalConfig();
      next.activeConfig = config;
      if (next.goal === null) {
        next = startGoal(next, now, true);
      } else {
        next = {
          ...next,
          goal: { since: next.goal.since, navigating: true },
          lastNavStatusTime: now,
        };
      }
      push(
        { kind: "ensureMarkerAt", pose: event.pose, config },
        { kind: "syncAppNavigationState" },
        { kind: "syncMarkerPresentation" },
        {
          kind: "setPlacementInteraction",
          policy: { dragEnabled: false, followRobot: false },
        },
      );
      break;
    }
    default:
      break;
  }

  return { state: next, effects };
}
