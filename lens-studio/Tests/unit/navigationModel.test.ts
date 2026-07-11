import { describe, expect, it } from "vitest";
import {
  applyNavigationEvent,
  checkNavLifecycleStaleness,
  createInitialNavigationSession,
  deriveMarkerViewState,
  deriveNavigationState,
  dragEnabledForState,
  idleAnchorEnabled,
  markerActive,
  resolveRetryableNavIntent,
  shouldRenderNavigationPath,
  shouldSendStreamGoal,
  shouldSkipStaleLocalRecovery,
  shouldSuppressTerminalNavState,
  GOAL_FORCE_NOOP_DISTANCE_CM,
  GOAL_SEND_INTERVAL_S,
  GOAL_SEND_MIN_DISTANCE_CM,
  type NavigationEffect,
  type NavigationInputs,
  type NavigationSession,
} from "../../Assets/Scripts/ARBridge/Navigation/NavigationModel";

type InputFlags = {
  placementActive: boolean;
  activelyDragging?: boolean;
  markerExists: boolean;
};

function activeSession(goal: NavigationSession["goal"] = null): NavigationSession {
  return {
    ...createInitialNavigationSession(),
    navSessionActive: true,
    goal,
  };
}

function inputsFrom(flags: InputFlags): NavigationInputs {
  return {
    placementActive: flags.placementActive,
    activelyDragging: flags.activelyDragging ?? false,
    markerExists: flags.markerExists,
    markerPose: flags.markerExists
      ? { position: new vec3(0, 0, 0), rotation: quat.quatIdentity() }
      : null,
    cancelAvailable: true,
  };
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

describe("NavigationSession lifecycle", () => {
  it("sessionOn activates session and clears goal", () => {
    const result = applyNavigationEvent(createInitialNavigationSession(), {
      kind: "sessionOn",
    });
    expect(result.state.navSessionActive).toBe(true);
    expect(result.state.goal).toBeNull();
    expect(result.wireEffects).toEqual([]);
  });

  it("sessionOff deactivates session", () => {
    const result = applyNavigationEvent(activeSession({ since: 0 }), {
      kind: "sessionOff",
    });
    expect(result.state.navSessionActive).toBe(false);
    expect(result.state.goal).toBeNull();
  });

  it("commitGoal starts goal and can send nav goal", () => {
    const result = applyNavigationEvent(activeSession(), {
      kind: "commitGoal",
      sendToBridge: true,
      pose: mockPose(),
    });
    expect(result.state.goal).not.toBeNull();
    expect(effectKinds(result.wireEffects)).toEqual(["sendNavGoal"]);
  });
});

describe("deriveNavigationState", () => {
  it("returns disabled when session inactive", () => {
    expect(
      deriveNavigationState(
        createInitialNavigationSession(),
        inputsFrom({ placementActive: false, markerExists: true }),
      ),
    ).toBe("disabled");
  });

  it("returns idle when armed without goal or placement", () => {
    expect(
      deriveNavigationState(
        activeSession(),
        inputsFrom({ placementActive: false, markerExists: true }),
      ),
    ).toBe("idle");
  });

  it("returns navIntent during placement", () => {
    expect(
      deriveNavigationState(
        activeSession(),
        inputsFrom({ placementActive: true, markerExists: true }),
      ),
    ).toBe("navIntent");
  });

  it("returns navigating from wire state", () => {
    expect(
      deriveNavigationState(
        { ...activeSession({ since: 0 }), wireState: "navigating" },
        inputsFrom({ placementActive: false, markerExists: true }),
      ),
    ).toBe("navigating");
  });

  it("returns resolved from presentation latch", () => {
    expect(
      deriveNavigationState(
        {
          ...activeSession(),
          presentation: { kind: "resolved", label: "Failed" },
        },
        inputsFrom({ placementActive: false, markerExists: true }),
      ),
    ).toBe("resolved");
  });
});

describe("markerActive and presentation helpers", () => {
  it("markerActive is true for navIntent and navigating", () => {
    expect(markerActive("navIntent")).toBe(true);
    expect(markerActive("navigating")).toBe(true);
    expect(markerActive("idle")).toBe(false);
    expect(markerActive("resolved")).toBe(false);
  });

  it("idle anchor only on idle state", () => {
    expect(idleAnchorEnabled("idle")).toBe(true);
    expect(idleAnchorEnabled("navIntent")).toBe(false);
  });

  it("drag disabled on resolved", () => {
    expect(dragEnabledForState("resolved")).toBe(false);
    expect(dragEnabledForState("navIntent")).toBe(true);
  });

  it("marker view active follows markerActive", () => {
    const session = activeSession({ since: 0 });
    const inputs = inputsFrom({ placementActive: true, markerExists: true });
    const view = deriveMarkerViewState(session, inputs, "navIntent");
    expect(view?.active).toBe(true);
  });

  it("marker view inactive before placement", () => {
    const session = activeSession();
    const inputs = inputsFrom({ placementActive: false, markerExists: true });
    const view = deriveMarkerViewState(session, inputs, "idle");
    expect(view?.active).toBe(false);
  });
});

describe("navStatus events", () => {
  it("retryable navIntent clears goal", () => {
    const result = applyNavigationEvent(activeSession({ since: 0 }), {
      kind: "navStatus",
      state: "navIntent",
      retryable: true,
      stall_reason: "no_path",
    });
    expect(result.state.goal).toBeNull();
    expect(result.state.wireState).toBe("navIntent");
  });

  it("resolved failed latches presentation", () => {
    const result = applyNavigationEvent(activeSession({ since: 0 }), {
      kind: "navStatus",
      state: "resolved",
      outcome: "failed",
    });
    expect(result.state.goal).toBeNull();
    expect(result.state.presentation).toEqual({
      kind: "resolved",
      label: "Failed",
    });
  });

  it("watchdogFailed clears goal and latches failed presentation", () => {
    const result = applyNavigationEvent(activeSession({ since: 0 }), {
      kind: "watchdogFailed",
    });
    expect(result.state.goal).toBeNull();
    expect(result.state.wireState).toBe("idle");
    expect(result.state.presentation).toEqual({
      kind: "resolved",
      label: "Failed",
    });
  });

  it("cancelRequested clears goal, resets wire to idle, latches cancelled presentation", () => {
    const result = applyNavigationEvent(
      { ...activeSession({ since: 0 }), wireState: "navigating" },
      { kind: "cancelRequested" },
    );
    expect(result.state.goal).toBeNull();
    expect(result.state.wireState).toBe("idle");
    expect(result.state.presentation).toEqual({
      kind: "resolved",
      label: "Cancelled",
    });
    expect(effectKinds(result.wireEffects)).toEqual(["sendCancelGoal"]);
  });

  it("estopRequested does not emit sendCancelGoal", () => {
    const result = applyNavigationEvent(activeSession({ since: 0 }), {
      kind: "estopRequested",
    });
    expect(effectKinds(result.wireEffects)).toEqual([]);
  });

  it("pathReceived with goal sets navigating wire state and touches timestamps", () => {
    const session = {
      ...activeSession({ since: 0 }),
      lastNavStatusTime: 0,
      wireState: "navIntent" as const,
    };
    const result = applyNavigationEvent(session, { kind: "pathReceived" }, 5);
    expect(result.state.wireState).toBe("navigating");
    expect(result.state.lastNavStatusTime).toBe(5);
    expect(result.state.goal).toEqual({ since: 0 });
  });

  it("pathReceived without goal only touches timestamps", () => {
    const session = {
      ...activeSession(),
      lastNavStatusTime: 0,
      wireState: null,
    };
    const result = applyNavigationEvent(session, { kind: "pathReceived" }, 5);
    expect(result.state.wireState).toBeNull();
    expect(result.state.lastNavStatusTime).toBe(5);
    expect(result.state.goal).toBeNull();
  });

  it("presentationCleared clears resolved latch", () => {
    const result = applyNavigationEvent(
      {
        ...activeSession(),
        presentation: { kind: "resolved", label: "Cancelled" },
      },
      { kind: "presentationCleared" },
    );
    expect(result.state.presentation).toEqual({ kind: "none" });
  });

  it("presentationCleared is no-op when presentation is none", () => {
    const result = applyNavigationEvent(activeSession(), {
      kind: "presentationCleared",
    });
    expect(result.state.presentation).toEqual({ kind: "none" });
  });

  it("returns idle after cancel presentation finishes without placement active", () => {
    const cancelled = applyNavigationEvent(
      { ...activeSession({ since: 0 }), wireState: "navigating" },
      { kind: "cancelRequested" },
    ).state;
    const finished = applyNavigationEvent(cancelled, {
      kind: "resolvedPresentationFinished",
    }).state;
    expect(
      deriveNavigationState(
        finished,
        inputsFrom({ placementActive: false, markerExists: true }),
      ),
    ).toBe("idle");
  });

  it("resolvedPresentationFinished clears resolved wire state to idle", () => {
    const result = applyNavigationEvent(
      {
        ...activeSession(),
        wireState: "resolved",
        presentation: { kind: "resolved", label: "Failed" },
      },
      { kind: "resolvedPresentationFinished" },
    );
    expect(result.state.wireState).toBe("idle");
    expect(result.state.presentation).toEqual({ kind: "none" });
    expect(
      deriveNavigationState(
        result.state,
        inputsFrom({ placementActive: false, markerExists: true }),
      ),
    ).toBe("idle");
  });
});

describe("goal streaming guards", () => {
  it("shouldSendStreamGoal respects interval and distance", () => {
    const position = new vec3(0, 0, 0);
    const lastSent = { position: new vec3(0, 0, 0) };
    expect(
      shouldSendStreamGoal(10, 10, position, lastSent, false),
    ).toBe(false);
    expect(
      shouldSendStreamGoal(
        10 + GOAL_SEND_INTERVAL_S + 0.1,
        10,
        new vec3(30, 0, 0),
        lastSent,
        false,
      ),
    ).toBe(true);
    expect(
      shouldSendStreamGoal(
        10 + GOAL_SEND_INTERVAL_S,
        10,
        new vec3(GOAL_FORCE_NOOP_DISTANCE_CM - 1, 0, 0),
        lastSent,
        true,
      ),
    ).toBe(false);
  });
});

describe("staleness and retryable nav intent", () => {
  it("resolveRetryableNavIntent holds navigating wire state", () => {
    expect(
      resolveRetryableNavIntent(
        { ...activeSession({ since: 0 }), wireState: "navigating" },
        false,
      ),
    ).toBe("holdNavigating");
  });

  it("shouldSkipStaleLocalRecovery with navigating wire and path", () => {
    expect(
      shouldSkipStaleLocalRecovery(
        { ...activeSession({ since: 0 }), wireState: "navigating" },
        4,
      ),
    ).toBe(true);
  });

  it("checkNavLifecycleStaleness requests resync after stale timeout", () => {
    const session = {
      ...activeSession({ since: 0 }),
      lastNavStatusTime: 0,
      lastNavStatusResyncTime: -100,
      navStatusResyncCooldownS: 2,
    };
    expect(checkNavLifecycleStaleness(session, 20)).toBe("request_resync");
  });
});

describe("path rendering gate", () => {
  it("shouldRenderNavigationPath follows markerActive", () => {
    expect(shouldRenderNavigationPath("navIntent")).toBe(true);
    expect(shouldRenderNavigationPath("idle")).toBe(false);
  });
});

describe("terminal suppression", () => {
  it("shouldSuppressTerminalNavState during active drag placement", () => {
    expect(
      shouldSuppressTerminalNavState({
        placementActive: true,
        activelyDragging: true,
        markerMovedSinceLastGoal: false,
      }),
    ).toBe(true);
  });
});
