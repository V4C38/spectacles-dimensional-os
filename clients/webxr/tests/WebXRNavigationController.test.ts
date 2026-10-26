import { describe, expect, it, vi } from "vitest";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Capabilities, Hello } from "@dimos-ar-client/websocket/protocolTypes";
import {
  FLASH_DURATION_S,
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
    navigation.tick(3 + FLASH_DURATION_S, FLASH_DURATION_S);
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

  it("previews a floor gesture and sends only after a second complete gesture", () => {
    const sendText = vi.fn();
    const navigation = new WebXRNavigationController({ view: () => view(), sendText, requestEstop: vi.fn() } as never);
    const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
    navigation.applyView(view(), origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 1);
    navigation.setSelected(true);
    const hit = (z: number) => [{ position: [0, 0, z] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
    for (let i = 0; i < 30; i++) navigation.hold(1 + i * 0.1, [0, 1.5, 0], [0, -1, -1], hit(-1 - i * 0.1), null, 0, false);
    expect(navigation.isAiming()).toBe(true);
    expect(navigation.draftMarker.object.visible).toBe(true);
    expect(navigation.marker.pose().position[2]).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
    navigation.release(4, [0, 1.5, 0], [0, -1, -1], hit(-4), null, 0);
    expect(sendText).not.toHaveBeenCalled();
    expect(navigation.isAiming()).toBe(true);
    navigation.hold(4.1, [0, 1.5, 0], [0, -1, -1], hit(-4), null, 0, false);
    navigation.release(4.2, [0, 1.5, 0], [0, -1, -1], hit(-4), null, 0);
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText.mock.calls[0][0]).toContain("nav_goal_request");
    navigation.dispose();
  });

  it("smooths the dragged heading so it turns over several centimetres of travel", () => {
    const sendText = vi.fn();
    const navigation = new WebXRNavigationController({ view: () => view(), sendText, requestEstop: vi.fn() } as never);
    const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
    navigation.applyView(view(), origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 1);
    const floorHit = (x: number) => [{ position: [x, 0, -0.5] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
    const yaw = () => {
      const [, y, , w] = navigation.marker.pose().orientation;
      return 2 * Math.atan2(y, w);
    };
    navigation.hold(1, [0, 1.5, 0], [0, -1, -1], floorHit(0), null, 0);
    expect(navigation.isDragging()).toBe(true);
    expect(yaw()).toBeCloseTo(0);
    navigation.hold(1 + 1 / 60, [0, 1.5, 0], [0, -1, -1], floorHit(0.05), null, 0);
    expect(yaw()).toBeLessThan(0);
    expect(yaw()).toBeGreaterThan(-Math.PI / 4);
    for (let i = 2; i < 60; i++) {
      // The host reapplies this unchanged selection state every XR frame.
      navigation.setSelected(false);
      navigation.hold(1 + i / 60, [0, 1.5, 0], [0, -1, -1], floorHit(0.05 * i), null, 0);
      expect(navigation.isDragging()).toBe(true);
    }
    expect(yaw()).toBeCloseTo(-Math.PI / 2, 2);
    navigation.dispose();
  });
});

function fixture(previewSupported = false) {
  const current = view({ capabilities: { ...capabilities, navigation: { ...capabilities.navigation, nav_goal: { available: true, reason: null, preview: previewSupported } } } });
  const sendText = vi.fn();
  const navigation = new WebXRNavigationController({ view: () => current, sendText, requestEstop: vi.fn() } as never);
  const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  const floor = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] };
  navigation.applyView(current, origin, floor, 0);
  const hit = (x = 1, z = -2) => [{ position: [x, 0, z] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
  const aim = (now: number, x = 1, z = -2) => navigation.aim(now, [0, 1.5, 0], [0, -1, -1], hit(x, z), null, 0);
  const hold = (now: number, x = 1, z = -2) => navigation.hold(now, [0, 1.5, 0], [0, -1, -1], hit(x, z), null, 0, false);
  const release = (now: number, x = 1, z = -2) => navigation.release(now, [0, 1.5, 0], [0, -1, -1], hit(x, z), null, 0);
  const preview = (now = 0, x = 1, z = -2) => { aim(now, x, z); hold(now, x, z); release(now, x, z); };
  return { current, sendText, navigation, origin, floor, aim, hold, release, preview };
}

it("rejects unselected floor clicks and confirms a stationary selected click with its previous heading", () => {
  const f = fixture();
  f.hold(0); f.release(0.1);
  expect(f.sendText).not.toHaveBeenCalled();
  f.navigation.setSelected(true);
  f.aim(0.2);
  const heading = f.navigation.marker.pose().orientation;
  f.hold(0.3); f.release(0.4);
  expect(f.sendText).not.toHaveBeenCalled();
  expect(f.navigation.isAiming()).toBe(true);
  f.hold(0.5); f.release(0.6);
  expect(f.sendText).toHaveBeenCalledOnce();
  expect(f.navigation.marker.pose()).toEqual({ position: [1, 0, -2], orientation: heading });
  expect(JSON.parse(f.sendText.mock.calls[0][0]).preview).toBeUndefined();
  f.navigation.dispose();
});

it("turns during idle aim and freezes the displayed heading on press", () => {
  const f = fixture(); f.navigation.setSelected(true);
  f.preview(0); f.aim(0.5, 2); f.aim(1, 3);
  const heading = f.navigation.draftMarker.pose().orientation;
  f.hold(1.1, 3); f.hold(1.2, 2);
  expect(f.navigation.draftMarker.pose().position).toEqual([3, 0, -2]);
  expect(f.navigation.draftMarker.pose().orientation).toEqual(heading);
  expect(f.navigation.draftMarker.pose().orientation[1]).toBeLessThan(-0.5);
  expect(f.sendText).not.toHaveBeenCalled();
  f.release(1.1, 3);
  expect(f.sendText).toHaveBeenCalledOnce();
  f.navigation.dispose();
});

it("restores the newest authoritative pose on aim loss and cancels unfinished gestures on deselection", () => {
  const f = fixture(); f.navigation.setSelected(true);
  f.preview(0);
  expect(f.navigation.draftMarker.pose().position).toEqual([1, 0, -2]);
  f.current.nav_goal = { type: "nav_goal", pose: [5, 3, 0, 0.7], path_poses: [[5, 3, 0, 0.7]], ts: 1 };
  f.navigation.applyView(f.current, f.origin, f.floor, 0.1);
  expect(f.navigation.draftMarker.pose().position).toEqual([1, 0, -2]);
  f.navigation.clearAim();
  expect(f.navigation.marker.pose().position).toEqual([-3, 0, -5]);
  f.hold(0.2); f.navigation.setSelected(false); f.release(0.3);
  expect(f.sendText).not.toHaveBeenCalled();
  f.navigation.dispose();
});

it("keeps idle-marker opacity tied to selection, fades the aim and restores the robot floor", () => {
  const f = fixture();
  const ring = f.navigation.marker.object.getObjectByName("NavigationCircle") as import("three").Mesh<import("three").BufferGeometry, import("three").MeshBasicMaterial>;
  expect(ring.material.opacity).toBe(0.35);
  f.navigation.setSelected(true); f.navigation.tick(0); f.preview(0.1); f.navigation.tick(0.15, 1);
  expect(ring.material.opacity).toBeCloseTo(0.6);
  expect(ring.parent!.scale.x).toBeCloseTo(1.15);
  expect(f.navigation.draftMarker.circleOpacity()).toBeCloseTo(ring.material.opacity);
  f.navigation.clearAim(); f.navigation.tick(0.3, 1);
  expect(f.navigation.marker.pose().position).toEqual([0, 0, 0]);
  expect(ring.material.opacity).toBeCloseTo(0.6);
  f.navigation.dispose();
});

it("gates previews on advertised support and permits confirmation without a path", () => {
  const f = fixture(); f.navigation.setSelected(true); f.aim(1); f.navigation.tick(2);
  expect(f.sendText).not.toHaveBeenCalled();
  f.hold(3); f.release(4);
  f.hold(5); f.release(6);
  expect(f.sendText).toHaveBeenCalledOnce(); f.navigation.dispose();
});

it("serializes preview requests, retains the latest aim and rejects obsolete replies", () => {
  const f = fixture(true); f.navigation.setSelected(true);
  f.preview(0); f.aim(0.1, 2); f.aim(0.2, 3); f.navigation.tick(1);
  expect(f.sendText).toHaveBeenCalledOnce();
  expect(JSON.parse(f.sendText.mock.calls[0][0]).preview).toBe(true);
  f.current.nav_preview = { type: "nav_goal", preview: true, preview_id: JSON.parse(f.sendText.mock.calls.at(-1)![0]).preview_id, pose: [1, 2, 0, 0], path_poses: [[0, 0, 0, 0], [1, 2, 0, 0]], ts: 1 };
  f.navigation.applyView(f.current, f.origin, f.floor, 1);
  expect(f.navigation.previewPath()).toBeNull();
  f.navigation.tick(1.1);
  expect(f.sendText).toHaveBeenCalledTimes(2);
  f.current.nav_preview = { ...f.current.nav_preview, preview_id: JSON.parse(f.sendText.mock.calls.at(-1)![0]).preview_id, ts: 2 };
  f.navigation.applyView(f.current, f.origin, f.floor, 1.2);
  expect(f.navigation.previewPath()).toHaveLength(2);
  f.navigation.clearAim();
  expect(f.navigation.previewPath()).toBeNull();
  f.navigation.dispose();
});

it("invalidates previews across aim episodes and refreshes on a new costmap", () => {
  const f = fixture(true); f.navigation.setSelected(true); f.preview(0);
  f.navigation.clearAim(); f.preview(0.5);
  f.current.nav_preview = { type: "nav_goal", preview: true, preview_id: JSON.parse(f.sendText.mock.calls.at(-1)![0]).preview_id, pose: null, path_poses: [], ts: 1 };
  f.navigation.applyView(f.current, f.origin, f.floor, 0.6);
  expect(f.navigation.previewPath()).toBeNull();
  f.navigation.tick(0.7);
  expect(f.sendText).toHaveBeenCalledTimes(2);
  f.current.nav_preview = { ...f.current.nav_preview, preview_id: JSON.parse(f.sendText.mock.calls.at(-1)![0]).preview_id, ts: 2 };
  f.navigation.applyView(f.current, f.origin, f.floor, 0.8);
  expect(f.navigation.previewPath()).toEqual([]);
  f.current.state = { type: "state", nav_preview_costmap_ts: 10, server: { connected_clients: 1 }, lidar: { enabled: false, min_height_m: 0, max_height_m: 1, max_range_m: 5 }, nav: { state: "idle", outcome: null }, agent: { idle: true } };
  f.navigation.applyView(f.current, f.origin, f.floor, 1);
  f.navigation.tick(1.1);
  expect(f.sendText).toHaveBeenCalledTimes(3);
  f.navigation.dispose();
});


it("throttles small aim drift and refreshes after a material heading change", () => {
  const f = fixture(true); f.navigation.setSelected(true); f.preview(0);
  f.current.nav_preview = { type: "nav_goal", preview: true, preview_id: JSON.parse(f.sendText.mock.calls.at(-1)![0]).preview_id, pose: null, path_poses: [], ts: 1 };
  f.navigation.applyView(f.current, f.origin, f.floor, 0.1);
  f.aim(0.2, 1.01); f.navigation.tick(0.4);
  expect(f.sendText).toHaveBeenCalledOnce();
  f.aim(0.5, 1.1); f.aim(1, 1.15);
  f.navigation.tick(1.1);
  expect(f.sendText).toHaveBeenCalledTimes(2);
  f.navigation.dispose();
});

it("limits selected floor aiming and confirmation to five ray meters without limiting direct marker drags", () => {
  const f = fixture(); f.navigation.setSelected(true);
  const from: [number, number, number] = [0, 1, 0];
  const dir: [number, number, number] = [0, -1, -1];
  const hits = (distance: number) => [{ position: [0, 0, -Math.sqrt(distance * distance - 1)] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
  f.navigation.aim(0, from, dir, hits(4.99), null, 0); expect((f.navigation.probes.get("default")?.probe.visible ?? false)).toBe(true);
  f.navigation.aim(1, from, dir, hits(5.01), null, 0); expect(f.navigation.isAiming()).toBe(false);
  expect(f.navigation.hold(2, from, dir, hits(5.01), null, 0, false)).toBe(false);
  f.navigation.release(2.1, from, dir, hits(5.01), null, 0); expect(f.sendText).not.toHaveBeenCalled();
  f.navigation.setSelected(false);
  f.navigation.hold(3, from, dir, hits(6), null, 0, true);
  f.navigation.hold(4, from, dir, hits(7), null, 0, true);
  expect(f.sendText).toHaveBeenCalled(); f.navigation.dispose();
});

it("keeps cancel visible on a following goal while selected floor aim shows only the probe", () => {
  const f = fixture();
  f.current.nav_goal = { type: "nav_goal", ts: 1, pose: [2, 0, 0, 0], path_poses: [[0, 0, 0, 0], [2, 0, 0, 0]] };
  f.current.nav = { state: "following_path", outcome: null };
  f.navigation.applyView(f.current, f.origin, f.floor, 1);
  f.navigation.setSelected(true);
  const goal = f.navigation.marker.pose();
  for (let i = 0; i < 5; i++) {
    f.aim(2 + i / 10, 1 + i / 10);
    f.navigation.applyView(f.current, f.origin, f.floor, 2 + i / 10);
    expect(f.navigation.marker.cancelVisible()).toBe(true);
    expect(f.navigation.marker.pose()).toEqual(goal);
  }
  f.hold(3); f.release(3.1);
  expect(f.navigation.isAiming()).toBe(true);
  expect(f.navigation.marker.cancelVisible()).toBe(true);
  expect(f.navigation.draftMarker.cancelVisible()).toBe(false);
  f.navigation.clearAim();
  expect(f.navigation.marker.cancelVisible()).toBe(true);
  f.navigation.dispose();
});

it("renders two independent probes and separate active and draft markers at identical opacity", () => {
  const f = fixture(); f.navigation.setSelected(true);
  const aim = (id: string, x: number) => f.navigation.aim(1, [0, 1, 0], [0, -1, -1], [{ position: [x, 0, -2], normal: [0, 1, 0] }], null, 0, id);
  aim("left", 1); aim("right", 2);
  expect(f.navigation.probes.size).toBe(2);
  f.current.nav_goal = { type: "nav_goal", ts: 1, pose: [3, 0, 0, 0], path_poses: [[0, 0, 0, 0], [3, 0, 0, 0]] };
  f.current.nav = { state: "following_path", outcome: null }; f.navigation.applyView(f.current, f.origin, f.floor, 1);
  f.navigation.hold(2, [0, 1, 0], [0, -1, -1], [{ position: [1, 0, -2], normal: [0, 1, 0] }], null, 0, false, "left");
  f.navigation.release(2.1, [0, 1, 0], [0, -1, -1], [{ position: [1, 0, -2], normal: [0, 1, 0] }], null, 0, "left");
  f.navigation.tick(2.2, 1);
  expect(f.navigation.marker.pose().position).toEqual([0, 0, -3]);
  expect(f.navigation.draftMarker.pose().position).toEqual([1, 0, -2]);
  expect(f.navigation.marker.cancelVisible()).toBe(true);
  expect(f.navigation.draftMarker.circleOpacity()).toBe(f.navigation.marker.circleOpacity());
  expect(f.navigation.probes.get("right")?.circleOpacity()).toBe(f.navigation.marker.circleOpacity());
  expect(f.sendText).not.toHaveBeenCalled(); f.navigation.dispose();
});
