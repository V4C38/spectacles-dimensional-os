import { describe, it, expect } from "vitest";
import {
  validateSessionFields,
  nextLidarMode,
  createDefaultAppStateData,
  createDefaultBridgeSnapshot,
  navigationErrorPresentation,
  robotActivityPresentation,
  robotMarkerSteadyStatePresentation,
  toSessionState,
  defaultNavigationError,
  createDefaultRobotRuntimeState,
  isRuntimePhase,
  AppStateStore,
  type AppStateData,
} from "../../Assets/Scripts/App/AppState";
import {
  bridgeLinkPresentation,
  bridgeLinkTransitionLog,
  bridgeConnectPresentation,
} from "../../Assets/Scripts/App/Bridge/BridgePresentation";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WARN, COLOR_WHITE } from "../mocks/UIKit";

function runtimeState(
  patch: Partial<AppStateData["robotRuntime"]> = {},
): AppStateData["robotRuntime"] {
  return { ...createDefaultRobotRuntimeState(), ...patch };
}

function baseState(patch: Partial<AppStateData> = {}): AppStateData {
  return {
    phase: "runtime",
    debugMode: false,
    lidarMode: "obstacles",
    operatingMode: "manual",
    navigationState: "disabled",
    robotInteractionMode: "hidden",
    navigationError: defaultNavigationError(),
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
        navigationState: "idle",
        navigationError: { kind: "failed", errorCode: null },
        robotInteractionMode: "runtimeRobot",
      }),
    );
    expect(next.navigationState).toBe("disabled");
    expect(next.navigationError).toEqual(defaultNavigationError());
    expect(next.robotInteractionMode).toBe("hidden");
  });

  it("turns off armed navigation when operating mode is not manual", () => {
    const next = validateSessionFields(
      baseState({
        phase: "runtime",
        navigationState: "idle",
        operatingMode: "agent",
      }),
    );
    expect(next.navigationState).toBe("disabled");
  });

  it("turns off navigation when operating mode is registration", () => {
    const next = validateSessionFields(
      baseState({
        phase: "runtime",
        operatingMode: "registrationMode",
        navigationState: "navIntent",
      }),
    );
    expect(next.navigationState).toBe("disabled");
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
    const store = new AppStateStore();
    expect(state.phase).toBe("registration");
    expect(state.lidarMode).toBe("off");
    expect(state.operatingMode).toBe("manual");
    expect(store.bridgeLinkState).toBe("disconnected");
    expect(state.navigationState).toBe("disabled");
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

describe("navigationErrorPresentation", () => {
  it("maps failed errors to status text", () => {
    expect(navigationErrorPresentation({ kind: "failed", errorCode: 1 })).toEqual({
      text: "Navigation failed",
      color: COLOR_ERROR,
    });
    expect(navigationErrorPresentation({ kind: "none" })).toBeNull();
  });
});

describe("bridgeLinkPresentation", () => {
  it("maps bridge link states to status text", () => {
    expect(bridgeLinkPresentation("disconnected")).toEqual({
      text: "\n\n\nBridge not connected",
      color: COLOR_ERROR,
    });
    expect(bridgeLinkPresentation("connectedNoRobot")).toEqual({
      text: "\n\n\nBridge connected - Robot not connected",
      color: COLOR_WARN,
    });
    expect(bridgeLinkPresentation("connected", "Unitree Go2")).toEqual({
      text: "\n\n\nBridge connected - Unitree Go2",
      color: COLOR_SUCCESS,
    });
  });
});

describe("bridgeConnectPresentation", () => {
  it("shows connecting before socket opens", () => {
    const result = bridgeConnectPresentation({
      linkState: "disconnected",
      isConnecting: true,
      socketOpen: false,
      handshakeReady: false,
      clockSync: "idle",
    });
    expect(result.primary.text).toBe("Connecting to bridge…");
    expect(result.detail).toBeNull();
  });

  it("shows handshake wait when socket is open", () => {
    const result = bridgeConnectPresentation({
      linkState: "disconnected",
      isConnecting: true,
      socketOpen: true,
      handshakeReady: false,
      clockSync: "idle",
    });
    expect(result.primary.text).toBe("Waiting for handshake…");
  });

  it("shows clock sync detail when connected", () => {
    const result = bridgeConnectPresentation({
      linkState: "connected",
      isConnecting: false,
      socketOpen: true,
      handshakeReady: true,
      clockSync: "pending",
      displayName: "Unitree Go2",
    });
    expect(result.detail).toBe("Syncing clock…");
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
        baseState({ navigationError: { kind: "failed", errorCode: 1 } }),
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

  it("shows robot offline when bridge snapshot has no robot", () => {
    expect(
      robotActivityPresentation(
        baseState({
          bridgeSnapshot: {
            ...createDefaultBridgeSnapshot(),
            handshakeReady: true,
            robotConnected: false,
          },
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
        baseState({ operatingMode: "registrationMode" }),
      ),
    ).toEqual({ text: "", color: COLOR_WHITE });
  });

  it("returns Idle for agent mode when navigation is off", () => {
    expect(
      robotMarkerSteadyStatePresentation(
        baseState({
          operatingMode: "agent",
          navigationState: "disabled",
        }),
      ),
    ).toEqual({ text: "Idle", color: COLOR_WHITE });
  });

  it("returns Robot offline when bridge snapshot has no robot", () => {
    expect(
      robotMarkerSteadyStatePresentation(
        baseState({
          bridgeSnapshot: {
            ...createDefaultBridgeSnapshot(),
            handshakeReady: true,
            robotConnected: false,
          },
        }),
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
          robotInteractionMode: "manual_placement",
        }),
      ),
    ).toEqual({ phase: "registration", interaction: "manual_placement" });
  });

  it("maps runtime phase", () => {
    expect(
      toSessionState(
        baseState({
          phase: "runtime",
          operatingMode: "agent",
          robotInteractionMode: "runtimeRobot",
          navigationState: "navigating",
          navigationError: { kind: "none" },
        }),
      ),
    ).toEqual({
      phase: "runtime",
      operating: "agent",
      interaction: "runtimeRobot",
      navigation: "navigating",
      error: { kind: "none" },
    });
  });
});
