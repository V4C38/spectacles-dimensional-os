import { describe, it, expect } from "vitest";
import {
  validateSessionFields,
  nextLidarMode,
  createDefaultDimosAppState,
  navigationOutcomePresentation,
  toSessionState,
  defaultNavigationOutcome,
  createDefaultRobotRuntimeState,
  type DimosAppState,
} from "../../Assets/Scripts/Core/AppState";
import { COLOR_ERROR, COLOR_SUCCESS } from "../mocks/UIKit";

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
    bridgeLinkState: "disconnected",
    robotRuntime: runtimeState(),
    driftState: createDefaultDimosAppState().driftState,
    ...patch,
  };
}

describe("validateSessionFields", () => {
  it("forces setup-phase navigation off and demotes runtimeRobot interaction", () => {
    const next = validateSessionFields(
      baseState({
        phase: "setup",
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

  it("turns off navigation when operating mode is setup", () => {
    const next = validateSessionFields(
      baseState({
        phase: "runtime",
        operatingMode: "setup",
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
    expect(state.phase).toBe("setup");
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
});

describe("toSessionState", () => {
  it("maps setup phase", () => {
    expect(
      toSessionState(
        baseState({
          phase: "setup",
          robotInteractionMode: "manualPlacement",
        }),
      ),
    ).toEqual({ phase: "setup", interaction: "manualPlacement" });
  });

  it("maps runtime phase", () => {
    expect(
      toSessionState(
        baseState({
          phase: "runtime",
          operatingMode: "agent",
          robotInteractionMode: "runtimeRobot",
          navigationState: "executingGoal",
          navigationOutcome: { kind: "success" },
        }),
      ),
    ).toEqual({
      phase: "runtime",
      operating: "agent",
      interaction: "runtimeRobot",
      navigation: "executingGoal",
      outcome: { kind: "success" },
    });
  });
});
