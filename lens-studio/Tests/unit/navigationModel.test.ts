import { describe, expect, it } from "vitest";
import {
  applyNavigationEvent,
  createInitialNavEngineState,
  checkNavLifecycleStaleness,
  deriveAppNavigationState,
  deriveNavPhase,
  deriveViewState,
  shouldSendStreamGoal,
  GOAL_FORCE_NOOP_DISTANCE_CM,
  GOAL_SEND_INTERVAL_S,
  GOAL_SEND_MIN_DISTANCE_CM,
  shouldRenderNavigationPath,
  type NavigationEffect,
  type NavEngineState,
  type NavLiveContext,
} from "../../Assets/Scripts/ARBridge/Navigation/NavigationModel";

type LiveFlags = {
  placementActive: boolean;
  activelyDragging?: boolean;
  markerExists: boolean;
  outcomeAnimating?: boolean;
};

const DEFAULT_CAPS = {
  cancelAvailable: true,
  sessionActive: true,
};

function armedState(goal: NavEngineState["goal"] = null): NavEngineState {
  return { ...createInitialNavEngineState(), armed: true, goal };
}

function liveFrom(flags: LiveFlags): NavLiveContext {
  return {
    placementActive: flags.placementActive,
    activelyDragging: flags.activelyDragging ?? false,
    markerExists: flags.markerExists,
    outcomeAnimating: flags.outcomeAnimating ?? false,
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

describe("NavigationModel armed flag", () => {
  it("arm sets armed and clears goal", () => {
    const result = applyNavigationEvent(createInitialNavEngineState(), { kind: "arm" });
    expect(result.state.armed).toBe(true);
    expect(result.state.goal).toBeNull();
    expect(effectKinds(result.effects)).toContain("clearPath");
  });

  it("disarm clears armed and destroys marker", () => {
    const result = applyNavigationEvent(armedState(), { kind: "disarm" });
    expect(result.state.armed).toBe(false);
    expect(effectKinds(result.effects)).toEqual(
      expect.arrayContaining(["stopPlacement", "destroyMarker", "clearPath"]),
    );
  });

  it("deriveViewState returns null when not armed", () => {
    expect(
      deriveViewState(
        createInitialNavEngineState(),
        liveFrom({ placementActive: false, markerExists: true }),
        DEFAULT_CAPS,
      ),
    ).toBeNull();
  });
});

describe("NavigationModel stream commit", () => {
  it("goalCommitRequested starts goal and sends nav goal", () => {
    const result = applyNavigationEvent(armedState(), {
      kind: "goalCommitRequested",
      sendToBridge: true,
      pose: mockPose(),
    }, 1);
    expect(result.state.goal).toEqual({ since: 1, navigating: false });
    expect(effectKinds(result.effects)).toEqual(
      expect.arrayContaining(["sendNavGoal", "resetNavigationOutcome"]),
    );
  });

  it("shouldStreamGoal when armed and placement active", () => {
    const view = viewFrom(armedState(), {
      placementActive: true,
      markerExists: true,
    });
    expect(view.shouldStreamGoal).toBe(true);
  });

  it("shouldSendStreamGoal respects interval and distance", () => {
    const pos = new vec3(0, 0, 0);
    expect(
      shouldSendStreamGoal(GOAL_SEND_INTERVAL_S + 1, 0, pos, null, false),
    ).toBe(true);
    expect(
      shouldSendStreamGoal(0.1, 0, pos, { position: pos }, false),
    ).toBe(false);
    expect(
      shouldSendStreamGoal(
        GOAL_SEND_INTERVAL_S + 1,
        0,
        new vec3(100, 0, 0),
        { position: pos },
        false,
      ),
    ).toBe(true);
    expect(
      shouldSendStreamGoal(0, 0, new vec3(100, 0, 0), { position: pos }, true),
    ).toBe(true);
    expect(
      shouldSendStreamGoal(
        0,
        0,
        new vec3(GOAL_FORCE_NOOP_DISTANCE_CM - 0.5, 0, 0),
        { position: pos },
        true,
      ),
    ).toBe(false);
  });
});

describe("NavigationModel placement policy", () => {
  it("idle follow-robot when armed without active goal", () => {
    const view = viewFrom(armedState(), {
      placementActive: false,
      markerExists: true,
    });
    expect(view.placement).toEqual({ dragEnabled: true, followRobot: true });
  });

  it("drag enabled while goal active", () => {
    const view = viewFrom(
      armedState({ since: 0, navigating: true }),
      { placementActive: false, markerExists: true },
    );
    expect(view.placement.dragEnabled).toBe(true);
    expect(view.placement.followRobot).toBe(false);
  });
});

describe("NavigationModel lifecycle", () => {
  it("navStatusGoalReached reanchors marker to robot when far", () => {
    const result = applyNavigationEvent(
      armedState({ since: 0, navigating: true }),
      { kind: "navStatusGoalReached" },
    );
    expect(result.state.goal).toBeNull();
    expect(effectKinds(result.effects)).toEqual(
      expect.arrayContaining(["clearPath", "reanchorMarkerToRobot"]),
    );
    expect(effectKinds(result.effects)).not.toContain("respawnMarkerAt");
  });

  it("cancelRequested plays cancelled outcome", () => {
    const result = applyNavigationEvent(
      armedState({ since: 0, navigating: true }),
      { kind: "cancelRequested" },
    );
    expect(result.state.goal).toBeNull();
    expect(effectKinds(result.effects)).toContain("beginOutcomeAnimation");
    expect(effectKinds(result.effects)).not.toContain("sendCancelGoal");
    const outcomeEffect = result.effects.find(
      (effect) => effect.kind === "beginOutcomeAnimation",
    );
    expect(outcomeEffect).toMatchObject({ label: "Cancelled" });
  });

  it("navStatusGoalFailed plays failed outcome without sendCancelGoal", () => {
    const result = applyNavigationEvent(
      armedState({ since: 0, navigating: true }),
      { kind: "navStatusGoalFailed" },
    );
    expect(result.state.goal).toBeNull();
    expect(effectKinds(result.effects)).toContain("beginOutcomeAnimation");
    expect(effectKinds(result.effects)).not.toContain("sendCancelGoal");
    const outcomeEffect = result.effects.find(
      (effect) => effect.kind === "beginOutcomeAnimation",
    );
    expect(outcomeEffect).toMatchObject({ label: "Failed" });
  });

  it("navStatusRecovering respawns marker animated", () => {
    const result = applyNavigationEvent(
      armedState({ since: 0, navigating: true }),
      { kind: "navStatusRecovering" },
    );
    expect(effectKinds(result.effects)).toEqual(
      expect.arrayContaining(["respawnMarkerAt", "clearPath"]),
    );
  });

  it("disconnect disarms and clears session", () => {
    const result = applyNavigationEvent(
      armedState({ since: 0, navigating: true }),
      { kind: "disconnect" },
    );
    expect(result.state.armed).toBe(false);
    expect(result.state.goal).toBeNull();
  });
});

describe("NavigationModel marker presentation", () => {
  it("circleIdle true before first drag", () => {
    const view = viewFrom(armedState(), {
      placementActive: false,
      markerExists: true,
    });
    expect(view.marker.circleIdle).toBe(true);
  });

  it("circleIdle false after placement activated", () => {
    const view = viewFrom(armedState(), {
      placementActive: true,
      markerExists: true,
    });
    expect(view.marker.circleIdle).toBe(false);
  });

  it("shows cancel button while placing", () => {
    const view = viewFrom(armedState(), {
      placementActive: true,
      markerExists: true,
    });
    expect(view.marker.button?.role).toBe("cancel");
  });

  it("cancel button stays enabled when bridge cancel unavailable", () => {
    const view = deriveViewState(
      armedState({ since: 0, navigating: true }),
      liveFrom({ placementActive: true, markerExists: true }),
      { cancelAvailable: false, sessionActive: true },
    )!;
    expect(view.marker.button?.enabled).toBe(true);
    expect(view.marker.button?.label).toBe("Cancel\nUnavailable");
  });

  it("outcome label set while outcome animating", () => {
    const view = deriveViewState(
      armedState({ since: 0, navigating: false }),
      {
        placementActive: false,
        activelyDragging: false,
        markerExists: true,
        outcomeAnimating: true,
        outcomeLabel: "Cancelled",
        markerPose: { position: new vec3(0, 0, 0), rotation: quat.quatIdentity() },
      },
      DEFAULT_CAPS,
    )!;
    expect(view.marker.outcomeLabel).toBe("Cancelled");
    expect(view.marker.button).toBeNull();
  });

  it("hides cancel button before first drag", () => {
    const view = viewFrom(armedState(), {
      placementActive: false,
      markerExists: true,
    });
    expect(view.marker.button).toBeNull();
  });

  it("committed phase when goal is navigating", () => {
    const phase = deriveNavPhase(
      armedState({ since: 0, navigating: true }),
      liveFrom({ placementActive: false, markerExists: true }),
    );
    expect(phase.kind).toBe("committed");
    if (phase.kind === "committed") {
      expect(phase.navigating).toBe(true);
    }
  });

  it("shouldRenderNavigationPath when goal or placement active", () => {
    expect(
      shouldRenderNavigationPath(
        viewFrom(armedState(), {
          placementActive: true,
          markerExists: true,
        }),
      ),
    ).toBe(true);
  });

  it("deriveAppNavigationState maps armed idle to armed", () => {
    expect(
      deriveAppNavigationState(
        viewFrom(armedState(), {
          placementActive: false,
          markerExists: true,
        }),
      ),
    ).toBe("armed");
  });
});

describe("NavigationModel staleness", () => {
  it("checkNavLifecycleStaleness ok when no goal", () => {
    expect(checkNavLifecycleStaleness(armedState(), 100)).toBe("ok");
  });

  it("checkNavLifecycleStaleness requests resync when stale", () => {
    const state = {
      ...armedState({ since: 0, navigating: true }),
      lastNavStatusTime: 0,
      lastNavStatusResyncTime: -100,
      navStatusResyncCooldownS: 2,
    };
    expect(checkNavLifecycleStaleness(state, 20)).toBe("request_resync");
  });
});
