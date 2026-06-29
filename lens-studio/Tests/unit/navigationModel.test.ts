import { describe, expect, it } from "vitest";
import {
  applyNavigationEvent,
  buildNavViewContext,
  checkNavLifecycleStaleness,
  createInitialNavEngineState,
  deriveAppNavigationState,
  deriveMarkerPresentation,
  deriveNavDisplayPhase,
  derivePathPresentation,
  goalCommitAllowed,
  manualNavGoalConfig,
  navBehavior,
  navigationGoalPolicy,
  nextNavigationGoalMode,
  shouldRenderNavigationPath,
  shouldRequestPreviewOnTargetChange,
} from "../../Assets/Scripts/ARBridge/Navigation/NavigationModel";

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
    expect(result.state.goal).toEqual({ since: 0, navigating: false });
    expect(result.effects.some((effect) => effect.kind === "sendNavGoal")).toBe(true);
    expect(result.effects.some((effect) => effect.kind === "clearPath")).toBe(false);
  });

  it("clears goal on disconnect", () => {
    let state = createInitialNavEngineState();
    state = {
      ...state,
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "disconnect" });
    expect(result.state.activeConfig).toBeNull();
    expect(result.state.goal).toBeNull();
    expect(result.effects.some((effect) => effect.kind === "destroyMarker")).toBe(true);
  });

  it("detects stale nav lifecycle", () => {
    const state = {
      ...createInitialNavEngineState(0),
      goal: { since: 0, navigating: true },
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
        goal: { since: 1, navigating: true },
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
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    expect(result.effects.some((effect) => effect.kind === "destroyMarker")).toBe(true);
    expect(result.state.activeConfig).toBeNull();
  });

  it("respawns marker instantly on manual continuous goal reached", () => {
    const config = manualNavGoalConfig("continuous");
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: config,
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalReached" });
    const respawn = result.effects.find((effect) => effect.kind === "respawnMarkerAtRobot");
    expect(respawn).toEqual({ kind: "respawnMarkerAtRobot", immediate: true });
  });

  it("recovers without Failed animation", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusRecovering" });
    expect(result.state.goal).toBeNull();
    expect(result.effects.some((effect) => effect.kind === "beginOutcomeAnimation")).toBe(
      false,
    );
    expect(result.effects.some((effect) => effect.kind === "respawnMarkerAtRobot")).toBe(
      true,
    );
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
    const respawn = result.effects.find((effect) => effect.kind === "respawnMarkerAtRobot");
    expect(respawn).toEqual({ kind: "respawnMarkerAtRobot", immediate: true });
  });

  it("marks failure with Failed animation", () => {
    const state = {
      ...createInitialNavEngineState(),
      activeConfig: manualNavGoalConfig("single"),
      goal: { since: 1, navigating: true },
    };
    const result = applyNavigationEvent(state, { kind: "navStatusGoalFailed" });
    expect(
      result.effects.some(
        (effect) => effect.kind === "beginOutcomeAnimation" && effect.label === "Failed",
      ),
    ).toBe(true);
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
    expect(deriveNavDisplayPhase(ctx)).toBe("preview");
    expect(deriveAppNavigationState(ctx, true)).toBe("placingGoal");
  });

  it("shows navigating when single goal is active", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, navigating: false },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(deriveMarkerPresentation(ctx).kind).toBe("navigating");
    expect(deriveNavDisplayPhase(ctx)).toBe("navigating");
    expect(deriveAppNavigationState(ctx, true)).toBe("navigating");
    expect(derivePathPresentation(ctx).style).toBe("navigating");
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
    expect(deriveNavDisplayPhase(ctx)).toBe("idle");
  });

  it("keeps continuous goal in preview until bridge navigating", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 0, navigating: false },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    const { kind, preset } = deriveMarkerPresentation(ctx);
    expect(kind).toBe("preview");
    expect(preset.confirmVisible).toBe(true);
    expect(preset.useNavigatingButtonPresentation).toBe(true);
    expect(preset.confirmVfx).toBe("cancel");
    expect(deriveNavDisplayPhase(ctx)).toBe("preview");
    expect(deriveAppNavigationState(ctx, true)).toBe("armed");
    expect(derivePathPresentation(ctx).style).toBe("preview");
  });

  it("shows confirm only for single preview and cancel for continuous preview", () => {
    const singleCtx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("single"),
        goal: null,
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    const singlePreset = deriveMarkerPresentation(singleCtx).preset;
    expect(singlePreset.confirmVisible).toBe(true);
    expect(singlePreset.useNavigatingButtonPresentation).toBe(false);

    const continuousCtx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: null,
      },
      { placementActive: true, markerExists: true, outcomeAnimating: false },
    )!;
    const continuousPreset = deriveMarkerPresentation(continuousCtx).preset;
    expect(continuousPreset.confirmVisible).toBe(true);
    expect(continuousPreset.useNavigatingButtonPresentation).toBe(true);
    expect(continuousPreset.confirmVfx).toBe("cancel");
  });

  it("uses continuous navigating preset after bridge ack", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: manualNavGoalConfig("continuous"),
        goal: { since: 0, navigating: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    const { preset } = deriveMarkerPresentation(ctx);
    expect(preset.portalCircleVisible).toBe(true);
    expect(preset.circleNavigating).toBe(true);
    expect(deriveAppNavigationState(ctx, true)).toBe("navigating");
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

  it("returns false while navigating a goal", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, navigating: true },
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
        goal: { since: 1, navigating: true },
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

  it("returns true while navigating", () => {
    const ctx = buildNavViewContext(
      {
        ...createInitialNavEngineState(),
        activeConfig: singleDrag,
        goal: { since: 1, navigating: true },
      },
      { placementActive: false, markerExists: true, outcomeAnimating: false },
    )!;
    expect(shouldRenderNavigationPath(ctx)).toBe(true);
  });

  it("returns false for display-only agent without navigating goal", () => {
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
