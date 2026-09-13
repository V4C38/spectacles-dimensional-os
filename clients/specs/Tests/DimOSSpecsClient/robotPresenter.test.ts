import { describe, expect, it } from "vitest";
import { AppState } from "../../Assets/Scripts/DimOSSpecsClient/presentation/AppState";
import {
  deriveRobotMarkerApplyInput,
  robotBelowMainUiLocalOffset,
  robotDeadzoneRadiusCm,
  robotFloorOffsetCm,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/RobotPresenter";
import { clientTrackingToSpecsPoint } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import type { ARModuleSessionState } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type { ClientTrackingOrigin } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import type { Hello, Pose, RobotDescription, Vec3 } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

const GO2: RobotDescription = {
  display_name: "Unitree Go2",
  body_bounds_m: [0.7, 0.5, 0.55],
  footprint_m: [0.7, 0.5],
  base_height_m: 0.33,
};

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
}

describe("robotFloorOffsetCm", () => {
  it("offsets from pose to floor using base_height_m", () => {
    expectVec3(robotFloorOffsetCm(GO2), clientTrackingToSpecsPoint([0, 0, -0.33]));
    expectVec3(robotFloorOffsetCm(GO2), [0, -33, 0]);
  });
});

describe("robotBelowMainUiLocalOffset", () => {
  it("places the odom root below the authored frame", () => {
    const offset = robotBelowMainUiLocalOffset();
    expect(offset.y).toBe(-40);
    expect(offset.z).toBeGreaterThan(0);
  });
});

const POSE: Pose = {
  position: [1, 2, 3],
  orientation: [0, 0, 0, 1],
};

const ORIGIN: ClientTrackingOrigin = {
  position: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  confidence: 1,
  ts: 0,
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

describe("deriveRobotMarkerApplyInput", () => {
  it("returns hidden before wizard finishes", () => {
    const appState = new AppState();
    expect(
      deriveRobotMarkerApplyInput({
        appState,
        view: baseView(),
        origin: null,
      }),
    ).toEqual({ mode: "hidden" });
  });

  it("returns unlocalizedBelowUi after skip-connect finish", () => {
    const appState = new AppState();
    appState.finishWizard(false);
    const view = baseView({ hello: helloView() });
    expect(
      deriveRobotMarkerApplyInput({
        appState,
        view,
        origin: null,
      }),
    ).toEqual({
      mode: "unlocalizedBelowUi",
      robot: GO2,
      view,
    });
  });

  it("returns localizedOdom when localized with origin, pose, and hello robot", () => {
    const appState = new AppState();
    appState.finishWizard(true);
    const view = baseView({
      hasTrackingOrigin: true,
      hello: helloView(),
      pose: POSE,
    });
    expect(
      deriveRobotMarkerApplyInput({
        appState,
        view,
        origin: ORIGIN,
      }),
    ).toEqual({
      mode: "localizedOdom",
      robot: GO2,
      pose: POSE,
      origin: ORIGIN,
      view,
    });
  });
});

describe("robotDeadzoneRadiusCm", () => {
  it("uses half the max footprint plus 20 cm, floored at 20", () => {
    expect(robotDeadzoneRadiusCm(GO2)).toBe(55);
    expect(
      robotDeadzoneRadiusCm({
        ...GO2,
        footprint_m: [0.1, 0.1],
      }),
    ).toBe(25);
    expect(
      robotDeadzoneRadiusCm({
        ...GO2,
        footprint_m: [0, 0],
      }),
    ).toBe(20);
  });
});
