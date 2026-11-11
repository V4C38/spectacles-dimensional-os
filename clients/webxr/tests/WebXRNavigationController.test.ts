import { immediateAuthority } from "../../specs/Tests/fixtures/ImmediateAuthority";
import { describe, expect, it, vi } from "vitest";
import { NAV_FEEDBACK_ANIMATION_S, NAV_FEEDBACK_TIMING } from "@dimos-ar-client/navigation/NavigationGoalLifecycle";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Capabilities, Hello, NavGoal, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import {
  FLASH_DURATION_S,
  WebXRNavigationController,
} from "../src/navigation/WebXRNavigationController";

const capabilities: Capabilities = {
  manipulation: { available: false, reason: "No arm" },
  object_detection: { available: false, reason: "No detector" },
  lidar: { available: true, reason: null },
  localization: { available: true, reason: null },
  estop: { available: true, reason: null },
  agent: { available: false, reason: "off" },
  navigation: {
    available: true,
    reason: null,
    nav_goal: { preview: false, available: true, reason: null },
    nav_joystick: { available: false, reason: "off" },
  },
};

const hello: Hello = {
  resume_token: "fixture-resume",
  odom_reference_id: "fixture-odom",
  localization: { providers: ["fiducial_marker"] },
  type: "hello", protocol_version: 2, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch",
  client_id: "c",
  time_sync: { ts_client: 0, ts_server: 0 },
  robot: {
    odom_scale_correction_factor: 1,
    display_name: "Go2",
    body_bounds_m: [0.7, 0.5, 0.55],
    footprint_m: [0.7, 0.3],
    base_height_m: 0.33,
  },
  capabilities,
};

type MutableFacts<T> = T extends readonly unknown[] ? T : T extends object ? { -readonly [K in keyof T]: MutableFacts<T[K]> } : T;
function view(overrides: Partial<ARModuleSessionState> = {}): MutableFacts<ARModuleSessionState> {
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
    agentMessageRevision: 0,
    lastError: null,
    ...overrides,
  };
}

describe("WebXRNavigationController", () => {
  it("starts a failed flash from nav facts and hides the route", () => {
    const sendText = vi.fn();
    const session = {
      collaboration: immediateAuthority().collaboration,
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
    navigation.hold(1, [0, 1.5, 0], [0, -1, -1], [hit], 0);
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
      collaboration: immediateAuthority().collaboration,
      view: () =>
        view({
          capabilities: {
            ...capabilities,
            navigation: {
              available: true,
              reason: null,
              nav_goal: { preview: false, available: false, reason: "off" },
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
      navigation.hold(1, [0, 1.5, 0], [0, -1, 0], [{ position: [0, 0, -1], normal: [0, 1, 0] }], 0),
    ).toBe(false);
    navigation.dispose();
  });

  it("moves the marker along a floor ray hit while holding", () => {
    const sendText = vi.fn();
    const session = {
      collaboration: immediateAuthority().collaboration,
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
    navigation.hold(1, [0, 1.5, 0], [0, -1, -1], [hit], 0);
    navigation.hold(2, [0, 1.5, 0], [0, -1, -1], [hit], 0);
    expect(navigation.isDragging()).toBe(true);
    navigation.release(2.5, [0, 1.5, 0], [0, -1, -1], [hit], 0);
    expect(navigation.isDragging()).toBe(false);
    expect(sendText).toHaveBeenCalled();
    navigation.dispose();
  });

  it("previews a floor gesture and sends only after a second complete gesture", () => {
    const sendText = vi.fn();
    const commits = vi.fn();
    const authority = immediateAuthority({ onCommit: commits });
    const navigation = new WebXRNavigationController({ collaboration: authority.collaboration, view: () => view(), sendText, requestEstop: vi.fn() } as never);
    const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
    navigation.applyView(view(), origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 1);
    navigation.setSelected(true);
    const hit = (z: number) => [{ position: [0, 0, z] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
    for (let i = 0; i < 30; i++) navigation.hold(1 + i * 0.1, [0, 1.5, 0], [0, -1, -1], hit(-1 - i * 0.1), 0, false);
    expect(navigation.isAiming()).toBe(true);
    expect(navigation.draftMarker.object.visible).toBe(true);
    expect(navigation.marker.pose().position[2]).toBe(0);
    expect(commits).not.toHaveBeenCalled();
    navigation.release(4, [0, 1.5, 0], [0, -1, -1], hit(-4), 0);
    expect(commits).not.toHaveBeenCalled();
    expect(navigation.isAiming()).toBe(true);
    navigation.tick(4.01, 1);
    expect(navigation.draftMarker.circleBounds().radius).toBeCloseTo(navigation.marker.circleBounds().radius);
    expect(navigation.draftMarker.object.getObjectByName("Navigation draft circle")!.visible).toBe(true);
    navigation.hold(4.1, [0, 1.5, 0], [0, -1, -1], hit(-4), 0, false);
    navigation.release(4.2, [0, 1.5, 0], [0, -1, -1], hit(-4), 0);
    expect(commits).toHaveBeenCalledOnce();
    expect(authority.commands.at(-1)).toMatchObject({ action: "confirm" });
    navigation.dispose();
  });

  it("smooths the dragged heading so it turns over several centimetres of travel", () => {
    const sendText = vi.fn();
    const navigation = new WebXRNavigationController({ collaboration: immediateAuthority().collaboration, view: () => view(), sendText, requestEstop: vi.fn() } as never);
    const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
    navigation.applyView(view(), origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 1);
    const floorHit = (x: number) => [{ position: [x, 0, -0.5] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
    const yaw = () => {
      const [, y, , w] = navigation.marker.pose().orientation;
      return 2 * Math.atan2(y, w);
    };
    navigation.hold(1, [0, 1.5, 0], [0, -1, -1], floorHit(0), 0);
    expect(navigation.isDragging()).toBe(true);
    expect(yaw()).toBeCloseTo(0);
    navigation.hold(1 + 1 / 60, [0, 1.5, 0], [0, -1, -1], floorHit(0.05), 0);
    expect(yaw()).toBeLessThan(0);
    expect(yaw()).toBeGreaterThan(-Math.PI / 4);
    for (let i = 2; i < 60; i++) {
      // The host reapplies this unchanged selection state every XR frame.
      navigation.setSelected(false);
      navigation.hold(1 + i / 60, [0, 1.5, 0], [0, -1, -1], floorHit(0.05 * i), 0);
      expect(navigation.isDragging()).toBe(true);
    }
    expect(yaw()).toBeCloseTo(-Math.PI / 2, 2);
    navigation.dispose();
  });
});

function fixture(previewSupported = false) {
  const current = view({ capabilities: { ...capabilities, navigation: { ...capabilities.navigation, nav_goal: { available: true, reason: null, preview: previewSupported } } } });
  const sendText = vi.fn();
  const commits = vi.fn();
  const authority = immediateAuthority({ onCommit: commits });
  const navigation = new WebXRNavigationController({ collaboration: authority.collaboration, view: () => current, sendText, requestEstop: vi.fn() } as never);
  const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  const floor = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] };
  navigation.applyView(current, origin, floor, 0);
  const hit = (x = 1, z = -2) => [{ position: [x, 0, z] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
  const aim = (now: number, x = 1, z = -2) => navigation.aim(now, [0, 1.5, 0], [0, -1, -1], hit(x, z), 0);
  const hold = (now: number, x = 1, z = -2) => navigation.hold(now, [0, 1.5, 0], [0, -1, -1], hit(x, z), 0, false);
  const release = (now: number, x = 1, z = -2) => navigation.release(now, [0, 1.5, 0], [0, -1, -1], hit(x, z), 0);
  const preview = (now = 0, x = 1, z = -2) => { aim(now, x, z); hold(now, x, z); release(now, x, z); };
  return { current, sendText, commits, authority, navigation, origin, floor, aim, hold, release, preview };
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
  expect(f.commits).toHaveBeenCalledOnce();
  expect(f.navigation.marker.pose()).toEqual({ position: [1, 0, -2], orientation: heading });
  expect(f.authority.commands.at(-1)).toMatchObject({ action: "confirm" });
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
  expect(f.commits).toHaveBeenCalledOnce();
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
  expect(f.commits).toHaveBeenCalledOnce(); f.navigation.dispose();
});

it("renders canonical server previews and rejects obsolete collaboration revisions", () => {
  const f = fixture(true); f.navigation.setSelected(true); f.preview(0);
  const path: YawPose[] = [[0, 0, 0, 0], [2, -1, 0, 0]];
  const frame: NavGoal = { type: "nav_goal", preview: true,
    preview_id: JSON.parse(f.sendText.mock.lastCall![0]).preview_id,
    pose: [2, -1, 0, 0], path_poses: path, ts: 1 };
  f.authority.state.preview = frame; f.authority.publish();
  expect(f.navigation.previewPath()).toEqual(path);
  const obsolete = { ...f.authority.state, preview: frame };
  f.navigation.clearAim();
  f.authority.state.preview = null; f.authority.publish();
  expect(f.navigation.previewPath()).toBeNull();
  expect(f.authority.collaboration.apply(obsolete)).toBe(false);
  expect(f.navigation.previewPath()).toBeNull();
  expect(f.commits).not.toHaveBeenCalled();
  f.navigation.dispose();
});

it("refreshes canonical preview requests on a new costmap without confirming movement", () => {
  const f = fixture(true); f.navigation.setSelected(true); f.preview(0);
  const frame: NavGoal = { type: "nav_goal", preview: true,
    preview_id: JSON.parse(f.sendText.mock.lastCall![0]).preview_id,
    pose: [2, -1, 0, 0], path_poses: [], ts: 1 };
  f.current.nav_preview = frame; f.authority.state.preview = frame; f.authority.publish();
  f.navigation.applyView(f.current, f.origin, f.floor, .1);
  expect(f.navigation.previewPath()).toEqual([]);
  const before = f.sendText.mock.calls.length;
  f.current.state = { type: "state", nav_preview_costmap_ts: 10, server: { connected_clients: 1 }, lidar: { enabled: false, min_height_m: 0, max_height_m: 1, max_range_m: 5 }, nav: { state: "idle", outcome: null }, agent: { idle: true } };
  f.navigation.applyView(f.current, f.origin, f.floor, 1);
  f.navigation.tick(1.1);
  expect(f.sendText).toHaveBeenCalledTimes(before + 1);
  expect(JSON.parse(f.sendText.mock.lastCall![0]).preview).toBe(true);
  expect(f.commits).not.toHaveBeenCalled();
  f.navigation.dispose();
});

it("predicts local aim while retaining only the canonical route until the server changes it", () => {
  const f = fixture(true); f.navigation.setSelected(true); f.preview(0);
  const path: YawPose[] = [[0, 0, 0, 0], [2, -1, 0, 0]];
  const frame: NavGoal = { type: "nav_goal", preview: true,
    preview_id: JSON.parse(f.sendText.mock.lastCall![0]).preview_id,
    pose: [2, -1, 0, 0], path_poses: path, ts: 1 };
  f.current.nav_preview = frame; f.authority.state.preview = frame; f.authority.publish();
  f.navigation.applyView(f.current, f.origin, f.floor, .1);
  f.aim(.2, 1.01); f.navigation.tick(.4);
  expect(f.navigation.draftMarker.pose().position).toEqual([1.01, 0, -2]);
  expect(f.navigation.previewPath()).toEqual(path);
  expect(f.commits).not.toHaveBeenCalled();
  f.navigation.dispose();
});

it("limits selected floor aiming and confirmation to five ray meters without limiting direct marker drags", () => {
  const f = fixture(); f.navigation.setSelected(true);
  const from: [number, number, number] = [0, 1, 0];
  const dir: [number, number, number] = [0, -1, -1];
  const hits = (distance: number) => [{ position: [0, 0, -Math.sqrt(distance * distance - 1)] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
  f.navigation.aim(0, from, dir, hits(4.99), 0); expect((f.navigation.probes.get("default")?.probe.visible ?? false)).toBe(true);
  f.navigation.aim(1, from, dir, hits(5.01), 0); expect(f.navigation.isAiming()).toBe(false);
  expect(f.navigation.hold(2, from, dir, hits(5.01), 0, false)).toBe(false);
  f.navigation.release(2.1, from, dir, hits(5.01), 0); expect(f.sendText).not.toHaveBeenCalled();
  f.navigation.setSelected(false);
  f.navigation.hold(3, from, dir, hits(6), 0, true);
  f.navigation.hold(4, from, dir, hits(7), 0, true);
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
  const aim = (id: string, x: number) => f.navigation.aim(1, [0, 1, 0], [0, -1, -1], [{ position: [x, 0, -2], normal: [0, 1, 0] }], 0, id);
  aim("left", 1); aim("right", 2);
  expect(f.navigation.probes.size).toBe(2);
  f.current.nav_goal = { type: "nav_goal", ts: 1, pose: [3, 0, 0, 0], path_poses: [[0, 0, 0, 0], [3, 0, 0, 0]] };
  f.current.nav = { state: "following_path", outcome: null }; f.navigation.applyView(f.current, f.origin, f.floor, 1);
  f.navigation.hold(2, [0, 1, 0], [0, -1, -1], [{ position: [1, 0, -2], normal: [0, 1, 0] }], 0, false, "left");
  f.navigation.release(2.1, [0, 1, 0], [0, -1, -1], [{ position: [1, 0, -2], normal: [0, 1, 0] }], 0, "left");
  f.navigation.tick(2.2, 1);
  expect(f.navigation.marker.pose().position).toEqual([0, 0, -3]);
  expect(f.navigation.draftMarker.pose().position).toEqual([1, 0, -2]);
  expect(f.navigation.marker.cancelVisible()).toBe(true);
  expect(f.navigation.draftMarker.circleOpacity()).toBe(f.navigation.marker.circleOpacity());
  expect(f.navigation.probes.get("right")?.circleOpacity()).toBe(f.navigation.marker.circleOpacity());
  expect(f.sendText).not.toHaveBeenCalled(); f.navigation.dispose();
});

it("drags a committed selected marker live beyond the floor aim range", () => {
  const f = fixture(); f.navigation.setSelected(true);
  f.preview(0); f.hold(0.2); f.release(0.3);
  f.sendText.mockClear();
  const from: [number, number, number] = [0, 1, 0];
  const dir: [number, number, number] = [0, -1, -1];
  const hits = (x: number) => [{ position: [x, 0, -6] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }];
  f.navigation.hold(1, from, dir, hits(1), 0, true);
  f.navigation.hold(2, from, dir, hits(2), 0, true);
  expect(f.navigation.isDragging()).toBe(true);
  expect(f.navigation.marker.pose().position).toEqual([2, 0, -6]);
  expect(f.navigation.draftMarker.object.visible).toBe(false);
  expect(f.sendText).toHaveBeenCalled();
  f.navigation.release(3, from, dir, hits(3), 0);
  expect(f.navigation.isDragging()).toBe(false);
  expect(f.navigation.marker.pose().position).toEqual([3, 0, -6]);
  expect(JSON.parse(f.sendText.mock.lastCall![0]).preview).toBeUndefined();
  f.navigation.dispose();
});

it.each(["succeeded", "cancelled"] as const)("holds the fully drawn %s marker before restoring the idle arrow", outcome => {
  const f = fixture();
  f.current.nav = { state: "following_path", outcome: null };
  f.current.nav_goal = { type: "nav_goal", ts: 1, pose: [2, 0, 0, 0], path_poses: [[0, 0, 0, 0], [2, 0, 0, 0]] };
  f.navigation.applyView(f.current, f.origin, f.floor, 1);
  if (outcome === "cancelled") f.navigation.cancel(2);
  else {
    f.current.nav = { state: "resolved", outcome };
    f.navigation.applyView(f.current, f.origin, f.floor, 2);
  }
  const ring = f.navigation.marker.object.getObjectByName("Navigation outcome ring") as import("three").Mesh;
  const arrow = f.navigation.marker.object.getObjectByName("NavigationHeading")!;
  const strokes = [0, 1].map(i => f.navigation.marker.object.getObjectByName(`Navigation outcome stroke ${i}`)!);
  f.navigation.tick(3, NAV_FEEDBACK_ANIMATION_S);
  const completedLengths = strokes.map(stroke => stroke.scale.x);
  expect(completedLengths.every(length => length > 0)).toBe(true);
  expect(ring.geometry.drawRange.count).toBe(128 * 6);
  f.navigation.tick(4, NAV_FEEDBACK_TIMING.holdS - 0.01);
  expect(f.navigation.flash()).toBe(outcome);
  expect(f.navigation.marker.pose().position).toEqual([0, 0, -2]);
  expect(ring.visible).toBe(true);
  expect(ring.geometry.drawRange.count).toBe(128 * 6);
  expect(strokes.map(stroke => stroke.scale.x)).toEqual(completedLengths);
  expect(arrow.visible).toBe(false);
  f.navigation.tick(5, 0.011);
  expect(f.navigation.flash()).toBeNull();
  expect(ring.visible).toBe(false); expect(arrow.visible).toBe(true);
  expect(f.navigation.marker.pose().position).toEqual([0, 0, 0]);
  f.navigation.dispose();
});

it("replays Cancel reveal when a selected floor draft replaces an existing goal, without restarting on path echoes", () => {
  const f = fixture();
  f.current.nav_goal = { type: "nav_goal", ts: 1, pose: [2, 0, 0, 0], path_poses: [[0, 0, 0, 0], [2, 0, 0, 0]] };
  f.current.nav = { state: "following_path", outcome: null };
  f.navigation.applyView(f.current, f.origin, f.floor, 1);
  f.navigation.setSelected(true); f.navigation.tick(1.3, 0.3);
  const buttonRoot = f.navigation.marker.object.getObjectByName("Navigation cancel button")!;
  expect(buttonRoot.scale.x).toBeCloseTo(1);
  f.preview(2, 3);
  expect(buttonRoot.scale.x).toBeCloseTo(1); // Preview preserves the current goal's Cancel.
  f.hold(3, 3); f.release(3.1, 3);
  expect(f.commits).toHaveBeenCalledOnce();
  expect(buttonRoot.scale.x).toBe(0);
  f.navigation.tick(3.24, 0.14);
  expect(buttonRoot.scale.x).toBeCloseTo(0.5);
  f.current.nav_goal = { type: "nav_goal", ts: 2, pose: [2, -3, 0, 0], path_poses: [[0, 0, 0, 0], [2, -3, 0, 0]] };
  f.navigation.applyView(f.current, f.origin, f.floor, 3.25);
  expect(buttonRoot.scale.x).toBeCloseTo(0.5);
  f.navigation.tick(3.4, 0.14);
  expect(buttonRoot.scale.x).toBeCloseTo(1);
  f.navigation.dispose();
});
