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

function setupFixture(policy: "robot_los_required" | "robot_los_preferred" | "any_angle" | null = null) {
  let current = view({ hasTrackingOrigin: false });
  const session = { view: () => current, sendText: vi.fn(), requestState: vi.fn(), requestEstop: vi.fn() };
  const episode = { view: () => ({ phase: "capturing", capturePolicy: policy, lastError: null }), requestStart: vi.fn(), pause: vi.fn() };
  const ui = new WebXRUIPresenter(session as never, episode as never);
  return { ui, episode, session, setView: (next: ARModuleSessionState) => { current = next; } };
}

it("marks connection complete only after hello and identifies the robot and telemetry", () => {
  const f = setupFixture();
  f.setView(view({ connection: "awaiting_hello", hello: null, hasTrackingOrigin: false }));
  expect(f.ui.snapshot().connectComplete).toBe(false);
  f.setView(view({ hasTrackingOrigin: false }));
  expect(f.ui.snapshot().connectComplete).toBe(true);
  expect(f.ui.snapshot().nextLabel).toBe("Continue");
  expect(f.ui.snapshot().robotName).toContain("Go2");
  expect(f.ui.snapshot().wizardCardBody).toContain("WebSocket connected");
});

it.each([
  ["robot_los_required", "marker", "AprilTag", "guide"],
  ["any_angle", "vps", "VPS", "mapped space"],
  ["robot_los_preferred", "mixed", "VPS", "mapped space"],
] as const)("uses provider-appropriate instructions for %s", (policy, kind, description, guidance) => {
  const f = setupFixture(policy); f.ui.nextSetup();
  expect(f.ui.snapshot().localizationKind).toBe(kind);
  expect(f.ui.snapshot().wizardDescription).toContain(description);
  expect(f.ui.snapshot().wizardCardBody).toContain(guidance);
});

it("uses neutral waiting copy before a capture policy arrives and explains unavailable localization", () => {
  const f = setupFixture(); f.ui.nextSetup();
  expect(f.ui.snapshot().localizationKind).toBe("unknown");
  expect(f.ui.snapshot().wizardDescription).not.toContain("AprilTag");
  f.setView(view({ hasTrackingOrigin: false, capabilities: { ...capabilities, localization: { available: false, reason: "off" } } }));
  expect(f.ui.snapshot().localizationKind).toBe("unavailable");
  expect(f.ui.snapshot().wizardCardBody).toContain("Skip");
});

it("celebrates real alignment briefly and never shows a success check for skipped setup", () => {
  const f = setupFixture(); f.ui.tick(10); f.setView(view()); f.ui.completeSetup();
  expect(f.ui.snapshot().setupCelebrating).toBe(true);
  f.ui.tick(100); expect(f.ui.snapshot().setupCelebrating).toBe(true);
  expect(f.ui.snapshot().setupSuccessProgress).toBeLessThan(0.2);
  for (let i = 1; i <= 16; i++) f.ui.tick(100 + i / 10);
  expect(f.ui.snapshot().setupCelebrating).toBe(false);
  expect(f.ui.menuOpen).toBe(false);
  const skipped = setupFixture(); skipped.ui.nextSetup(); skipped.ui.nextSetup();
  expect(skipped.ui.setupCompleted).toBe(true);
  expect(skipped.ui.snapshot().setupCelebrating).toBe(false);
});

it("closes the UI when dismissing the localization review without clearing alignment", () => {
  const f = setupFixture(); f.setView(view()); f.ui.setupCompleted = true;
  f.ui.requestAlignmentReview("Tracking resumed"); expect(f.ui.menuOpen).toBe(true);
  f.ui.dismissAlignmentReview();
  expect(f.ui.menuOpen).toBe(false); expect(f.ui.alignmentReview?.pending).toBe(false);
  expect(f.ui.snapshot().hasTrackingOrigin).toBe(true); expect(f.ui.setupCompleted).toBe(true);
});
