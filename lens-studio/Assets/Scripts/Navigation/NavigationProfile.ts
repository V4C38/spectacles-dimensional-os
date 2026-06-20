import type { OperatingMode } from "../Core/AppState";

// ================================================================
/** Profile-driven navigation FSM: specs, transitions, and preset resolution. */
// ================================================================

export type NavigationMarkerProfile =
  | "manualSingle"
  | "manualContinuous"
  | "agentSingle"
  | "agentContinuous";

export type NavigationMarkerPhase =
  | "hidden"
  | "idle"
  | "preview"
  | "navigating"
  | "outcomeReset";

export type NavigationGoalMode = "single" | "continuous";

export type NavigationGoalPolicy = "none" | "preview" | "commit" | "redispatch";

export type GoalCommitVia = "confirm" | "stream" | "agent";

export type NavigationSessionEvent =
  | { kind: "navEnabled" }
  | { kind: "navDisabled" }
  | { kind: "dragThresholdCrossed" }
  | { kind: "confirmPressed" }
  | { kind: "cancelPressed" }
  | { kind: "goalDispatched" }
  | { kind: "goalReached" }
  | { kind: "goalFailed" }
  | { kind: "outcomeResetComplete" }
  | { kind: "profileChanged" }
  | { kind: "agentGoalSubmitted" };

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

export type NavigationProfileSpec = {
  usesSurfacePlacement: boolean;
  previewPhase: boolean;
  confirmToStart: boolean;
  dragWhileNavigating: boolean;
  streamGoals: boolean;
  respawnOnSuccess: boolean;
  showMarkerWhileIdle: boolean;
};

export const NAV_GOAL_MODE_LABELS: Record<NavigationGoalMode, string> = {
  single: "Single Goal",
  continuous: "Continuous Movement",
};

export const NAV_PROFILE_SPECS: Record<NavigationMarkerProfile, NavigationProfileSpec> = {
  manualSingle: {
    usesSurfacePlacement: true,
    previewPhase: true,
    confirmToStart: true,
    dragWhileNavigating: false,
    streamGoals: false,
    respawnOnSuccess: true,
    showMarkerWhileIdle: true,
  },
  manualContinuous: {
    usesSurfacePlacement: true,
    previewPhase: false,
    confirmToStart: false,
    dragWhileNavigating: true,
    streamGoals: true,
    respawnOnSuccess: true,
    showMarkerWhileIdle: true,
  },
  agentSingle: {
    usesSurfacePlacement: false,
    previewPhase: false,
    confirmToStart: false,
    dragWhileNavigating: false,
    streamGoals: false,
    respawnOnSuccess: false,
    showMarkerWhileIdle: false,
  },
  agentContinuous: {
    usesSurfacePlacement: false,
    previewPhase: false,
    confirmToStart: false,
    dragWhileNavigating: false,
    streamGoals: true,
    respawnOnSuccess: false,
    showMarkerWhileIdle: false,
  },
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

const IDLE_SEEKING_PRESET: NavigationMarkerPreset = {
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

const PREVIEW_SINGLE_PRESET: NavigationMarkerPreset = {
  ...IDLE_SEEKING_PRESET,
  confirmVisible: true,
  confirmVfx: "confirm",
  resetCircleBeforeShow: false,
};

const NAVIGATING_SINGLE_PRESET: NavigationMarkerPreset = {
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

// portalCircleVisible stays true: drag Interactable is on the portal circle mesh.
const NAVIGATING_CONTINUOUS_PRESET: NavigationMarkerPreset = {
  circleExecuting: true,
  portalCircleVisible: true,
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

const OUTCOME_RESET_PRESET: NavigationMarkerPreset = {
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

const PROFILE_PHASE_PRESETS: Record<
  NavigationMarkerProfile,
  Partial<Record<NavigationMarkerPhase, NavigationMarkerPreset>>
> = {
  manualSingle: {
    hidden: HIDDEN_PRESET,
    idle: IDLE_SEEKING_PRESET,
    preview: PREVIEW_SINGLE_PRESET,
    navigating: NAVIGATING_SINGLE_PRESET,
    outcomeReset: OUTCOME_RESET_PRESET,
  },
  manualContinuous: {
    hidden: HIDDEN_PRESET,
    idle: IDLE_SEEKING_PRESET,
    preview: IDLE_SEEKING_PRESET,
    navigating: NAVIGATING_CONTINUOUS_PRESET,
    outcomeReset: OUTCOME_RESET_PRESET,
  },
  // TODO(agent): wire idle/preview/navigating presets when agent placement ships.
  agentSingle: {
    hidden: HIDDEN_PRESET,
    outcomeReset: HIDDEN_PRESET,
  },
  agentContinuous: {
    hidden: HIDDEN_PRESET,
    outcomeReset: HIDDEN_PRESET,
  },
};

export function nextNavigationGoalMode(mode: NavigationGoalMode): NavigationGoalMode {
  return mode === "single" ? "continuous" : "single";
}

export function deriveNavigationProfile(
  operatingMode: OperatingMode,
  goalMode: NavigationGoalMode,
): NavigationMarkerProfile {
  if (operatingMode === "manual") {
    return goalMode === "continuous" ? "manualContinuous" : "manualSingle";
  }
  if (operatingMode === "agent") {
    // Agent submenu not wired yet — continuous profile unreachable for now.
    return "agentSingle";
  }
  return "manualSingle";
}

export function navigationProfileSpec(profile: NavigationMarkerProfile): NavigationProfileSpec {
  return NAV_PROFILE_SPECS[profile];
}

export function navigationMarkerTransition(
  profile: NavigationMarkerProfile,
  phase: NavigationMarkerPhase,
  event: NavigationSessionEvent,
): NavigationMarkerPhase | null {
  const spec = NAV_PROFILE_SPECS[profile];

  if (event.kind === "profileChanged") {
    if (phase === "hidden" || phase === "outcomeReset") {
      return phase;
    }
    if (phase === "navigating") {
      return "navigating";
    }
    return phase === "preview" && !spec.previewPhase ? "idle" : phase;
  }

  if (event.kind === "navDisabled") {
    return phase === "hidden" ? null : "hidden";
  }

  if (event.kind === "navEnabled") {
    if (phase !== "hidden") {
      return null;
    }
    if (!spec.showMarkerWhileIdle && !spec.usesSurfacePlacement) {
      return "hidden";
    }
    return "idle";
  }

  if (event.kind === "outcomeResetComplete") {
    return phase === "outcomeReset" ? "idle" : null;
  }

  if (profile === "agentSingle" || profile === "agentContinuous") {
    return navigationAgentTransition(phase, event);
  }

  if (event.kind === "dragThresholdCrossed") {
    if (phase === "idle") {
      return spec.previewPhase ? "preview" : "navigating";
    }
    if (phase === "preview" || phase === "navigating") {
      return null;
    }
    return null;
  }

  if (event.kind === "confirmPressed") {
    if (phase === "preview" && spec.confirmToStart) {
      return "navigating";
    }
    return null;
  }

  if (event.kind === "cancelPressed") {
    if (phase === "navigating" || phase === "preview") {
      return "outcomeReset";
    }
    return null;
  }

  if (event.kind === "goalDispatched") {
    if (phase === "preview" || phase === "idle") {
      return "navigating";
    }
    if (phase === "navigating") {
      return null;
    }
    return null;
  }

  if (event.kind === "goalReached") {
    if (phase !== "navigating") {
      return null;
    }
    if (spec.respawnOnSuccess) {
      return "idle";
    }
    return "navigating";
  }

  if (event.kind === "goalFailed") {
    if (phase === "navigating" || phase === "preview") {
      return "outcomeReset";
    }
    return null;
  }

  return null;
}

function navigationAgentTransition(
  phase: NavigationMarkerPhase,
  event: NavigationSessionEvent,
): NavigationMarkerPhase | null {
  if (event.kind === "agentGoalSubmitted") {
    return "hidden";
  }
  if (event.kind === "goalReached" || event.kind === "goalFailed") {
    return "hidden";
  }
  if (event.kind === "cancelPressed") {
    return "hidden";
  }
  return null;
}

export function navigationGoalPolicy(
  profile: NavigationMarkerProfile,
  phase: NavigationMarkerPhase,
): NavigationGoalPolicy {
  const spec = NAV_PROFILE_SPECS[profile];

  if (profile === "agentSingle" || profile === "agentContinuous") {
    return phase === "hidden" ? "none" : "none";
  }

  if (phase === "preview" && spec.previewPhase) {
    return "preview";
  }

  if (phase === "navigating" && spec.confirmToStart && !spec.streamGoals) {
    return "commit";
  }

  if (phase === "navigating" && spec.streamGoals) {
    return "redispatch";
  }

  if (phase === "preview" && !spec.previewPhase) {
    return "none";
  }

  return "none";
}

export function goalCommitAllowed(
  profile: NavigationMarkerProfile,
  phase: NavigationMarkerPhase,
  via: GoalCommitVia,
): boolean {
  if (via === "agent") {
    return profile === "agentSingle" || profile === "agentContinuous";
  }
  const policy = navigationGoalPolicy(profile, phase);
  if (via === "confirm") {
    return policy === "commit";
  }
  return policy === "redispatch";
}

export function shouldSendGoalOnDragThreshold(
  profile: NavigationMarkerProfile,
  phase: NavigationMarkerPhase,
): boolean {
  const spec = NAV_PROFILE_SPECS[profile];
  return spec.streamGoals && !spec.confirmToStart && phase === "navigating";
}

export function resolveMarkerPreset(
  profile: NavigationMarkerProfile,
  phase: NavigationMarkerPhase,
): NavigationMarkerPreset {
  const profilePresets = PROFILE_PHASE_PRESETS[profile];
  const preset = profilePresets[phase];
  if (preset) {
    return preset;
  }
  return HIDDEN_PRESET;
}

export function isFollowingProfile(profile: NavigationMarkerProfile): boolean {
  return profile === "manualContinuous" || profile === "agentContinuous";
}
