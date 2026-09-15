import { describe, expect, it } from "vitest";
import {
  deriveRobotMarkerApplyInput,
  getRobotActivityState,
  robotTitleText,
} from "../src/presentation/robotPresentation";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Capabilities } from "@dimos-ar-client/websocket/protocolTypes";
import { WebXRRobotPresenter } from "../src/presentation/WebXRPresenters";

const capabilities: Capabilities = {
  lidar: { available: true, reason: null },
  localization: { available: true, reason: null },
  estop: { available: true, reason: null },
  agent: { available: true, reason: null },
  navigation: {
    available: true,
    reason: null,
    nav_goal: { available: true, reason: null },
    nav_joystick: { available: true, reason: null },
  },
};

function view(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
  return {
    connection: "ready",
    hasTrackingOrigin: false,
    hello: {
      type: "hello",
      client_id: "c",
      time_sync: { ts_client: 0, ts_server: 0 },
      robot: {
        display_name: "Go2",
        body_bounds_m: [0.7, 0.5, 0.55],
        footprint_m: [0.7, 0.3],
        base_height_m: 0.33,
      },
      capabilities,
    },
    state: null,
    pose: null,
    nav_goal: null,
    lidar: null,
    capabilities,
    nav: null,
    agentMessage: null,
    lastError: null,
    ...overrides,
  };
}

describe("robot presentation", () => {
  it("keeps an unlocalized fallback after setup and uses base_height_m for the floor", () => {
    expect(deriveRobotMarkerApplyInput({ setupCompleted: false, view: view(), origin: null }).mode).toBe(
      "hidden",
    );
    expect(deriveRobotMarkerApplyInput({ setupCompleted: true, view: view(), origin: null }).mode).toBe(
      "unlocalizedFallbackPosition",
    );
    expect(getRobotActivityState(view({ nav: { state: "following_path", outcome: null } }))).toBe(
      "Following Path",
    );
    expect(robotTitleText(view({ connection: "disconnected" }))).toContain("Disconnected");
    const robot = new WebXRRobotPresenter();
    const origin = {
      position: [0, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
      confidence: 1,
      ts: 0,
    };
    robot.apply(
      view({
        hasTrackingOrigin: true,
        pose: { type: "pose", position: [0, 0, 0], orientation: [0, 0, 0, 1], ts: 0 },
      }),
      origin,
      true,
      null,
    );
    const floor = robot.floorPose();
    expect(floor).not.toBeNull();
    const dx = floor!.position[0] - robot.object.position.x;
    const dy = floor!.position[1] - robot.object.position.y;
    const dz = floor!.position[2] - robot.object.position.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(0.33);
    expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dx));
    expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dz));
    robot.dispose();
  });
});
