import { describe, it, expect } from "vitest";
import {
  validateSessionFields,
  nextLidarMode,
  createDefaultDimosAppState,
  bridgeLinkPresentation,
  navigationOutcomePresentation,
  robotActivityPresentation,
  robotMarkerSteadyStatePresentation,
  toSessionState,
  defaultNavigationOutcome,
  createDefaultRobotRuntimeState,
  type DimosAppState,
} from "../../Assets/Scripts/Core/AppState";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WARN, COLOR_WHITE } from "../mocks/UIKit";

function runtimeState(
  patch: Partial<DimosAppState["robotRuntime"]> = {},
): DimosAppState["robotRuntime"] {
  return { ...createDefaultRobotRuntimeState(), ...patch };
}

function baseState(patch: Partial<DimosAppState> = {}): DimosAppState {
  return {
    phase: "runtime",
    debugMode: false,
    lidarMode: "obstacles",
    operatingMode: "manual",
    mainMenuExpandedSettingsMode: null,
    navigationState: "off",
    robotInteractionMode: "hidden",
    navigationOutcome: defaultNavigationOutcome(),
    navigationGoalMode: "single",
    bridgeLinkState: "disconnected",
    robotRuntime: runtimeState(),
    driftState: createDefaultDimosAppState().driftState,
    ...patch,
  };
}

describe("validateSessionFields", () => {
  it("forces registration-phase navigation off and demotes runtimeRobot interaction", () => {
    const next = validateSessionFields(
      baseState({
        phase: "registration",
        navigationState: "armed",
        navigationOutcome: { kind: "success" },
        robotInteractionMode: "runtimeRobot",
      }),
    );
    expect(next.navigationState).toBe("off");
    expect(next.navigationOutcome).toEqual(defaultNavigationOutcome());
    expect(next.robotInteractionMode).toBe("hidden");
  });

  it("turns off armed navigation when operating mode is not manual", () => {
    const next = validateSessionFields(
      baseState({
        phase: "runtime",
        navigationState: "armed",
        operatingMode: "agent",
      }),
    );
    expect(next.navigationState).toBe("off");
  });

  it("turns off navigation when operating mode is registration", () => {
    const next = validateSessionFields(
      baseState({
        phase: "runtime",
        operatingMode: "registration",
        navigationState: "placingGoal",
      }),
    );
    expect(next.navigationState).toBe("off");
  });

  it("turns off lidar mode when capability unavailable", () => {
    const capabilities = { ...createDefaultRobotRuntimeState().capabilities };
    capabilities.lidar = { available: false, reason: "disabled" };
    const next = validateSessionFields(
      baseState({
        lidarMode: "full",
        robotRuntime: runtimeState({ capabilities }),
      }),
    );
    expect(next.lidarMode).toBe("off");
  });
});

describe("nextLidarMode", () => {
  it("cycles off to obstacles to full to off", () => {
    expect(nextLidarMode("off")).toBe("obstacles");
    expect(nextLidarMode("obstacles")).toBe("full");
    expect(nextLidarMode("full")).toBe("off");
  });
});

describe("createDefaultDimosAppState", () => {
  it("returns expected defaults", () => {
    const state = createDefaultDimosAppState();
    expect(state.phase).toBe("registration");
    expect(state.lidarMode).toBe("obstacles");
    expect(state.operatingMode).toBe("manual");
    expect(state.bridgeLinkState).toBe("disconnected");
    expect(state.navigationState).toBe("off");
  });
});

describe("navigationOutcomePresentation", () => {
  it("maps success and failed outcomes to status text", () => {
    expect(navigationOutcomePresentation({ kind: "success" })).toEqual({
      text: "Navigation success",
      color: COLOR_SUCCESS,
    });
    expect(navigationOutcomePresentation({ kind: "failed", errorCode: 1 })).toEqual({
      text: "Navigation failed",
      color: COLOR_ERROR,
    });
    expect(navigationOutcomePresentation({ kind: "none" })).toBeNull();
  });
describe("bridgeLinkPresentation", () => {
  it("maps bridge link states to status text", () => {
    expect(bridgeLinkPresentation("disconnected")).toEqual({
      text: "\n\n\nBridge disconnected",
      color: COLOR_ERROR,
    });
    expect(bridgeLinkPresentation("connectedNoRobot")).toEqual({
      text: "\n\n\nBridge connected - waiting for robot",
      color: COLOR_WARN,
    });
    expect(bridgeLinkPresentation("connected")).toEqual({
      text: "\n\n\nBridge connected",
      color: COLOR_SUCCESS,
    });
  });
});

describe("robotActivityPresentation", () => {
  it("prefers navigation outcome over steady state", () => {
    expect(
      robotActivityPresentation(
        baseState({ navigationOutcome: { kind: "success" } }),
      ),
    ).toEqual({ text: "Navigation success", color: COLOR_SUCCESS });
  });

  it("falls back to steady state when no outcome", () => {
    expect(
      robotActivityPresentation(
        baseState({
          operatingMode: "agent",
          navigationState: "navigating",
        }),
      ),
    ).toEqual({ text: "Navigating", color: COLOR_WHITE });
  });
});

});

describe("robotMarkerSteadyStatePresentation", () => {
  it("returns empty text in registration mode", () => {
    expect(
      robotMarkerSteadyStatePresentation(
        baseState({ operatingMode: "registration" }),
      ),
    ).toEqual({ text: "", color: COLOR_WHITE });
  });

  it("returns Idle for agent mode when navigation is off", () => {
    expect(
      robotMarkerSteadyStatePresentation(
        baseState({
          operatingMode: "agent",
          navigationState: "off",
        }),
      ),
    ).toEqual({ text: "Idle", color: COLOR_WHITE });
  });

  it("returns Navigating for agent mode when navigation is active", () => {
    expect(
      robotMarkerSteadyStatePresentation(
        baseState({
          operatingMode: "agent",
          navigationState: "navigating",
        }),
      ),
    ).toEqual({ text: "Navigating", color: COLOR_WHITE });
  });

  it("returns Following for agent mode with continuous goal mode", () => {
    expect(
      robotMarkerSteadyStatePresentation(
        baseState({
          operatingMode: "agent",
          navigationState: "navigating",
          navigationGoalMode: "continuous",
        }),
      ),
    ).toEqual({ text: "Following", color: COLOR_WHITE });
  });
});

describe("toSessionState", () => {
  it("maps registration phase", () => {
    expect(
      toSessionState(
        baseState({
          phase: "registration",
          robotInteractionMode: "manualPlacement",
        }),
      ),
    ).toEqual({ phase: "registration", interaction: "manualPlacement" });
  });

  it("maps runtime phase", () => {
    expect(
      toSessionState(
        baseState({
          phase: "runtime",
          operatingMode: "agent",
          robotInteractionMode: "runtimeRobot",
          navigationState: "navigating",
          navigationOutcome: { kind: "success" },
        }),
      ),
    ).toEqual({
      phase: "runtime",
      operating: "agent",
      interaction: "runtimeRobot",
      navigation: "navigating",
      outcome: { kind: "success" },
    });
  });
});
