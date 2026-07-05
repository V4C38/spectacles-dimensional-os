import { describe, expect, it } from "vitest";
import {
  applyNavigationEvent,
  createInitialNavEngineState,
  checkNavLifecycleStaleness,
  deriveAppNavigationState,
  deriveNavPhase,
  deriveViewState,
  directNavGoalConfig,
  goalCommitAllowed,
  manualNavGoalConfig,
  nextNavigationGoalMode,
  remoteNavGoalConfig,
  shouldIgnoreNavGoalUpdate,
  shouldSendStreamGoal,
  GOAL_FORCE_NOOP_DISTANCE_CM,
  GOAL_SEND_INTERVAL_S,
  GOAL_SEND_MIN_DISTANCE_CM,
  shouldRenderNavigationPath,
  shouldRequestPreviewOnTargetChange,
  type NavigationEffect,
  type NavEngineState,
  type NavLiveContext,
  type NavMarkerViewState,
} from "../../Assets/Scripts/ARBridge/Navigation/NavigationModel";

type LiveFlags = {
  placementActive: boolean;
  activelyDragging?: boolean;
  markerExists: boolean;
  outcomeAnimating: boolean;
};

const DEFAULT_CAPS = {
  cancelAvailable: true,
  confirmAvailable: true,
  sessionActive: true,
};

function liveFrom(flags: LiveFlags): NavLiveContext {
  return {
    placementActive: flags.placementActive,
    activelyDragging: flags.activelyDragging ?? false,
    markerExists: flags.markerExists,
    outcomeAnimating: flags.outcomeAnimating,
    markerPose: flags.markerExists
      ? { position: new vec3(0, 0, 0), rotation: quat.quatIdentity() }
      : null,
  };
}

function viewFrom(state: NavEngineState, live: LiveFlags) {
  return deriveViewState(state, liveFrom(live), DEFAULT_CAPS)!;
}

function mockPose() {
  return {
    position: new vec3(1, 0, 2),
    rotation: quat.quatIdentity(),
  };
}

function effectKinds(effects: NavigationEffect[]): string[] {
  return effects.map((effect) => effect.kind);
}

/** Equivalence oracle: five visible marker styles across canonical contexts. */
const STYLE_ORACLE: Array<{
  label: string;
  state: NavEngineState;
  live: LiveFlags;
  style: NavMarkerViewState["style"];
  markerKeys: Partial<NavMarkerViewState>;
}> = [
  {
    label: "seeking (armed idle)",
    state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
    live: { placementActive: false, activelyDragging: false, markerExists: true, outcomeAnimating: false },
    style: "seeking",
    markerKeys: { button: null, portalCircleVisible: true, navigatingCircleVisible: false, scanAnimation: false },
  },
  {
    label: "preview (single drag-before-commit)",
    state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
    live: { placementActive: true, activelyDragging: false, markerExists: true, outcomeAnimating: false },
    style: "preview",
    markerKeys: { button: { role: "confirm", enabled: true, label: "Confirm" }, scanAnimation: false },
  },
  {
    label: "preview (continuous drag)",
    state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("continuous"), goal: null },
    live: { placementActive: true, activelyDragging: false, markerExists: true, outcomeAnimating: false },
    style: "preview",
    markerKeys: { button: { role: "cancel", enabled: true, label: "Cancel" }, portalCircleVisible: true, navigatingCircleVisible: true },
  },
  {
    label: "navigating (single)",
    state: {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    },
    live: { placementActive: false, activelyDragging: false, markerExists: true, outcomeAnimating: false },
    style: "navigating",
    markerKeys: { scanAnimation: true, portalCircleVisible: false, navigatingCircleVisible: true, button: { role: "cancel", enabled: true, label: "Cancel" } },
  },
  {
    label: "navigating (continuous)",
    state: {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("continuous"),
      goal: { since: 1, navigating: true },
    },
    live: { placementActive: false, activelyDragging: false, markerExists: true, outcomeAnimating: false },
    style: "navigating",
    markerKeys: { portalCircleVisible: true, navigatingCircleVisible: true, scanAnimation: true, button: { role: "cancel", enabled: true, label: "Cancel" } },
  },
];

describe("NavEngineState", () => {
  it("starts with no session", () => {
    const state = createInitialNavEngineState();
    expect(state.activeConfig).toBeNull();
    expect(state.goal).toBeNull();
  });

  it("arms with config", () => {
    const config = manualNavGoalConfig("single");
    const result = applyNavigationEvent(createInitialNavEngineState(), { kind: "arm", config });
    expect(result.state.activeConfig).toEqual(config);
    expect(result.effects.some((effect) => effect.kind === "clearPath")).toBe(true);
  });

  it("disarms and clears config", () => {
    const config = directNavGoalConfig("single");
    let state = applyNavigationEvent(createInitialNavEngineState(), { kind: "arm", config }).state;
    state = applyNavigationEvent(state, {
      kind: "goalCommitRequested",
      config,
      commitKind: "direct",
      sendToBridge: true,
      pose: mockPose(),
    }).state;
    const result = applyNavigationEvent(state, { kind: "disarm" });
    expect(result.state.activeConfig).toBeNull();
    expect(result.effects.some((effect) => effect.kind === "destroyMarker")).toBe(true);
  });

  it("config change cancels active goal", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, {
      kind: "configChanged",
      config: manualNavGoalConfig("continuous"),
    });
    expect(result.state.goal).toBeNull();
    expect(result.effects.some((effect) => effect.kind === "sendCancelGoal")).toBe(true);
  });
});

describe("deriveNavPhase", () => {
  it("maps armed idle to placing", () => {
    const phase = deriveNavPhase(
      { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
      liveFrom({ placementActive: false, markerExists: true, outcomeAnimating: false }),
    );
    expect(phase.kind).toBe("placing");
  });

  it("maps committed goal to committed phase", () => {
    const phase = deriveNavPhase(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("single"),
        goal: { since: 1, navigating: true },
      },
      liveFrom({ placementActive: false, markerExists: true, outcomeAnimating: false }),
    );
    expect(phase.kind).toBe("committed");
    if (phase.kind === "committed") {
      expect(phase.navigating).toBe(true);
    }
  });
});

describe("goal policy via deriveViewState", () => {
  it("allows confirm during single preview", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(view.goalCommitVia).toBe("confirm");
    expect(goalCommitAllowed(view, "confirm")).toBe(true);
  });

  it("streams during continuous drag", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 1, navigating: true },
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(view.shouldStreamGoal).toBe(true);
    expect(goalCommitAllowed(view, "stream")).toBe(true);
  });
});

describe("applyNavigationEvent goal lifecycle", () => {
  it("deletes marker on agent goal reached", () => {
    const config = directNavGoalConfig("single");
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: config,
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.effects.some((effect) => effect.kind === "destroyMarker")).toBe(true);
    expect(result.state.activeConfig).toBeNull();
  });

  it("respawns marker instantly on manual single goal reached", () => {
    const config = manualNavGoalConfig("single");
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: config,
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    const respawn = result.effects.find((effect) => effect.kind === "respawnMarkerAt");
    expect(respawn).toEqual({ kind: "respawnMarkerAt", animated: false });
  });

  it("clears goal and respawns marker on continuous goal reached", () => {
    const config = manualNavGoalConfig("continuous");
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: config,
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.effects.some((effect) => effect.kind === "respawnMarkerAt")).toBe(true);
    expect(result.state.goal).toBeNull();
    expect(result.state.activeConfig).toEqual(config);
  });

  it("recovers without Failed animation", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusRecovering" });
    expect(result.state.goal).toBeNull();
    expect(result.effects.some((effect) => effect.kind === "beginOutcomeAnimation")).toBe(false);
    expect(result.effects.some((effect) => effect.kind === "respawnMarkerAt")).toBe(true);
  });

  it("respawns marker when switching single and continuous", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, {
      kind: "configChanged",
      config: manualNavGoalConfig("continuous"),
    });
    expect(result.state.goal).toBeNull();
    expect(result.state.activeConfig?.mode).toBe("continuous");
    expect(result.effects.some((effect) => effect.kind === "sendCancelGoal")).toBe(true);
    expect(result.effects.some((effect) => effect.kind === "clearPath")).toBe(true);
    const respawn = result.effects.find((effect) => effect.kind === "respawnMarkerAt");
    expect(respawn).toEqual({ kind: "respawnMarkerAt", animated: false });
  });

  it("marks failure with Failed animation", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalFailed" });
    expect(result.effects.some((effect) => effect.kind === "sendCancelGoal")).toBe(true);
    expect(
      result.effects.some(
        (effect) => effect.kind === "beginOutcomeAnimation" && effect.label === "Failed",
      ),
    ).toBe(true);
  });
});

describe("derived view state", () => {
  const singleDrag = manualNavGoalConfig("single");

  it("shows preview while dragging before commit", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: singleDrag, goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(view.marker.style).toBe("preview");
    expect(deriveAppNavigationState(view)).toBe("placingGoal");
  });

  it("shows navigating when single goal is active", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, navigating: false },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(view.marker.style).toBe("navigating");
    expect(deriveAppNavigationState(view)).toBe("navigating");
    expect(view.path?.style).toBe("navigating");
  });

  it("maps armed manual session to AppState armed", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: singleDrag, goal: null },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(deriveAppNavigationState(view)).toBe("armed");
    expect(view.marker.style).toBe("seeking");
  });

  it("keeps continuous goal in preview until bridge navigating", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 0, navigating: false },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(view.marker.style).toBe("preview");
    expect(view.marker.button?.role).toBe("cancel");
    expect(deriveAppNavigationState(view)).toBe("armed");
    expect(view.path?.style).toBe("preview");
  });

  it("shows confirm only for single preview and cancel for continuous preview", () => {
    const singleView = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(singleView.marker.button?.role).toBe("confirm");

    const continuousView = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("continuous"), goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(continuousView.marker.button?.role).toBe("cancel");
  });

  it("hides button while actively dragging", () => {
    const singleView = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
      { placementActive: true, activelyDragging: true, markerExists: true, outcomeAnimating: false },
    );
    expect(singleView.marker.button).toBeNull();

    const continuousView = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("continuous"), goal: null },
      { placementActive: true, activelyDragging: true, markerExists: true, outcomeAnimating: false },
    );
    expect(continuousView.marker.button).toBeNull();
  });

  it("enables confirm after drag release while placement stays active", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
      { placementActive: true, activelyDragging: false, markerExists: true, outcomeAnimating: false },
    );
    expect(view.marker.button?.enabled).toBe(true);
  });

  it("uses continuous navigating style after bridge ack", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 0, navigating: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(view.marker.navigatingCircleVisible).toBe(true);
    expect(view.marker.portalCircleVisible).toBe(true);
    expect(view.marker.scanAnimation).toBe(true);
    expect(deriveAppNavigationState(view)).toBe("navigating");
  });

  it("derives portalCircleVisible for drag collider availability (F1 regression)", () => {
    const cases: Array<{
      label: string;
      state: NavEngineState;
      live: LiveFlags & { outcomeLabel?: "Cancelled" | "Failed" | null };
      expected: boolean;
    }> = [
      {
        label: "single seeking",
        state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
        live: { placementActive: false, markerExists: true, outcomeAnimating: false },
        expected: true,
      },
      {
        label: "single preview (11cm drag regression)",
        state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
        live: { placementActive: true, markerExists: true, outcomeAnimating: false },
        expected: true,
      },
      {
        label: "single navigating",
        state: {
          ...createInitialNavEngineState(),
          activeConfig: manualNavGoalConfig("single"),
          goal: { since: 1, navigating: true },
        },
        live: { placementActive: false, markerExists: true, outcomeAnimating: false },
        expected: false,
      },
      {
        label: "continuous seeking",
        state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("continuous"), goal: null },
        live: { placementActive: false, markerExists: true, outcomeAnimating: false },
        expected: true,
      },
      {
        label: "continuous preview",
        state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("continuous"), goal: null },
        live: { placementActive: true, markerExists: true, outcomeAnimating: false },
        expected: true,
      },
      {
        label: "continuous navigating",
        state: {
          ...createInitialNavEngineState(),
          activeConfig: manualNavGoalConfig("continuous"),
          goal: { since: 1, navigating: true },
        },
        live: { placementActive: false, markerExists: true, outcomeAnimating: false },
        expected: true,
      },
      {
        label: "outcome",
        state: { ...createInitialNavEngineState(), activeConfig: manualNavGoalConfig("single"), goal: null },
        live: {
          placementActive: false,
          markerExists: true,
          outcomeAnimating: true,
          outcomeLabel: "Cancelled",
        },
        expected: true,
      },
    ];

    for (const { label, state, live, expected } of cases) {
      const view = deriveViewState(state, { ...liveFrom(live), outcomeLabel: live.outcomeLabel ?? null }, DEFAULT_CAPS)!;
      expect(view.marker.portalCircleVisible, label).toBe(expected);
    }
  });
});

describe("shouldRequestPreviewOnTargetChange", () => {
  const singleDrag = manualNavGoalConfig("single");

  it("returns true during single preview-before-commit", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: singleDrag, goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRequestPreviewOnTargetChange(view)).toBe(true);
  });

  it("returns false while navigating a goal", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, navigating: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRequestPreviewOnTargetChange(view)).toBe(false);
  });

  it("returns false when armed idle seeking", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: singleDrag, goal: null },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRequestPreviewOnTargetChange(view)).toBe(false);
  });

  it("returns false during continuous streaming", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 1, navigating: true },
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRequestPreviewOnTargetChange(view)).toBe(false);
  });

  it("returns false when view is null", () => {
    expect(shouldRequestPreviewOnTargetChange(null)).toBe(false);
  });
});

describe("shouldRenderNavigationPath", () => {
  const singleDrag = manualNavGoalConfig("single");

  it("returns true while placing preview", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: singleDrag, goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRenderNavigationPath(view)).toBe(true);
  });

  it("returns false when armed idle seeking", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: singleDrag, goal: null },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRenderNavigationPath(view)).toBe(false);
  });

  it("returns true while navigating", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, navigating: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRenderNavigationPath(view)).toBe(true);
  });

  it("returns false for display-only agent without navigating goal", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: directNavGoalConfig("single"),
        goal: null,
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(shouldRenderNavigationPath(view)).toBe(false);
  });

  it("returns false when view is null", () => {
    expect(shouldRenderNavigationPath(null)).toBe(false);
  });
});

describe("marker style oracle (Phase 0 equivalence)", () => {
  it.each(STYLE_ORACLE)("$label → $style", ({ state, live, style, markerKeys }) => {
    const view = viewFrom(state, live);
    expect(view.marker.style).toBe(style);
    for (const [key, value] of Object.entries(markerKeys)) {
      expect(view.marker[key as keyof NavMarkerViewState]).toEqual(value);
    }
  });
});

describe("single-mode effect sequences (Phase 0 oracle)", () => {
  const single = manualNavGoalConfig("single");

  function runSequence(events: Parameters<typeof applyNavigationEvent>[1][]) {
    let state = createInitialNavEngineState();
    const allEffects: string[][] = [];
    for (const event of events) {
      const result = applyNavigationEvent(state, event);
      state = result.state;
      allEffects.push(effectKinds(result.effects));
    }
    return { state, allEffects };
  }

  it("arm → confirm → navigating → reached", () => {
    const { state, allEffects } = runSequence([
      { kind: "arm", config: single },
      { kind: "goalCommitRequested", config: single, commitKind: "confirm", sendToBridge: true, pose: mockPose() },
      { kind: "navigating" },
      { kind: "navStatusGoalReached" },
    ]);
    expect(allEffects[0]).toContain("clearPath");
    expect(allEffects[1]).toContain("sendNavGoal");
    expect(allEffects[3]).toContain("respawnMarkerAt");
    expect(state.goal).toBeNull();
    expect(state.activeConfig).toEqual(single);
  });

  it("arm → confirm → navigating → failed", () => {
    const { allEffects } = runSequence([
      { kind: "arm", config: single },
      { kind: "goalCommitRequested", config: single, commitKind: "confirm", sendToBridge: true, pose: mockPose() },
      { kind: "navigating" },
      { kind: "navStatusGoalFailed" },
    ]);
    expect(allEffects[3]).toContain("sendCancelGoal");
    expect(allEffects[3]).toContain("beginOutcomeAnimation");
    expect(allEffects[3]).not.toContain("respawnMarkerAt");
  });

  it("arm → confirm → navigating → cancel", () => {
    const { allEffects, state } = runSequence([
      { kind: "arm", config: single },
      { kind: "goalCommitRequested", config: single, commitKind: "confirm", sendToBridge: true, pose: mockPose() },
      { kind: "navigating" },
      { kind: "cancelRequested" },
    ]);
    expect(allEffects[3]).toContain("beginOutcomeAnimation");
    expect(state.goal).toBeNull();
  });

  it("preview phase: arm with placement active shows preview style", () => {
    const armed = applyNavigationEvent(createInitialNavEngineState(), { kind: "arm", config: single });
    const view = viewFrom(armed.state, {
      placementActive: true,
      markerExists: true,
      outcomeAnimating: false,
    });
    expect(view.marker.style).toBe("preview");
    expect(deriveAppNavigationState(view)).toBe("placingGoal");
  });
});

describe("continuous mode semantics (Phase 1L targets)", () => {
  const continuous = manualNavGoalConfig("continuous");

  it("streams when goal is null during continuous drag", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: continuous, goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(view.shouldStreamGoal).toBe(true);
    expect(goalCommitAllowed(view, "stream")).toBe(true);
  });

  it("respawns at robot on continuous goal reached", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: continuous,
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.effects.some((e) => e.kind === "respawnMarkerAt")).toBe(true);
    expect(result.state.goal).toBeNull();
    expect(result.state.activeConfig).toEqual(continuous);
  });

  it("single interactive sessions respawn at robot on success", () => {
    const config = manualNavGoalConfig("single");
    const result = applyNavigationEvent(
      {
        ...createInitialNavEngineState(),
        activeConfig: config,
        goal: { since: 1, navigating: true },
      },
      { kind: "navStatusGoalReached" },
    );
    expect(result.effects.some((e) => e.kind === "respawnMarkerAt")).toBe(true);
  });

  it("dragEnabled true when goal null and interactive", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: continuous, goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(view.placement.dragEnabled).toBe(true);
  });

  it("followRobot false mid-drag (placementActive)", () => {
    const view = viewFrom(
      { ...createInitialNavEngineState(), activeConfig: continuous, goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    );
    expect(view.placement.followRobot).toBe(false);
  });
});

describe("navigation utilities", () => {
  it("cycles navigation goal mode", () => {
    expect(nextNavigationGoalMode("single")).toBe("continuous");
    expect(nextNavigationGoalMode("continuous")).toBe("single");
  });

  it("detects staleness for active goals", () => {
    const state = {
      ...createInitialNavEngineState(100),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 0, navigating: true },
      lastNavStatusTime: 0,
    };
    expect(checkNavLifecycleStaleness(state, 100)).toBe("request_resync");
  });
});

describe("remote nav goal updates (Phase 6)", () => {
  const agentPose = () => ({
    position: new vec3(500, 0, 500),
    rotation: quat.quatIdentity(),
  });

  it("arms remote session on agent goal update", () => {
    const result = applyNavigationEvent(createInitialNavEngineState(), {
      kind: "navGoalUpdate",
      source: "agent",
      pose: agentPose(),
      active: true,
    });
    expect(result.state.activeConfig).toEqual(remoteNavGoalConfig());
    expect(result.state.goal?.navigating).toBe(true);
    expect(result.effects.some((e) => e.kind === "ensureMarkerAt")).toBe(true);
  });

  it("disarms remote session when active is false", () => {
    const armed = applyNavigationEvent(createInitialNavEngineState(), {
      kind: "navGoalUpdate",
      source: "agent",
      pose: agentPose(),
      active: true,
    }).state;
    const result = applyNavigationEvent(armed, {
      kind: "navGoalUpdate",
      source: "agent",
      pose: agentPose(),
      active: false,
    });
    expect(result.state.activeConfig).toBeNull();
    expect(result.effects.some((e) => e.kind === "destroyMarker")).toBe(true);
  });

  it("suppresses xr echo while local user session is active", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: null,
    };
    expect(shouldIgnoreNavGoalUpdate(state, "xr", agentPose())).toBe(true);
    const result = applyNavigationEvent(state, {
      kind: "navGoalUpdate",
      source: "xr",
      pose: agentPose(),
      active: true,
    });
    expect(result.state.activeConfig?.source).toBe("user");
    expect(result.effects).toHaveLength(0);
  });

  it("suppresses xr echo within 25 cm of last local goal", () => {
    const localPose = { position: new vec3(100, 0, 100), rotation: quat.quatIdentity() };
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: null,
      goal: null,
      lastLocalGoalPose: localPose,
    };
    const nearby = {
      position: new vec3(110, 0, 100),
      rotation: quat.quatIdentity(),
    };
    expect(shouldIgnoreNavGoalUpdate(state, "xr", nearby)).toBe(true);
  });

  it("accepts agent updates regardless of operating mode disarm policy", () => {
    const view = viewFrom(
      {
        ...createInitialNavEngineState(),
        activeConfig: remoteNavGoalConfig(),
        goal: { since: 1, navigating: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    );
    expect(view.marker.style).toBe("navigating");
    expect(view.placement.dragEnabled).toBe(false);
    expect(deriveAppNavigationState(view)).toBe("navigating");
  });
});

describe("shouldSendStreamGoal", () => {
  const lastSent = { position: new vec3(0, 0, 0) };
  const farPose = new vec3(30, 0, 0);
  const nearPose = new vec3(1, 0, 0);

  it("force bypasses interval and distance gates", () => {
    expect(
      shouldSendStreamGoal(1.0, 1.0, farPose, lastSent, true),
    ).toBe(true);
  });

  it("force within 2 cm of last sent goal is a no-op", () => {
    expect(
      shouldSendStreamGoal(1.0, 1.0, nearPose, lastSent, true),
    ).toBe(false);
    expect(GOAL_FORCE_NOOP_DISTANCE_CM).toBe(2.0);
  });

  it("non-forced stream respects interval and distance gates", () => {
    expect(
      shouldSendStreamGoal(1.0, 1.0, farPose, lastSent, false),
    ).toBe(false);
    expect(
      shouldSendStreamGoal(1.0 + GOAL_SEND_INTERVAL_S, 1.0, nearPose, lastSent, false),
    ).toBe(false);
    expect(
      shouldSendStreamGoal(
        1.0 + GOAL_SEND_INTERVAL_S,
        1.0,
        farPose,
        lastSent,
        false,
      ),
    ).toBe(true);
    expect(GOAL_SEND_MIN_DISTANCE_CM).toBe(20.0);
  });
});

describe("navigation settled signal guard", () => {
  it("does not treat terminal status as goal reached without a tracked goal", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: null,
    };
    expect(state.goal).toBeNull();
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.effects).toHaveLength(0);
  });

  it("clears a tracked goal on navStatusGoalReached", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("continuous"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.state.goal).toBeNull();
    expect(result.effects.some((effect) => effect.kind === "clearPath")).toBe(true);
  });
});
