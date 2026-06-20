import { describe, expect, it } from "vitest";
import {
  applyNavigationEvent,
  buildNavViewContext,
  checkNavLifecycleStaleness,
  createInitialNavEngineState,
  deriveAppNavigationState,
  deriveMarkerPresentation,
  goalCommitAllowed,
  manualNavGoalConfig,
  navBehavior,
  navigationGoalPolicy,
  nextNavigationGoalMode,
  shouldRenderNavigationPath,
  shouldRequestPreviewOnTargetChange,
} from "../../Assets/Scripts/Navigation/NavigationModel";

describe("NavEngineState", () => {
  it("starts with no session", () => {
    const state = createInitialNavEngineState();
    expect(state.activeConfig).toBeNull();
    expect(state.goal).toBeNull();
  });

  it("arms into draggable session", () => {
    const config = manualNavGoalConfig("single");
    const result = applyNavigationEvent(createInitialNavEngineState(), {
      kind: "arm",
      config,
    });
    expect(result.state.activeConfig).toEqual(config);
    expect(result.effects.some((effect) => effect.kind === "clearPath")).toBe(true);
  });

  it("commits goal into pending track", () => {
    const config = { mode: "single" as const, allowDrag: false };
    const armed = applyNavigationEvent(createInitialNavEngineState(), {
      kind: "arm",
      config: manualNavGoalConfig("single"),
    }).state;
    const result = applyNavigationEvent(armed, {
      kind: "goalCommitRequested",
      config,
      commitKind: "direct",
      sendToBridge: true,
    });
    expect(result.state.goal).toEqual({ since: 0, following: false });
    expect(result.effects.some((effect) => effect.kind === "sendNavGoal")).toBe(true);
  });

  it("clears goal on disconnect", () => {
    let state = createInitialNavEngineState();
    state = {
      ...state,
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, following: true },
    };
    const result = applyNavigationEvent(state, { kind: "disconnect" });
    expect(result.state.activeConfig).toBeNull();
    expect(result.state.goal).toBeNull();
    expect(result.effects.some((effect) => effect.kind === "destroyMarker")).toBe(true);
  });

  it("detects stale nav lifecycle", () => {
    const state = {
      ...createInitialNavEngineState(0),
      goal: { since: 0, following: true },
      lastNavStatusTime: 0,
      lastNavStatusResyncTime: 19,
      navStatusResyncCooldownS: 2,
    };
    expect(checkNavLifecycleStaleness(state, 20)).toBe("recover_local");
  });
});

describe("navBehavior", () => {
  it("maps manual single and continuous configs", () => {
    expect(navBehavior(manualNavGoalConfig("single")).previewPhase).toBe(true);
    expect(navBehavior(manualNavGoalConfig("continuous")).streamGoals).toBe(true);
  });

  it("maps agent display-only config", () => {
    const agent = { mode: "single" as const, allowDrag: false };
    expect(navBehavior(agent).deleteMarkerOnSuccess).toBe(true);
    expect(navBehavior(agent).usesPlacement).toBe(false);
  });
});

describe("nextNavigationGoalMode", () => {
  it("cycles single and continuous", () => {
    expect(nextNavigationGoalMode("single")).toBe("continuous");
    expect(nextNavigationGoalMode("continuous")).toBe("single");
  });
});

describe("navigationGoalPolicy", () => {
  it("requests preview in single drag-before-commit", () => {
    const config = manualNavGoalConfig("single");
    const ctx = buildNavViewContext(
      { ...createInitialNavEngineState(), activeConfig: config, goal: null },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    expect(navigationGoalPolicy(ctx)).toBe("preview");
    expect(goalCommitAllowed(ctx, "confirm")).toBe(true);
  });

  it("streams in continuous while following", () => {
    const config = manualNavGoalConfig("continuous");
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: config,
        goal: { since: 1, following: true },
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    expect(navigationGoalPolicy(ctx)).toBe("stream");
    expect(goalCommitAllowed(ctx, "stream")).toBe(true);
  });
});

describe("applyNavigationEvent goal lifecycle", () => {
  it("deletes marker on agent goal reached", () => {
    const config = { mode: "single" as const, allowDrag: false };
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: config,
      goal: { since: 1, following: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.effects.some((effect) => effect.kind === "destroyMarker")).toBe(true);
    expect(result.state.activeConfig).toBeNull();
  });

  it("respawns marker on manual continuous goal reached", () => {
    const config = manualNavGoalConfig("continuous");
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: config,
      goal: { since: 1, following: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.effects.some((effect) => effect.kind === "respawnMarkerAtRobot")).toBe(
      true,
    );
  });
});

describe("derived presentation", () => {
  const singleDrag = manualNavGoalConfig("single");

  it("shows preview while dragging before commit", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: null,
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    expect(deriveMarkerPresentation(ctx).kind).toBe("preview");
    expect(deriveAppNavigationState(ctx, true)).toBe("placingGoal");
  });

  it("shows executing when goal is active", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, following: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(deriveMarkerPresentation(ctx).kind).toBe("executing");
    expect(deriveAppNavigationState(ctx, true)).toBe("executingGoal");
  });

  it("maps armed manual session to AppState armed", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: null,
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(deriveAppNavigationState(ctx, true)).toBe("armed");
  });

  it("uses continuous executing preset", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 0, following: false },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    const { preset } = deriveMarkerPresentation(ctx);
    expect(preset.portalCircleVisible).toBe(true);
    expect(preset.circleExecuting).toBe(true);
  });
});

describe("shouldRequestPreviewOnTargetChange", () => {
  const singleDrag = manualNavGoalConfig("single");

  it("returns true during single preview-before-commit", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: null,
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRequestPreviewOnTargetChange(ctx)).toBe(true);
  });

  it("returns false while executing a goal", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, following: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRequestPreviewOnTargetChange(ctx)).toBe(false);
  });

  it("returns false when armed idle seeking", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: null,
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRequestPreviewOnTargetChange(ctx)).toBe(false);
  });

  it("returns false during continuous streaming", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 1, following: true },
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRequestPreviewOnTargetChange(ctx)).toBe(false);
  });

  it("returns false when context is null", () => {
    expect(shouldRequestPreviewOnTargetChange(null)).toBe(false);
  });
});

describe("shouldRenderNavigationPath", () => {
  const singleDrag = manualNavGoalConfig("single");

  it("returns true while placing preview", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: null,
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRenderNavigationPath(ctx)).toBe(true);
  });

  it("returns false when armed idle seeking", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: null,
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRenderNavigationPath(ctx)).toBe(false);
  });

  it("returns true while executing", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, following: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRenderNavigationPath(ctx)).toBe(true);
  });

  it("returns false for display-only agent without executing goal", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: { mode: "single", allowDrag: false },
        goal: null,
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRenderNavigationPath(ctx)).toBe(false);
  });

  it("returns false when context is null", () => {
    expect(shouldRenderNavigationPath(null)).toBe(false);
  });
});
