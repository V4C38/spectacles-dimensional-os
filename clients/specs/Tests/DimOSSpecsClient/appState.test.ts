import { describe, expect, it } from "vitest";
import {
  AppState,
  getRobotActivityState,
  robotTitleText,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/AppState";
import { NO_ROBOT_CONNECTED_LABEL } from "../../Assets/Scripts/DimOSARClient/websocket/sessionLinkStatus";
import type { ARModuleSessionState } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type { Hello, Pose, RobotDescription } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

const GO2: RobotDescription = {
  display_name: "Unitree Go2",
  body_bounds_m: [0.7, 0.5, 0.55],
  footprint_m: [0.7, 0.5],
  base_height_m: 0.33,
};

const POSE: Pose = {
  position: [1, 2, 3],
  orientation: [0, 0, 0, 1],
};

function baseView(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
  return {
    connection: "ready",
    hasTrackingOrigin: false,
    hello: null,
    state: null,
    pose: null,
    nav_goal: null,
    lidar: null,
    capabilities: null,
    nav: null,
    lastError: null,
    ...overrides,
  };
}

function helloView(): Hello {
  return {
    type: "hello",
    client_id: "test-client",
    time_sync: { ts_client: 0, ts_server: 0 },
    robot: GO2,
    capabilities: {
      lidar: { available: true, reason: null },
      navigation: { available: true, reason: null },
      localization: { available: true, reason: null },
      estop: { available: true, reason: null },
    },
  };
}

describe("AppState", () => {
  it("stores debug mode", () => {
    const state = new AppState();
    expect(state.debugModeEnabled).toBe(false);
    state.setDebugMode(true);
    expect(state.debugModeEnabled).toBe(true);
  });
});

describe("robotTitleText", () => {
  it("shows no robot connected when bridge is not attached", () => {
    expect(robotTitleText(baseView({ connection: "disconnected" }))).toBe(
      NO_ROBOT_CONNECTED_LABEL,
    );
    expect(robotTitleText(baseView({ connection: "connecting" }))).toBe(NO_ROBOT_CONNECTED_LABEL);
  });

  it("shows robot display name once bridge is attached", () => {
    expect(
      robotTitleText(baseView({ connection: "ready", hello: helloView(), pose: POSE })),
    ).toBe("Unitree Go2");
  });
});

describe("getRobotActivityState", () => {
  it("returns Idle when nav is null, idle, or resolved", () => {
    expect(getRobotActivityState(baseView({ nav: null }))).toBe("Idle");
    expect(getRobotActivityState(baseView({ nav: { state: "idle", outcome: null } }))).toBe(
      "Idle",
    );
  });

  it("returns Following Path when nav is following_path", () => {
    expect(
      getRobotActivityState(baseView({ nav: { state: "following_path", outcome: null } })),
    ).toBe("Following Path");
  });
});
