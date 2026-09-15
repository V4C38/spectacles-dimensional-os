import { describe, expect, it, vi } from "vitest";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Capabilities, Hello } from "@dimos-ar-client/websocket/protocolTypes";
import {
  FLASH_DURATION_S,
  isLiveNavGoal,
  isNavGoalCancelVisible,
  shouldBeginFailedFlash,
  WebXRNavigationController,
} from "../src/navigation/WebXRNavigationController";

const capabilities: Capabilities = {
  lidar: { available: true, reason: null },
  localization: { available: true, reason: null },
  estop: { available: true, reason: null },
  agent: { available: false, reason: "off" },
  navigation: {
    available: true,
    reason: null,
    nav_goal: { available: true, reason: null },
    nav_joystick: { available: false, reason: "off" },
  },
};

const hello: Hello = {
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
};

function view(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
  return {
    connection: "ready",
    hasTrackingOrigin: true,
    hello,
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

describe("WebXRNavigationController", () => {
  it("derives live-goal and cancel visibility", () => {
    expect(isLiveNavGoal({ activated: false, hasSentGoal: false, hasReceivedPose: false, followingPath: false })).toBe(
      false,
    );
    expect(isLiveNavGoal({ activated: true, hasSentGoal: false, hasReceivedPose: false, followingPath: false })).toBe(
      true,
    );
    expect(
      isNavGoalCancelVisible({
        flashing: true,
        dragging: false,
        activated: true,
        hasSentGoal: true,
        hasReceivedPose: false,
        followingPath: false,
      }),
    ).toBe(false);
  });

  it("starts a failed flash from nav facts and hides the route", () => {
    expect(
      shouldBeginFailedFlash({ state: "following_path", outcome: null }, { state: "resolved", outcome: "failed" }, true),
    ).toBe(true);
    const sendText = vi.fn();
    const session = {
      view: () => view(),
      sendText,
      requestEstop: vi.fn(),
    };
    const navigation = new WebXRNavigationController(session as never);
    const origin = {
      position: [0, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
      confidence: 1,
      ts: 0,
    };
    const floor = {
      position: [0, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
    };
    navigation.applyView(view(), origin, floor, 1);
    const hit = { position: [0, 0, -2] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };
    navigation.hold(1, [0, 1.5, 0], [0, -1, -1], [hit], null, 0);
    navigation.applyView(view({ nav: { state: "following_path", outcome: null } }), origin, floor, 2);
    navigation.applyView(view({ nav: { state: "resolved", outcome: "failed" } }), origin, floor, 3);
    expect(navigation.flash()).toBe("failed");
    expect(navigation.isRouteVisible()).toBe(false);
    navigation.tick(3 + FLASH_DURATION_S);
    expect(navigation.flash()).toBeNull();
    expect(navigation.isRouteVisible()).toBe(true);
    navigation.dispose();
  });

  it("gates hold without nav_goal capability", () => {
    const session = {
      view: () =>
        view({
          capabilities: {
            ...capabilities,
            navigation: {
              available: true,
              reason: null,
              nav_goal: { available: false, reason: "off" },
              nav_joystick: { available: false, reason: "off" },
            },
          },
        }),
      sendText: vi.fn(),
      requestEstop: vi.fn(),
    };
    const navigation = new WebXRNavigationController(session as never);
    navigation.applyView(session.view(), null, null, 0);
    expect(
      navigation.hold(1, [0, 1.5, 0], [0, -1, 0], [{ position: [0, 0, -1], normal: [0, 1, 0] }], null, 0),
    ).toBe(false);
    navigation.dispose();
  });

  it("moves the marker along a floor ray hit while holding", () => {
    const sendText = vi.fn();
    const session = {
      view: () => view(),
      sendText,
      requestEstop: vi.fn(),
    };
    const navigation = new WebXRNavigationController(session as never);
    const origin = {
      position: [0, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
      confidence: 1,
      ts: 0,
    };
    navigation.applyView(
      view(),
      origin,
      { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      1,
    );
    const hit = { position: [0, 0, -2] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };
    navigation.hold(1, [0, 1.5, 0], [0, -1, -1], [hit], null, 0);
    navigation.hold(2, [0, 1.5, 0], [0, -1, -1], [hit], null, 0);
    expect(navigation.isDragging()).toBe(true);
    navigation.release(2.5, [0, 1.5, 0], [0, -1, -1], [hit], null, 0);
    expect(navigation.isDragging()).toBe(false);
    expect(sendText).toHaveBeenCalled();
    navigation.dispose();
  });
});
