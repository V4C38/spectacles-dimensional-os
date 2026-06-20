import type { NavigationState as AppNavigationState } from "../Core/AppState";

// ================================================================
/** Pure navigation model: stored facts, derived presentation, event rule book. */
// ================================================================

export type NavGoalMode = "single" | "continuous";

export type NavGoalConfig = {
  mode: NavGoalMode;
  allowDrag: boolean;
  force?: boolean;
};

export type ActiveGoal = {
  since: number;
  following: boolean;
};

export type GoalTrack = ActiveGoal | null;

export type NavEngineState = {
  activeConfig: NavGoalConfig | null;
  goal: GoalTrack;
  lastNavStatusTime: number;
  lastNavStatusResyncTime: number;
  navStatusResyncCooldownS: number;
};

export const NAV_STATUS_STALE_TIMEOUT_S = 8.0;
export const NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S = 2.0;
export const NAV_STATUS_RESYNC_MAX_COOLDOWN_S = 8.0;
export const NAV_STATUS_LOCAL_RECOVERY_S = 16.0;

export type NavigationGoalMode = NavGoalMode;

export type NavigationGoalPolicy = "none" | "preview" | "commit" | "stream" | "direct";

export type GoalCommitKind = "confirm" | "stream" | "direct";

export type MarkerPresentationKind = "hidden" | "seeking" | "preview" | "executing";

export type NavigationMarkerPreset = {
  circleExecuting: boolean;
  portalCircleVisible: boolean;
  lookAtEnabled: boolean;
  confirmVisible: boolean;
  useExecutingButtonPresentation: boolean;
  resetCircleBeforeShow: boolean;
  scanAnimation: boolean;
  confirmVfx: "confirm" | "cancel" | "hidden";
  arrowEnabled: boolean;
  arrowSpeed: number;
  circleSaturation: { circle: "portal" | "executing"; value: number } | null;
  dotsMode: "seeking" | "executing";
  restoreOutcomeFirst: boolean;
  animateRootVisible: boolean | null;
  animateCircleExpanded: boolean | null;
};

export type NavigationBehaviorSpec = {
  previewPhase: boolean;
  confirmToStart: boolean;
  streamGoals: boolean;
  dragWhileNavigating: boolean;
  usesPlacement: boolean;
  respawnAtRobotOnSuccess: boolean;
  deleteMarkerOnSuccess: boolean;
};

export type NavViewContext = {
  config: NavGoalConfig;
  goal: GoalTrack;
  placementActive: boolean;
  markerExists: boolean;
  outcomeAnimating: boolean;
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
    }
  | { kind: "bridgePathReceived" }
  | { kind: "bridgeFollowing" }
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
  | { kind: "sendNavGoal" }
  | { kind: "sendCancelGoal" }
  | { kind: "clearPath" }
  | { kind: "enterExecutingVisuals" }
  | { kind: "resetNavigationOutcome" }
  | { kind: "destroyMarker" }
  | { kind: "respawnMarkerAtRobot" }
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

const HIDDEN_PRESET: NavigationMarkerPreset = {
  circleExecuting: false,
  portalCircleVisible: false,
  lookAtEnabled: false,
  confirmVisible: false,
  useExecutingButtonPresentation: false,
  resetCircleBeforeShow: false,
  scanAnimation: false,
  confirmVfx: "hidden",
  arrowEnabled: false,
  arrowSpeed: 0,
  circleSaturation: null,
  dotsMode: "seeking",
  restoreOutcomeFirst: true,
  animateRootVisible: null,
  animateCircleExpanded: null,
};

const SEEKING_PRESET: NavigationMarkerPreset = {
  circleExecuting: false,
  portalCircleVisible: true,
  lookAtEnabled: false,
  confirmVisible: false,
  useExecutingButtonPresentation: false,
  resetCircleBeforeShow: true,
  scanAnimation: false,
  confirmVfx: "confirm",
  arrowEnabled: false,
  arrowSpeed: 0,
  circleSaturation: { circle: "portal", value: 0 },
  dotsMode: "seeking",
  restoreOutcomeFirst: true,
  animateRootVisible: true,
  animateCircleExpanded: true,
};

const PREVIEW_PRESET: NavigationMarkerPreset = {
  ...SEEKING_PRESET,
  confirmVisible: true,
  confirmVfx: "confirm",
  resetCircleBeforeShow: false,
};

const EXECUTING_SINGLE_PRESET: NavigationMarkerPreset = {
  circleExecuting: true,
  portalCircleVisible: false,
  lookAtEnabled: false,
  confirmVisible: true,
  useExecutingButtonPresentation: true,
  resetCircleBeforeShow: false,
  scanAnimation: true,
  confirmVfx: "cancel",
  arrowEnabled: true,
  arrowSpeed: 1,
  circleSaturation: { circle: "executing", value: 1 },
  dotsMode: "executing",
  restoreOutcomeFirst: false,
  animateRootVisible: null,
  animateCircleExpanded: null,
};

const EXECUTING_CONTINUOUS_PRESET: NavigationMarkerPreset = {
  ...EXECUTING_SINGLE_PRESET,
  portalCircleVisible: true,
};

export const OUTCOME_RESET_PRESET: NavigationMarkerPreset = {
  circleExecuting: false,
  portalCircleVisible: true,
  lookAtEnabled: false,
  confirmVisible: false,
  useExecutingButtonPresentation: false,
  resetCircleBeforeShow: false,
  scanAnimation: false,
  confirmVfx: "hidden",
  arrowEnabled: false,
  arrowSpeed: 0,
  circleSaturation: null,
  dotsMode: "seeking",
  restoreOutcomeFirst: true,
  animateRootVisible: null,
  animateCircleExpanded: null,
};

export function createInitialNavEngineState(now: number = 0): NavEngineState {
  return {
    activeConfig: null,
    goal: null,
    lastNavStatusTime: now - NAV_STATUS_STALE_TIMEOUT_S,
    lastNavStatusResyncTime: now - NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
    navStatusResyncCooldownS: NAV_STATUS_RESYNC_INITIAL_COOLDOWN_S,
  };
}

export function nextNavigationGoalMode(mode: NavigationGoalMode): NavigationGoalMode {
  return mode === "single" ? "continuous" : "single";
}

export function isFollowingMode(mode: NavigationGoalMode): boolean {
  return mode === "continuous";
}

export function manualNavGoalConfig(mode: NavigationGoalMode): NavGoalConfig {
  return { mode, allowDrag: true };
}

export function navBehavior(
  config: Pick<NavGoalConfig, "mode" | "allowDrag">,
): NavigationBehaviorSpec {
  const continuous = config.mode === "continuous";
  return {
    previewPhase: !continuous,
    confirmToStart: !continuous,
    streamGoals: continuous,
    dragWhileNavigating: continuous && config.allowDrag,
    usesPlacement: config.allowDrag,
    respawnAtRobotOnSuccess: config.allowDrag,
    deleteMarkerOnSuccess: !config.allowDrag,
  };
}

export function isDraggableSession(state: NavEngineState): boolean {
  return state.activeConfig?.allowDrag === true;
}

export function buildNavViewContext(
  state: NavEngineState,
  live: {
    placementActive: boolean;
    markerExists: boolean;
    outcomeAnimating: boolean;
  },
): NavViewContext | null {
  if (!state.activeConfig) {
    return null;
  }
  return {
    config: state.activeConfig,
    goal: state.goal,
    placementActive: live.placementActive,
    markerExists: live.markerExists,
    outcomeAnimating: live.outcomeAnimating,
  };
}

export function isAwaitingConfirm(ctx: NavViewContext): boolean {
  return (
    ctx.config.mode === "single" &&
    ctx.config.allowDrag &&
    ctx.placementActive &&
    ctx.goal === null
  );
}

export function deriveMarkerPresentation(ctx: NavViewContext): {
  kind: MarkerPresentationKind;
  preset: NavigationMarkerPreset;
} {
  if (!ctx.markerExists) {
    return { kind: "hidden", preset: HIDDEN_PRESET };
  }
  if (ctx.goal !== null) {
    const preset =
      ctx.config.mode === "continuous"
        ? EXECUTING_CONTINUOUS_PRESET
        : EXECUTING_SINGLE_PRESET;
    return { kind: "executing", preset };
  }
  if (isAwaitingConfirm(ctx)) {
    return { kind: "preview", preset: PREVIEW_PRESET };
  }
  return { kind: "seeking", preset: SEEKING_PRESET };
}

export function deriveAppNavigationState(
  ctx: NavViewContext | null,
  sessionActive: boolean,
): AppNavigationState {
  if (!ctx || !sessionActive) {
    return "off";
  }
  if (ctx.goal !== null) {
    return "executingGoal";
  }
  if (ctx.config.allowDrag && ctx.placementActive) {
    return "placingGoal";
  }
  if (ctx.config.allowDrag) {
    return "armed";
  }
  return "off";
}

export function navigationGoalPolicy(ctx: NavViewContext): NavigationGoalPolicy {
  if (!ctx.config.allowDrag) {
    return "direct";
  }
  if (isAwaitingConfirm(ctx)) {
    return "preview";
  }
  if (ctx.config.mode === "continuous" && ctx.goal !== null && ctx.placementActive) {
    return "stream";
  }
  if (
    ctx.config.mode === "single" &&
    ctx.placementActive &&
    ctx.goal !== null &&
    !ctx.goal.following
  ) {
    return "commit";
  }
  return "none";
}

export function goalCommitAllowed(ctx: NavViewContext, via: GoalCommitKind): boolean {
  if (via === "direct") {
    return true;
  }
  const policy = navigationGoalPolicy(ctx);
  if (via === "confirm") {
    return isAwaitingConfirm(ctx);
  }
  return policy === "stream";
}

export function shouldRequestPreviewOnTargetChange(ctx: NavViewContext | null): boolean {
  if (!ctx) {
    return false;
  }
  return navigationGoalPolicy(ctx) === "preview";
}

export function shouldRenderNavigationPath(ctx: NavViewContext | null): boolean {
  if (!ctx) {
    return false;
  }
  if (ctx.goal !== null) {
    return true;
  }
  if (!ctx.config.allowDrag) {
    return false;
  }
  return ctx.placementActive;
}

export function derivePlacementInteractionPolicy(
  state: NavEngineState,
  placementActive: boolean,
  outcomeAnimating: boolean,
): PlacementInteractionPolicy {
  const config = state.activeConfig;
  if (!config?.allowDrag || outcomeAnimating) {
    return { dragEnabled: false, followRobot: false };
  }
  if (state.goal === null) {
    return {
      dragEnabled: true,
      followRobot: !placementActive,
    };
  }
  const spec = navBehavior(config);
  return {
    dragEnabled: spec.dragWhileNavigating,
    followRobot: false,
  };
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

function startGoal(state: NavEngineState, now: number, following: boolean): NavEngineState {
  return {
    ...state,
    goal: { since: now, following },
    lastNavStatusTime: now,
  };
}

function markFollowing(state: NavEngineState, now: number): NavEngineState {
  if (state.goal === null) {
    return state;
  }
  return {
    ...state,
    goal: { since: state.goal.since, following: true },
    lastNavStatusTime: now,
  };
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
        push({ kind: "clearPath" }, { kind: "resetNavigationOutcome" });
      }
      if (event.sendToBridge) {
        push({ kind: "sendNavGoal" });
      }
      if (starting || event.commitKind !== "stream") {
        push({ kind: "enterExecutingVisuals" });
      }
      push({ kind: "syncAppNavigationState" }, { kind: "syncMarkerPresentation" });
      break;
    }
    case "bridgePathReceived": {
      if (next.goal !== null) {
        next = markFollowing(next, now);
        push({ kind: "enterExecutingVisuals" }, { kind: "syncMarkerPresentation" });
      }
      break;
    }
    case "bridgeFollowing": {
      if (next.goal !== null) {
        next = markFollowing(next, now);
        push(
          { kind: "syncAppNavigationState" },
          { kind: "syncMarkerPresentation" },
          { kind: "enterExecutingVisuals" },
        );
      }
      break;
    }
    case "navStatusGoalReached": {
      if (next.goal === null) {
        break;
      }
      next = clearGoal(next);
      push({ kind: "clearPath" });
      const spec = next.activeConfig ? navBehavior(next.activeConfig) : null;
      if (spec?.respawnAtRobotOnSuccess) {
        push({ kind: "respawnMarkerAtRobot" });
      } else if (spec?.deleteMarkerOnSuccess) {
        push({ kind: "destroyMarker" }, { kind: "stopPlacement" });
        next.activeConfig = null;
      }
      push({ kind: "syncAppNavigationState" }, { kind: "syncMarkerPresentation" });
      break;
    }
    case "navStatusGoalFailed":
    case "navStatusRecovering":
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
    default:
      break;
  }

  return { state: next, effects };
}
