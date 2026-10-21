import { afterEach, describe, expect, it } from "vitest";
import { DimOSWebXRClient } from "../src/DimOSWebXRClient";
import { BrowserWebSocketTransport } from "../src/websocket/BrowserWebSocketTransport";
import { cameraFixture } from "./fixtures/camera";
import { LIDAR_FOURCC } from "@dimos-ar-client/websocket/protocol";
import type { Hello, State } from "@dimos-ar-client/websocket/protocolTypes";

class Socket {
  binaryType = "";
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: (string | Uint8Array)[] = [];
  send(value: string | Uint8Array) { this.sent.push(value); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(new Event("open")); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) + "\n" } as MessageEvent); }
  commands(type: string) { return this.sent.filter((value): value is string => typeof value === "string").map(value => JSON.parse(value)).filter(value => value.type === type); }
}
const hello: Hello = {
  type: "hello", client_id: "webxr", time_sync: { ts_client: 10, ts_server: 10 },
  robot: { display_name: "Go2", body_bounds_m: [0.7, 0.5, 0.55], footprint_m: [0.7, 0.3], base_height_m: 0.33 },
  capabilities: {
    lidar: { available: true, reason: null }, localization: { available: true, reason: null },
    estop: { available: true, reason: null }, agent: { available: true, reason: null },
    navigation: { available: true, reason: null, nav_goal: { available: true, reason: null }, nav_joystick: { available: true, reason: null } },
  },
};
const state: State = {
  type: "state", server: { connected_clients: 1 },
  lidar: { enabled: false, min_height_m: 0, max_height_m: 2, max_range_m: 5 },
  nav: { state: "idle", outcome: null }, agent: { idle: true },
};
const pose = { position: [0, 0.5, 0], orientation: [0, 0, 0, 1] } as const;
const alignment = { type: "localization_result", position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 10 };
const request = { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); });
function fixture() {
  let now = 10;
  const sockets: Socket[] = [];
  const camera = cameraFixture(undefined, { now: () => now });
  const client = new DimOSWebXRClient({
    camera: camera.source, clock: { now: () => now },
    transport: new BrowserWebSocketTransport({ url: "wss://pc.test/ar", socketFactory: () => {
      const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket;
    } }),
  });
  cleanup.push(() => client.dispose());
  client.start();
  const tick = (axes: { x: number; y: number } | null = null) => client.tick({ position: [...pose.position], orientation: [...pose.orientation] }, axes);
  function connect() {
    client.resumeTracking();
    const socket = sockets[sockets.length - 1];
    socket.open();
    expect(client.ui.snapshot().connectionText).toContain("handshake");
    socket.receive(hello); socket.receive(state);
    socket.receive({ type: "pose", position: [2, 0, 0.33], orientation: [0, 0, 0, 1], ts: 10 });
    return socket;
  }
  return { client, camera, sockets, tick, connect, advance: (delta: number) => { now += delta; } };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

describe("WebXR complete ARModule session", () => {
  it("localizes from a retained setup prompt, navigates, arrives, and recomposes on realignment", async () => {
    const f = fixture();
    expect(f.client.ui.snapshot().wizardTitle).toBe("Connect");
    const socket = f.connect();
    f.tick();
    expect(socket.commands("lidar_settings_request").at(-1)?.enabled).toBe(false);
    socket.receive(request);
    expect(f.camera.media.getUserMedia).not.toHaveBeenCalled();
    f.client.ui.nextSetup();
    expect(f.client.ui.snapshot().captureText).toContain("Scanning");
    expect(socket.commands("localization_start_request")).toHaveLength(0);
    await f.camera.source.waitUntilOpen();
    f.tick(); await settle(); f.camera.emit(); await settle();
    expect(f.client.episode.view().phase).toBe("awaiting_result");
    expect(socket.sent.filter(value => value instanceof Uint8Array)).toHaveLength(1);
    f.client.suspend();
    expect(f.client.episode.view().phase).toBe("awaiting_result");
    expect(f.client.session.view().connection).toBe("ready");
    // Results complete setup without requiring another XR frame (e.g. focus is blurred).
    socket.receive(alignment);
    expect(f.client.ui.setupCompleted).toBe(true);
    f.tick();
    expect(socket.commands("lidar_settings_request").at(-1)?.enabled).toBe(true);
    expect(f.camera.stopped).toHaveBeenCalled();
    f.client.holdNavigation([0, 1.5, 0], [0, -1, -2], [{ position: [0, 0, 0], normal: [0, 1, 0] }]);
    f.client.releaseNavigation([0, 1.5, 0], [0, -1, -2], [{ position: [0, 0, 0], normal: [0, 1, 0] }]);
    const goal = socket.commands("nav_goal_request").at(-1);
    expect(goal).toBeDefined();
    expect(goal.orientation[2]).toBeCloseTo(0); // WebXR -Z = odom +X
    socket.receive({ type: "nav_goal", ts: 10, pose: [3, 0, 0, 0], path_poses: [[2, 0, 0, 0], [3, 0, 0, 0]] });
    socket.receive({ ...state, nav: { state: "following_path", outcome: null } });
    f.tick(); expect(f.client.route.object.visible).toBe(true);
    socket.receive({ type: "agent_skill", name: "ar_place_marker", args: { id: "door", x: 3, y: 0, z: 1, title: "Door" } });
    const cloud = new ArrayBuffer(28);
    const lidar = new DataView(cloud);
    lidar.setUint32(0, LIDAR_FOURCC, true); lidar.setFloat64(4, 10, true); lidar.setUint32(12, 1, true);
    lidar.setFloat32(16, 3, true); lidar.setFloat32(20, 0, true); lidar.setFloat32(24, 0.5, true);
    socket.onmessage?.({ data: cloud } as MessageEvent);
    expect(f.client.lidar.object.visible).toBe(true);
    expect(f.client.markers.object.children[0].position.z).toBeCloseTo(-3);
    const before = f.client.robot.object.position.clone();
    socket.receive({ ...alignment, position: [0.2, 0, 0], ts: 11 }); f.tick();
    expect(f.client.robot.object.position.z).toBeCloseTo(before.z + 0.2);
    expect(f.client.navigation.marker.pose().position[2]).toBeCloseTo(-2.8);
    expect(f.client.markers.object.children[0].position.z).toBeCloseTo(-2.8);
    expect(f.client.lidar.object.geometry.getAttribute("position").getZ(0)).toBeCloseTo(-2.8);
    expect(f.client.route.object.geometry.getAttribute("instanceStart").getZ(0)).toBeCloseTo(-1.8);
    socket.receive({ type: "nav_goal", ts: 10, path_poses: [] });
    socket.receive({ ...state, nav: { state: "resolved", outcome: "succeeded" } });
    f.tick(); expect(f.client.navigation.marker.cancelVisible()).toBe(false);
    // The server owns the 0.75m policy. The same ClientCore episode accepts its runtime prompt.
    socket.receive({ ...request, capture_policy: "robot_los_required" });
    expect(f.client.episode.view().phase).toBe("capturing");
    await f.camera.source.waitUntilOpen(); f.tick(); await settle(); f.camera.emit(); await settle();
    expect(f.client.episode.view().phase).toBe("awaiting_result");
    socket.receive(alignment); expect(f.client.episode.view().phase).toBe("idle");
  });

  it("keeps scanning after missed marker batches and completes when the user looks later", async () => {
    const f = fixture();
    const socket = f.connect();
    const markerRequest = { ...request, capture_policy: "robot_los_required", observation_count: 3 };
    socket.receive(markerRequest);
    // A pending prompt must survive time spent on the connection step.
    f.advance(30); f.tick();
    expect(f.camera.media.getUserMedia).not.toHaveBeenCalled();
    f.client.ui.nextSetup();
    await f.camera.source.waitUntilOpen();
    for (let batch = 0; batch < 3; batch++) {
      for (let frame = 0; frame < 3; frame++) {
        f.advance(0.6); f.tick(); await settle();
        f.camera.emit(); await settle();
      }
      expect(f.client.episode.view().phase).toBe("awaiting_result");
      expect(socket.sent.filter(value => value instanceof Uint8Array)).toHaveLength(batch + 1);
      expect(f.client.ui.setupCompleted).toBe(false);
      if (batch < 2) {
        // ARModule sends another observations request when no marker was detected.
        f.advance(5); f.tick(); socket.receive(markerRequest);
        expect(f.client.episode.view().phase).toBe("capturing");
      }
    }
    expect(f.camera.frames.start).toHaveBeenCalledTimes(1);
    socket.receive(alignment);
    expect(f.client.ui.setupCompleted).toBe(true);
    expect(f.client.episode.view().phase).toBe("idle");
  });

  it("uses one white navigation target that follows the robot when idle and returns after arrival", () => {
    const f = fixture(); const socket = f.connect(); socket.receive(alignment);
    f.client.ui.nextSetup(); f.tick();
    const marker = f.client.navigation.marker;
    expect(marker.object.visible).toBe(true);
    expect(marker.pose()).toEqual(f.client.robot.floorPose());
    socket.receive({ type: "pose", position: [3, 1, 0.33], orientation: [0, 0, 0, 1], ts: 11 });
    expect(marker.pose()).toEqual(f.client.robot.floorPose());
    socket.receive({ type: "nav_goal", ts: 11, pose: [5, 0, 0, 0], path_poses: [[3, 1, 0, 0], [5, 0, 0, 0]] });
    socket.receive({ ...state, nav: { state: "following_path", outcome: null } });
    expect(marker.pose().position[2]).toBeCloseTo(-5);
    const routeMaterial = f.client.route.object.material;
    expect(routeMaterial.color.getHex()).toBe(0xffffff);
    expect(routeMaterial.worldUnits).toBe(true);
    expect(routeMaterial.linewidth).toBe(0.015);
    socket.receive({ type: "nav_goal", ts: 12, path_poses: [] });
    socket.receive({ ...state, nav: { state: "resolved", outcome: "succeeded" } });
    expect(marker.pose()).toEqual(f.client.robot.floorPose());
  });

  it("pauses on Back, resumes retained prompts, and allows Skip without spatial navigation", () => {
    const f = fixture(); const socket = f.connect();
    f.client.ui.nextSetup(); socket.receive(request);
    f.client.ui.previousSetup();
    expect(f.client.ui.wizardStep).toBe("connect");
    const starts = socket.commands("localization_start_request").length;
    f.client.ui.nextSetup();
    expect(socket.commands("localization_start_request")).toHaveLength(starts);
    f.client.ui.nextSetup(); f.tick();
    expect(f.client.ui.setupCompleted).toBe(true);
    expect(f.client.originStore.hasTrackingOrigin).toBe(false);
    f.client.holdNavigation([0, 1, 0], [0, -1, -1], []);
    expect(socket.commands("nav_goal_request")).toHaveLength(0);
    f.client.restartSetup(); expect(f.client.ui.wizardStep).toBe("connect");
    f.client.ui.previousSetup(); expect(f.client.ui.setupCompleted).toBe(true);
  });

  it("releases joystick on mode changes, UI opening, input loss, and tracking resets", () => {
    const f = fixture(); const socket = f.connect(); socket.receive(alignment);
    f.client.ui.nextSetup(); f.tick();
    f.tick({ x: 0, y: -1 });
    expect(socket.commands("nav_joystick_request").at(-1)?.linear[0]).toBeGreaterThan(0);
    f.client.ui.setOperatingMode("agent"); f.tick({ x: 0, y: -1 });
    expect(socket.commands("nav_joystick_request").at(-1)?.linear).toEqual([0, 0, 0]);
    const count = socket.commands("nav_joystick_request").length;
    f.client.holdNavigation([0, 1, 0], [0, -1, -1], []);
    expect(socket.commands("nav_goal_request")).toHaveLength(0);
    f.client.ui.setOperatingMode("manual"); f.advance(1); f.tick({ x: 0, y: -1 });
    f.client.ui.menuOpen = true; f.tick({ x: 0, y: -1 });
    expect(socket.commands("nav_joystick_request")).toHaveLength(count + 2);
    f.client.ui.menuOpen = false; f.advance(1); f.tick({ x: 0, y: -1 }); f.client.loseInput();
    expect(socket.commands("nav_joystick_request").at(-1)?.linear).toEqual([0, 0, 0]);
    f.client.invalidateTracking();
    expect(f.client.originStore.hasTrackingOrigin).toBe(false);
    expect(f.client.ui.setupCompleted).toBe(false);
    expect(f.client.ui.wizardStep).toBe("localization");
    socket.receive(alignment); // Retired socket cannot restore old reference-space alignment.
    expect(f.client.originStore.hasTrackingOrigin).toBe(false);
    f.client.resumeTracking();
    expect(f.client.session.view().connection).toBe("connecting");
  });

  it("allows skipping connection and animates all three scanning phases", () => {
    const skipped = fixture();
    skipped.client.ui.nextSetup(); skipped.client.ui.nextSetup();
    expect(skipped.client.ui.setupCompleted).toBe(true);
    expect(skipped.client.session.view().connection).toBe("disconnected");
    const scanning = fixture(); const socket = scanning.connect(); scanning.client.ui.nextSetup(); socket.receive(request);
    const phases = new Set<string>();
    for (let i = 0; i < 3; i++) {
      scanning.tick(); phases.add(scanning.client.ui.snapshot().captureText.split("\n")[0]);
      scanning.advance(0.5);
    }
    expect(phases).toEqual(new Set(["Scanning .", "Scanning ..", "Scanning ..."]));
  });

  it("retries handshake through the existing session and restores post-setup settings", () => {
    const f = fixture(); const socket = f.connect(); socket.receive(alignment);
    f.client.ui.nextSetup(); f.tick();
    socket.onclose?.(new Event("close"));
    expect(f.client.ui.snapshot().connectionText).toContain("Retrying");
    f.advance(2); f.tick();
    const next = f.sockets[1]; expect(next).toBeDefined();
    next.open(); next.receive({ ...hello, time_sync: { ts_client: 12, ts_server: 12 } }); next.receive(state); f.tick();
    expect(f.client.session.view().connection).toBe("ready");
    expect(next.commands("lidar_settings_request").at(-1)?.enabled).toBe(true);
  });
});
