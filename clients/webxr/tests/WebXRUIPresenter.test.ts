import { describe, expect, it, vi } from "vitest";
import { LIDAR_PRESETS } from "@dimos-ar-client/sensors/lidarSettings";
import { WebXRUIPresenter } from "../src/presentation/WebXRUIPresenter";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Capabilities } from "@dimos-ar-client/websocket/protocolTypes";

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

function view(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
  return {
    connection: "ready",
    hasTrackingOrigin: true,
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
    state: {
      type: "state",
      server: { connected_clients: 1 },
      lidar: LIDAR_PRESETS.obstacles,
      nav: { state: "idle", outcome: null },
      agent: { idle: true },
    },
    pose: { type: "pose", position: [0, 0, 0], orientation: [0, 0, 0, 1], ts: 0 },
    nav_goal: null,
    lidar: null,
    capabilities,
    nav: null,
    agentMessage: null,
    lastError: null,
    ...overrides,
  };
}

describe("WebXRUIPresenter", () => {
  it("blocks setup without localization", () => {
    const session = {
      view: () => view(),
      sendText: vi.fn(),
      requestState: vi.fn(),
      requestEstop: vi.fn(),
    };
    const episode = {
      view: () => ({ phase: "idle", lastError: null }),
      requestStart: vi.fn(),
      reset: vi.fn(),
    };
    const localized = new WebXRUIPresenter(session as never, episode as never);
    expect(() => localized.completeSetup()).not.toThrow();
    const blocked = new WebXRUIPresenter(
      { ...session, view: () => view({ hasTrackingOrigin: false }) } as never,
      episode as never,
    );
    expect(() => blocked.completeSetup()).toThrow();
  });
});
