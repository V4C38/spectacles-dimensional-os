import { describe, it, expect } from "vitest";
import {
  AppState,
  validateSessionFields,
  nextLidarMode,
  createDefaultAppStateData,
  createDefaultBridgeSnapshot,
  bridgeLinkPresentation,
  bridgeLinkTransitionLog,
  navigationOutcomePresentation,
  robotActivityPresentation,
  robotMarkerSteadyStatePresentation,
  toSessionState,
  defaultNavigationOutcome,
  createDefaultRobotRuntimeState,
  isRuntimePhase,
  NO_ROBOT_CONNECTED_LABEL,
  type AppStateData,
} from "../../Assets/Scripts/App/AppState";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WARN, COLOR_WHITE } from "../mocks/UIKit";

function runtimeState(
  patch: Partial<AppStateData["robotRuntime"]> = {},
): AppStateData["robotRuntime"] {
  return { ...createDefaultRobotRuntimeState(), ...patch };
}

function baseState(patch: Partial<AppStateData> = {}): AppStateData {
  return {
    phase: "runtime",
    runtimeEstablished: true,
    debugMode: false,
    lidarMode: "obstacles",
    operatingMode: "manual",
    navigationState: "off",
    robotInteractionMode: "hidden",
    navigationOutcome: defaultNavigationOutcome(),
    bridgeLinkState: "disconnected",
    bridgeSnapshot: createDefaultBridgeSnapshot(),
    robotRuntime: runtimeState(),
    driftState: createDefaultAppStateData().driftState,
    ...patch,
  };
}

describe("validateSessionFields", () => {
  it("forces registration-phase navigation off and demotes runtimeRobot interaction", () => {
    const next = validateSessionFields(
      baseState({
        phase: "registration",
        navigationState: "armed",
        navigationOutcome: { kind: "failed", errorCode: null },
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

describe("createDefaultAppStateData", () => {
  it("returns expected defaults", () => {
    const state = createDefaultAppStateData();
    expect(state.phase).toBe("registration");
    expect(state.lidarMode).toBe("off");
    expect(state.operatingMode).toBe("manual");
    expect(state.bridgeLinkState).toBe("disconnected");
    expect(state.navigationState).toBe("off");
  });
});

describe("isRuntimePhase", () => {
  it("is false during registration", () => {
    expect(isRuntimePhase(createDefaultAppStateData())).toBe(false);
  });

  it("is true when phase is runtime", () => {
    expect(isRuntimePhase(baseState())).toBe(true);
  });
});

describe("navigationOutcomePresentation", () => {
  it("maps failed outcomes to status text", () => {
    expect(navigationOutcomePresentation({ kind: "failed", errorCode: 1 })).toEqual({
      text: "Navigation failed",
      color: COLOR_ERROR,
    });
    expect(navigationOutcomePresentation({ kind: "none" })).toBeNull();
  });
});

describe("bridgeLinkPresentation", () => {
  it("maps bridge link states to status text", () => {
    AppState.connectedRobotDisplayName = NO_ROBOT_CONNECTED_LABEL;
    expect(bridgeLinkPresentation("disconnected")).toEqual({
      text: "\n\n\nBridge not connected",
      color: COLOR_ERROR,
    });
    expect(bridgeLinkPresentation("connectedNoRobot")).toEqual({
      text: "\n\n\nBridge connected - Robot not connected",
      color: COLOR_WARN,
    });
    AppState.connectedRobotDisplayName = "Unitree Go2";
    expect(bridgeLinkPresentation("connected")).toEqual({
      text: "\n\n\nBridge connected - Unitree Go2",
      color: COLOR_SUCCESS,
    });
    AppState.connectedRobotDisplayName = NO_ROBOT_CONNECTED_LABEL;
  });
});

describe("bridgeLinkTransitionLog", () => {
  it("returns robot disconnect when connected to connectedNoRobot", () => {
    expect(bridgeLinkTransitionLog("connected", "connectedNoRobot")).toEqual({
      hudText: "Robot disconnected",
      hudColor: COLOR_ERROR,
      consoleText: "Robot disconnected",
      consoleColor: COLOR_ERROR,
      hudDurationS: 3.0,
    });
  });

  it("returns robot connected when recovering from connectedNoRobot", () => {
    expect(bridgeLinkTransitionLog("connectedNoRobot", "connected")).toEqual({
      hudText: "Robot connected",
      hudColor: COLOR_SUCCESS,
      consoleText: "Robot connected",
      consoleColor: COLOR_SUCCESS,
      hudDurationS: 2.0,
    });
  });

  it("returns null when link state is unchanged", () => {
    expect(bridgeLinkTransitionLog("connected", "connected")).toBeNull();
  });
});

describe("robotActivityPresentation", () => {
  it("prefers navigation outcome over steady state", () => {
    expect(
      robotActivityPresentation(
        baseState({ navigationOutcome: { kind: "failed", errorCode: 1 } }),
      ),
    ).toEqual({ text: "Navigation failed", color: COLOR_ERROR });
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

  it("shows robot offline when bridge link is connectedNoRobot", () => {
    expect(
      robotActivityPresentation(
        baseState({
          bridgeLinkState: "connectedNoRobot",
          navigationState: "navigating",
        }),
      ),
    ).toEqual({ text: "Robot offline", color: COLOR_ERROR });
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

  it("returns Robot offline when bridge link is connectedNoRobot", () => {
    expect(
      robotMarkerSteadyStatePresentation(
        baseState({ bridgeLinkState: "connectedNoRobot" }),
      ),
    ).toEqual({ text: "Robot offline", color: COLOR_ERROR });
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
          navigationOutcome: { kind: "none" },
        }),
      ),
    ).toEqual({
      phase: "runtime",
      operating: "agent",
      interaction: "runtimeRobot",
      navigation: "navigating",
      outcome: { kind: "none" },
    });
  });
});
