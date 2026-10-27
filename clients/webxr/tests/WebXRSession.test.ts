import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecognitionPort, SynthesisPort } from "@dimos-ar-client/agent/AgentDraftSession";
import { DimOSWebXRClient } from "../src/DimOSWebXRClient";
import { BrowserWebSocketTransport } from "../src/websocket/BrowserWebSocketTransport";
import { cameraFixture } from "./fixtures/camera";
import { LIDAR_FOURCC, decodeLocalizationObservations } from "@dimos-ar-client/websocket/protocol";
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
  result(position = [0, 0, 0]) {
    const packet = this.sent.filter((value): value is Uint8Array => value instanceof Uint8Array).at(-1)!;
    const ts = Math.max(...decodeLocalizationObservations(packet).observations.map(observation => observation.ts_capture));
    this.receive({ ...alignment, position, ts });
  }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(new Event("open")); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) + "\n" } as MessageEvent); }
  acknowledgeLidar() {
    const { type: _type, ...lidar } = this.commands("lidar_settings_request").at(-1);
    this.receive({ ...state, lidar });
  }
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
function fixture(recognition: RecognitionPort | null = null, odomScale = 1, synthesis: SynthesisPort | null = null) {
  let now = 10;
  const sockets: Socket[] = [];
  const camera = cameraFixture(undefined, { now: () => now });
  const client = new DimOSWebXRClient({
    recognition, synthesis, camera: camera.source, clock: { now: () => now },
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
    expect(client.ui.snapshot().connectionText).toBe("Connecting…");
    socket.receive({ ...hello, robot: { ...hello.robot, odom_scale_correction_factor: odomScale } }); socket.receive(state);
    socket.receive({ type: "pose", position: [2, 0, 0.33], orientation: [0, 0, 0, 1], ts: 10 });
    return socket;
  }
  return { client, camera, sockets, tick, connect, advance: (delta: number) => { now += delta; } };
}
function submitAlignment(client: DimOSWebXRClient, timestamp: number) {
  client.session.submitLocalizationObservations([{
    ts_capture: timestamp, jpeg: new Uint8Array([1]),
    intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0, width: 1, height: 1, distortion_model: "none", distortion: [] },
    camera_position: [0, 0, 0], camera_orientation: [0, 0, 0, 1],
  }]);
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
    socket.result();
    expect(f.client.ui.setupCompleted).toBe(true);
    f.client.resumeTracking();
    f.tick();
    expect(socket.commands("lidar_settings_request").at(-1)?.enabled).toBe(true);
    expect(f.camera.stopped).toHaveBeenCalled();
    for (let i = 0; i < 17; i++) { f.advance(0.1); f.tick(); }
    f.client.holdNavigation([0, 1.5, 0], [0, -1, -2], [{ position: [0, 0, 0], normal: [0, 1, 0] }]);
    f.client.releaseNavigation([0, 1.5, 0], [0, -1, -2], [{ position: [0, 0, 0], normal: [0, 1, 0] }]);
    const goal = socket.commands("nav_goal_request").at(-1);
    expect(goal).toBeDefined();
    expect(goal.orientation[2]).toBeCloseTo(0); // WebXR -Z = odom +X
    socket.receive({ type: "nav_goal", ts: 10, pose: [3, 0, 0, 0], path_poses: [[2, 0, 0, 0], [3, 0, 0, 0]] });
    socket.receive({ ...state, lidar: { enabled: true, min_height_m: 0.1, max_height_m: 0.8, max_range_m: 0.5 }, nav: { state: "following_path", outcome: null } });
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
    submitAlignment(f.client, 11);
    socket.result([0.2, 0, 0]); f.tick();
    expect(f.client.robot.object.position.z).toBeCloseTo(before.z + 0.2);
    expect(f.client.navigation.marker.pose().position[2]).toBeCloseTo(-2.8);
    expect(f.client.markers.object.children[0].position.z).toBeCloseTo(-2.8);
    expect(f.client.lidar.object.geometry.getAttribute("position").getZ(0)).toBeCloseTo(-2.8);
    expect(f.client.route.object.geometry.getAttribute("instanceStart").getZ(0)).toBeCloseTo(-1.865);
    socket.receive({ type: "nav_goal", ts: 10, path_poses: [] });
    socket.receive({ ...state, nav: { state: "resolved", outcome: "succeeded" } });
    f.tick(); expect(f.client.navigation.marker.cancelVisible()).toBe(false);
    // The server owns the 0.75m policy. The same ClientCore episode accepts its runtime prompt.
    socket.receive({ ...request, capture_policy: "robot_los_required" });
    expect(f.client.episode.view().phase).toBe("capturing");
    await f.camera.source.waitUntilOpen(); f.tick(); await settle(); f.camera.emit(); await settle();
    expect(f.client.episode.view().phase).toBe("awaiting_result");
    socket.result(); expect(f.client.episode.view().phase).toBe("idle");
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
    socket.result();
    expect(f.client.ui.setupCompleted).toBe(true);
    expect(f.client.episode.view().phase).toBe("idle");
  });

  it("uses one white navigation target that follows the robot when idle and returns after arrival", () => {
    const f = fixture(); const socket = f.connect(); submitAlignment(f.client, 9); socket.result();
    f.client.ui.nextSetup(); f.tick();
    const marker = f.client.navigation.marker;
    expect(marker.object.visible).toBe(true);
    expect(JSON.parse(JSON.stringify(marker.pose()))).toEqual(JSON.parse(JSON.stringify(f.client.robot.floorPose())));
    socket.receive({ type: "pose", position: [3, 1, 0.33], orientation: [0, 0, 0, 1], ts: 11 });
    expect(JSON.parse(JSON.stringify(marker.pose()))).toEqual(JSON.parse(JSON.stringify(f.client.robot.floorPose())));
    socket.receive({ type: "nav_goal", ts: 11, pose: [5, 0, 0, 0], path_poses: [[3, 1, 0, 0], [5, 0, 0, 0]] });
    socket.receive({ ...state, nav: { state: "following_path", outcome: null } });
    expect(marker.pose().position[2]).toBeCloseTo(-5);
    const routeMaterial = f.client.route.object.material;
    expect(routeMaterial.color.getHex()).toBe(0xffffff);
    expect(routeMaterial.worldUnits).toBe(true);
    expect(routeMaterial.linewidth).toBe(0.008);
    expect(routeMaterial.dashed).toBe(false);
    expect(routeMaterial.opacity).toBe(0.85);
    socket.receive({ type: "nav_goal", ts: 12, path_poses: [] });
    socket.receive({ ...state, nav: { state: "resolved", outcome: "succeeded" } });
    expect(f.client.navigation.flash()).toBe("succeeded");
    expect(marker.pose().position[2]).toBeCloseTo(-5);
    for (let i = 0; i < 8; i++) { f.advance(0.1); f.tick(); }
    expect(f.client.navigation.flash()).toBeNull();
    expect(JSON.parse(JSON.stringify(marker.pose()))).toEqual(JSON.parse(JSON.stringify(f.client.robot.floorPose())));
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

  it("keeps joystick active with the menu open and releases on mode changes, input loss, and tracking resets", () => {
    const f = fixture(); const socket = f.connect(); submitAlignment(f.client, 9); socket.result();
    f.client.ui.nextSetup(); f.tick();
    for (let i = 0; i < 17; i++) { f.advance(0.1); f.tick(); }
    f.tick({ x: 0, y: -1 });
    expect(socket.commands("nav_joystick_request").at(-1)?.linear[0]).toBeGreaterThan(0);
    f.client.ui.setOperatingMode("agent"); f.tick({ x: 0, y: -1 });
    expect(socket.commands("nav_joystick_request").at(-1)?.linear).toEqual([0, 0, 0]);
    const count = socket.commands("nav_joystick_request").length;
    f.client.holdNavigation([0, 1, 0], [0, -1, -1], []);
    expect(socket.commands("nav_goal_request")).toHaveLength(0);
    f.client.ui.setOperatingMode("manual"); f.advance(1); f.tick({ x: 0, y: -1 });
    f.client.ui.menuOpen = true; f.tick({ x: 0, y: -1 });
    expect(socket.commands("nav_joystick_request")).toHaveLength(count + 1);
    f.client.ui.menuOpen = false; f.advance(1); f.tick({ x: 0, y: -1 }); f.client.loseInput();
    expect(socket.commands("nav_joystick_request").at(-1)?.linear).toEqual([0, 0, 0]);
    f.client.invalidateTracking();
    expect(f.client.originStore.hasTrackingOrigin).toBe(false);
    expect(f.client.ui.setupCompleted).toBe(false);
    expect(f.client.ui.wizardStep).toBe("localization");
    socket.result(); // Retired socket cannot restore old reference-space alignment.
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
    const f = fixture(); const socket = f.connect(); submitAlignment(f.client, 9); socket.result();
    f.client.ui.nextSetup(); f.tick();
    socket.onclose?.(new Event("close"));
    expect(f.client.ui.snapshot().connectionText).toBe("Reconnecting…");
    f.advance(2); f.tick();
    const next = f.sockets[1]; expect(next).toBeDefined();
    next.open(); next.receive({ ...hello, time_sync: { ts_client: 12, ts_server: 12 } }); next.receive(state); f.tick();
    expect(f.client.session.view().connection).toBe("ready");
    expect(next.commands("lidar_settings_request").at(-1)?.enabled).toBe(true);
  });
});


it("records only a held draft after skipped alignment and sends only on confirmation", () => {
  let onText = (_text: string, _final: boolean) => {};
  const f = fixture({ start: (callback, _error, _end, started) => { onText = callback; started(); }, stop() {} });
  const socket = f.connect(); f.client.ui.nextSetup(); f.client.ui.nextSetup();
  f.client.ui.setOperatingMode("agent"); f.client.ui.menuOpen = true; f.tick();
  expect(f.client.originStore.hasTrackingOrigin).toBe(false);
  expect(f.client.speech.beginRecording()).toBe(true);
  expect(f.client.isRobotSelected()).toBe(true);
  onText("go forward", false); f.client.speech.endRecording();
  expect(socket.commands("user_message_request")).toHaveLength(0);
  expect(f.client.speech.submitTyped(f.client.speech.snapshot().prompt)).toBe(true);
  expect(socket.commands("user_message_request").at(-1)?.text).toBe("go forward");
  f.client.speech.beginRecording(); onText("turn left", false);
  f.client.loseInput(); onText("stale result", true);
  expect(f.client.speech.snapshot().prompt).toBe("turn left");
  f.client.ui.menuOpen = false; f.tick(); expect(f.client.speech.isRecording()).toBe(false);
  f.client.ui.setOperatingMode("manual"); f.tick(); expect(f.client.speech.beginRecording()).toBe(false);
  f.client.suspend(); expect(f.client.isRobotSelected()).toBe(false);
  f.client.restartSetup(); expect(f.client.speech.snapshot().status).toBe("Off");
});

it("sends each emergency stop once immediately and keeps feedback pressed for 350ms", () => {
  const f = fixture(); const socket = f.connect(); f.tick();
  f.client.emergencyStop();
  expect(socket.commands("estop_request")).toHaveLength(1);
  f.advance(0.1); f.tick(); expect(f.client.ui.estopPressed).toBe(true);
  f.advance(0.1); f.tick(); f.advance(0.1); f.tick(); expect(f.client.ui.estopPressed).toBe(true);
  f.advance(0.1); f.tick(); expect(f.client.ui.estopPressed).toBe(false);
  f.client.emergencyStop(); expect(socket.commands("estop_request")).toHaveLength(2);
});

it("retires stale localization responses while retaining a dismissable alignment", () => {
  const f = fixture(); const socket = f.connect(); submitAlignment(f.client, 9); socket.result();
  const saved = f.client.originStore.T_odom_client;
  f.client.recoverUnknownTrackingReset();
  expect(f.client.originStore.T_odom_client).toEqual(saved);
  socket.receive({ ...alignment, position: [9, 0, 0], ts: 99 });
  expect(f.client.originStore.T_odom_client).toEqual(saved);
  f.client.ui.requestAlignmentReview("reference-reset");
  expect(f.client.ui.snapshot().alignmentReview?.pending).toBe(true);
  f.client.ui.dismissAlignmentReview();
  expect(f.client.ui.snapshot().alignmentReview?.pending).toBe(false);
  expect(f.client.originStore.T_odom_client).toEqual(saved);
});

it("keeps per-mode sensor ranges and applies point limits locally", () => {
  const f = fixture(); const socket = f.connect();
  f.client.ui.setLidarMode("full"); socket.acknowledgeLidar();
  f.client.ui.adjustLidarRange(-1); socket.acknowledgeLidar();
  expect(socket.commands("lidar_settings_request").at(-1)?.max_range_m).toBe(4.5);
  const sent = socket.commands("lidar_settings_request").length;
  f.client.ui.adjustLidarPoints(-1);
  expect(f.client.ui.lidarPreferences.pointLimit).toBe(3750);
  expect(socket.commands("lidar_settings_request")).toHaveLength(sent);
  f.client.ui.setLidarMode("obstacles"); socket.acknowledgeLidar();
  f.client.ui.adjustLidarRange(1); socket.acknowledgeLidar();
  expect(f.client.ui.lidarPreferences.obstacleRangeM).toBe(0.7);
  f.client.ui.setLidarMode("full");
  expect(socket.commands("lidar_settings_request").at(-1)?.max_range_m).toBe(4.5);
});


it("uses the advertised XY heuristic only for native sensor clearance", () => {
  const f = fixture(null, 1.25); const socket = f.connect();
  submitAlignment(f.client, 9); socket.result();
  f.client.ui.nextSetup();
  socket.receive({ type: "pose", position: [5, -2.5, 0.33], orientation: [0, 0, 0, 1], ts: 10 });
  f.client.ui.setLidarMode("obstacles"); socket.acknowledgeLidar();
  const data = new ArrayBuffer(28), wire = new DataView(data);
  wire.setUint32(0, LIDAR_FOURCC, true); wire.setFloat64(4, 10, true); wire.setUint32(12, 1, true);
  wire.setFloat32(16, 6, true); wire.setFloat32(20, -2.5, true); wire.setFloat32(24, 0.4, true);
  socket.onmessage?.({ data } as MessageEvent); f.tick();
  expect(f.client.lidar.object.geometry.getAttribute("color").getW(0)).toBeCloseTo(0.15625);
  expect(f.client.lidar.object.geometry.getAttribute("position").getZ(0)).toBeCloseTo(-6);
});

it("restarts a partial capture through its episode owner after tracking resumes", async () => {
  const f = fixture(); const socket = f.connect();
  socket.receive({ ...request, observation_count: 3 }); f.client.ui.nextSetup();
  await f.camera.source.waitUntilOpen(); f.tick(); await settle(); f.camera.emit(); await settle();
  expect(f.client.episode.view().capturedCount).toBe(1);
  f.client.suspend();
  expect(f.client.episode.view().phase).toBe("idle");
  const openings = f.camera.media.getUserMedia.mock.calls.length;
  f.client.resumeTracking();
  expect(f.client.episode.view().phase).toBe("capturing");
  await f.camera.source.waitUntilOpen(); f.tick(); await settle(); f.camera.emit(); await settle();
  expect(f.camera.media.getUserMedia.mock.calls.length).toBeGreaterThan(openings);
  expect(f.client.episode.view().capturedCount).toBe(1);
});

it("speaks distinct identical agent-message events once each", () => {
  const spoken: string[] = [];
  const f = fixture(null, 1, { speak(text, done) { spoken.push(text); done(); }, stop() {} });
  const socket = f.connect();
  f.client.ui.flow.finish(); f.client.ui.setOperatingMode("agent"); f.client.setRobotSelected(true); f.tick();
  socket.receive({ type: "agent_message", text: "Done" }); f.tick(); f.tick();
  expect(spoken).toEqual(["Done"]);
  socket.receive({ type: "agent_message", text: "Done" }); f.tick(); f.tick();
  expect(spoken).toEqual(["Done", "Done"]);
});

it("uses one activity derivation for the UI badge and robot through idle, recognition and synthesis", () => {
  const recognition: RecognitionPort = { start(_text, _error, _end, started) { started(); }, stop() {} };
  const f = fixture(recognition, 1, { speak() {}, stop() {} }); const socket = f.connect();
  const feedback = vi.spyOn(f.client.robot, "feedback");
  f.client.ui.flow.finish(); f.client.ui.setOperatingMode("agent"); f.client.ui.menuOpen = true;
  f.client.setRobotSelected(true); f.tick();
  expect(f.client.speech.snapshot().status).toBe("Ready");
  expect(f.client.ui.snapshot().activity).toBe("Idle");
  expect(feedback.mock.calls.at(-1)?.[0].activity).toBe("Idle");
  expect(f.client.speech.beginRecording()).toBe(true); f.tick();
  expect(f.client.ui.snapshot().activity).toBe("Listening");
  expect(feedback.mock.calls.at(-1)?.[0].activity).toBe("Listening");
  f.client.speech.endRecording(true);
  socket.receive({ type: "agent_message", text: "Ready to help" }); f.tick();
  expect(f.client.ui.snapshot().activity).toBe("Responding");
  expect(feedback.mock.calls.at(-1)?.[0].activity).toBe("Responding");
});

it("gates selection and manual commands during alignment review and restores eligibility on dismissal", () => {
  const f = fixture(); const socket = f.connect(); f.client.ui.flow.finish();
  f.client.setRobotSelected(true); f.tick();
  expect(f.client.ui.snapshot()).toMatchObject({ robotSelected: true, robotSelectable: true });
  f.client.ui.requestAlignmentReview("reference-reset");
  expect(f.client.controlsEnabled()).toBe(false);
  f.tick({ x: 0, y: -1 }); f.client.setRobotSelected(true);
  expect(f.client.ui.snapshot()).toMatchObject({ robotSelected: false, robotSelectable: false });
  expect(socket.commands("nav_joystick_request")).toHaveLength(0);
  f.client.ui.dismissAlignmentReview(); f.tick();
  expect(f.client.controlsEnabled()).toBe(true);
  expect(f.client.ui.snapshot()).toMatchObject({ robotSelected: false, robotSelectable: true });
});
