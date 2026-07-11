import { describe, expect, it } from "vitest";
import {
  createInitialNavigationSession,
  deriveNavigationState,
  type NavigationInputs,
  type NavigationSession,
} from "../../Assets/Scripts/ARBridge/Navigation/NavigationModel";
import {
  planNavStatusEvent,
  shouldStreamGoalNow,
} from "../../Assets/Scripts/App/Navigation/NavigationPresentation";

function activeSession(goal: NavigationSession["goal"] = null): NavigationSession {
  return {
    ...createInitialNavigationSession(),
    navSessionActive: true,
    goal,
  };
}

function inputs(overrides: Partial<NavigationInputs>): NavigationInputs {
  return {
    placementActive: false,
    activelyDragging: false,
    markerExists: true,
    markerPose: { position: new vec3(0, 0, 0), rotation: quat.quatIdentity() },
    cancelAvailable: true,
    ...overrides,
  };
}

describe("planNavStatusEvent", () => {
  it("dispatches resolved when no tracked goal", () => {
    const plan = planNavStatusEvent(
      activeSession(),
      { type: "nav_status", ts: 1, state: "resolved", outcome: "succeeded" },
      false,
    );
    expect(plan).toEqual({
      kind: "dispatch",
      event: {
        kind: "navStatus",
        state: "resolved",
        outcome: "succeeded",
        retryable: undefined,
        stall_reason: undefined,
      },
    });
  });

  it("continues placement when terminal status is suppressed", () => {
    const plan = planNavStatusEvent(
      activeSession({ since: 0 }),
      { type: "nav_status", ts: 1, state: "resolved", outcome: "succeeded" },
      true,
    );
    expect(plan).toEqual({ kind: "continuePlacement" });
  });

  it("continues placement on suppressed failed terminal", () => {
    const plan = planNavStatusEvent(
      activeSession({ since: 0 }),
      { type: "nav_status", ts: 1, state: "resolved", outcome: "failed" },
      true,
    );
    expect(plan).toEqual({ kind: "continuePlacement" });
  });

  it("passes through retryable navIntent", () => {
    const plan = planNavStatusEvent(
      activeSession({ since: 0 }),
      {
        type: "nav_status",
        ts: 1,
        state: "navIntent",
        retryable: true,
        stall_reason: "no_path",
      },
      false,
    );
    expect(plan).toEqual({
      kind: "dispatch",
      event: {
        kind: "navStatus",
        state: "navIntent",
        outcome: undefined,
        retryable: true,
        stall_reason: "no_path",
      },
    });
  });

  it("dispatches navigating when terminal is not suppressed", () => {
    const plan = planNavStatusEvent(
      activeSession({ since: 0 }),
      { type: "nav_status", ts: 1, state: "navigating" },
      false,
    );
    expect(plan.kind).toBe("dispatch");
    if (plan.kind === "dispatch") {
      expect(plan.event).toEqual({
        kind: "navStatus",
        state: "navigating",
        outcome: undefined,
        retryable: undefined,
        stall_reason: undefined,
      });
    }
  });
});

describe("shouldStreamGoalNow", () => {
  it("is true during active placement in navIntent", () => {
    expect(
      shouldStreamGoalNow(
        { ...activeSession(), wireState: "navIntent" },
        inputs({ placementActive: true }),
      ),
    ).toBe(true);
  });

  it("is false when idle without placement", () => {
    expect(
      shouldStreamGoalNow(activeSession(), inputs({ placementActive: false })),
    ).toBe(false);
    expect(
      deriveNavigationState(
        activeSession(),
        inputs({ placementActive: false }),
      ),
    ).toBe("idle");
  });
});
