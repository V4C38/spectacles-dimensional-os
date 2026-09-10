import { describe, expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../../Assets/Scripts/DimosARClient/core/localization/clientTrackingOrigin";
import {
  odomToClientTrackingPoint,
  odomToClientTrackingPose,
  odomToClientTrackingYawPose,
  clientTrackingToOdomPoint,
  clientTrackingToOdomPose,
  clientTrackingToOdomYawPose,
} from "../../Assets/Scripts/DimosARClient/core/localization/clientTrackingTransforms";
import {
  LocalizationCaptureEpisode,
  type LocalizationCaptureConfig,
} from "../../Assets/Scripts/DimosARClient/core/localization/localizationCaptureEpisode";
import { passesGeometricGate } from "../../Assets/Scripts/DimosARClient/core/localization/geometricGate";
import type {
  CameraCaptureSource,
  CameraTrackingSource,
  CaptureGeometry,
  ClientClock,
  WebSocketTransport,
} from "../../Assets/Scripts/DimosARClient/core/websocket/hostPorts";
import { decodeLocalizationObservations } from "../../Assets/Scripts/DimosARClient/core/websocket/protocol";
import { ARModuleSession } from "../../Assets/Scripts/DimosARClient/core/websocket/arModuleSession";
import type {
  Hello,
  Intrinsics,
  LocalizationObservation,
  LocalizationObservationsRequest,
  Quat,
  State,
  Vec3,
  YawPose,
} from "../../Assets/Scripts/DimosARClient/core/websocket/protocolTypes";

const IDENTITY_Q: Quat = [0, 0, 0, 1];

function T(
  position: Vec3,
  orientation: Quat = IDENTITY_Q,
): ReturnType<ClientTrackingOriginStore["setFromLocalizationResult"]> {
  return new ClientTrackingOriginStore().setFromLocalizationResult({
    type: "localization_result",
    position,
    orientation,
    confidence: 1,
    ts: 0,
  });
}

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
}

function expectQuat(actual: Quat, expected: Quat): void {
  const sign = actual[3] * expected[3] < 0 ? -1 : 1;
  expect(actual[0]).toBeCloseTo(expected[0] * sign, 6);
  expect(actual[1]).toBeCloseTo(expected[1] * sign, 6);
  expect(actual[2]).toBeCloseTo(expected[2] * sign, 6);
  expect(actual[3]).toBeCloseTo(expected[3] * sign, 6);
}

describe("client tracking origin", () => {
  it("rejects a non-finite ClientTrackingOrigin", () => {
    const originStore = new ClientTrackingOriginStore();
    expect(() =>
      originStore.setFromLocalizationResult({
        type: "localization_result",
        position: [1, Number.NaN, 0],
        orientation: IDENTITY_Q,
        confidence: 0.5,
        ts: 1,
      }),
    ).toThrow(/finite/);
    expect(() =>
      originStore.setFromLocalizationResult({
        type: "localization_result",
        position: [0, 0, 0],
        orientation: [0, 0, 0, 0],
        confidence: 0.5,
        ts: 1,
      }),
    ).toThrow(/non-zero/);
  });
});

describe("client tracking transforms", () => {
  it("is a no-op in odom when ClientTrackingOrigin is the identity", () => {
    const origin = T([0, 0, 0]);
    expectVec3(odomToClientTrackingPoint([1, 2, 3], origin), [1, 2, 3]);
  });

  it("subtracts ClientTrackingOrigin", () => {
    const origin = T([1, 0, 0]);
    expectVec3(odomToClientTrackingPoint([2, 0, 0], origin), [1, 0, 0]);
  });

  it("round-trips pose, point, and yaw pose through ClientTrackingOrigin", () => {
    const half = Math.PI / 4;
    const yawAboutZ: Quat = [0, 0, Math.sin(half), Math.cos(half)];
    const origin = T([1, 2, 0], yawAboutZ);
    const pose = { position: [3, 4, 5] as Vec3, orientation: yawAboutZ };
    const tracking = odomToClientTrackingPose(pose, origin);
    const back = clientTrackingToOdomPose(tracking, origin);
    expectVec3(back.position, pose.position);
    expectQuat(back.orientation, pose.orientation);

    expectVec3(clientTrackingToOdomPoint(odomToClientTrackingPoint([3, 4, 5], origin), origin), [3, 4, 5]);

    const yawPose: YawPose = [3, 4, 0, Math.PI / 2];
    const trackedYaw = odomToClientTrackingYawPose(yawPose, origin);
    const yawBack = clientTrackingToOdomYawPose(trackedYaw, origin);
    expectVec3([yawBack[0], yawBack[1], yawBack[2]], [3, 4, 0]);
    expect(yawBack[3]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("does not let callers invent a second composition: yaw is T inverse then yaw", () => {
    const origin = T([0, 0, 0], [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)]);
    const tracked = odomToClientTrackingYawPose([1, 0, 0, Math.PI / 2], origin);
    expectVec3([tracked[0], tracked[1], tracked[2]], [0, -1, 0]);
    expect(tracked[3]).toBeCloseTo(0, 6);
  });

  it("rejects non-finite compose inputs", () => {
    const origin = T([0, 0, 0]);
    expect(() => odomToClientTrackingPoint([1, Number.NaN, 0], origin)).toThrow(/finite/);
    expect(() =>
      odomToClientTrackingPose({ position: [1, 0, 0], orientation: [0, 0, 0, 0] }, origin),
    ).toThrow(/non-zero/);
  });

  it("rejects yaw poses whose transformed forward direction is vertical", () => {
    const halfPitch = Math.PI / 4;
    const origin = T([0, 0, 0], [0, Math.sin(halfPitch), 0, Math.cos(halfPitch)]);
    expect(() => odomToClientTrackingYawPose([0, 0, 0, 0], origin)).toThrow(/degenerate yaw geometry/);
  });
});

const GEOMETRY: CaptureGeometry = {
  minDistanceM: 0.35,
  maxDistanceM: 3.0,
  lookAtMaxAngleDeg: 45,
  frameSpacingS: 1.5,
};

const CAPTURE_CONFIG: LocalizationCaptureConfig = {
  resultTimeoutS: 15,
  retryBackoffS: 2,
};

const INTRINSICS: Intrinsics = {
  fx: 100,
  fy: 100,
  cx: 50,
  cy: 50,
  width: 100,
  height: 100,
  distortion_model: "none",
  distortion: [],
};

const STATE: State = {
  type: "state",
  server: { connected_clients: 1 },
  lidar: { enabled: true, min_height_m: 0.1, max_height_m: 1.5, max_range_m: 5 },
  nav: { state: "idle", outcome: null },
};

class FakeClock implements ClientClock {
  nowS = 0;
  now(): number {
    return this.nowS;
  }
}

class FakeTransport implements WebSocketTransport {
  connectCount = 0;
  closeCount = 0;
  texts: string[] = [];
  binaries: Uint8Array[] = [];

  connect(): void {
    this.connectCount += 1;
  }

  close(): void {
    this.closeCount += 1;
  }

  sendText(text: string): void {
    this.texts.push(text);
  }

  sendBinary(data: Uint8Array): void {
    this.binaries.push(data);
  }
}

class FakeTracking implements CameraTrackingSource {
  position: Vec3 = [0, 0, 0];
  orientation: Quat = IDENTITY_Q;
  failWith: Error | null = null;

  cameraOptical(): { position: Vec3; orientation: Quat } {
    if (this.failWith !== null) {
      throw this.failWith;
    }
    return { position: this.position, orientation: this.orientation };
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settleCapture(): Promise<void> {
  await Promise.resolve();
}

class FakeCapture implements CameraCaptureSource {
  calls = 0;
  startCount = 0;
  stopCount = 0;
  started = false;
  failWith: Error | null = null;
  camera_position: Vec3 = [0, 0, 0];
  camera_orientation: Quat = IDENTITY_Q;
  private nextDeferred: Deferred<LocalizationObservation> | null = null;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.startCount += 1;
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.stopCount += 1;
  }

  defer(): Deferred<LocalizationObservation> {
    this.nextDeferred = deferred<LocalizationObservation>();
    return this.nextDeferred;
  }

  observation(): LocalizationObservation {
    return {
      ts_capture: this.calls,
      jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      intrinsics: { ...INTRINSICS },
      camera_position: this.camera_position,
      camera_orientation: this.camera_orientation,
    };
  }

  capture(): Promise<LocalizationObservation> {
    if (!this.started) {
      throw new Error("capture() while stopped");
    }
    this.calls += 1;
    if (this.failWith !== null) {
      throw this.failWith;
    }
    if (this.nextDeferred !== null) {
      const pending = this.nextDeferred;
      this.nextDeferred = null;
      return pending.promise;
    }
    return Promise.resolve(this.observation());
  }
}

function helloAt(tsClient: number): Hello {
  return {
    type: "hello",
    client_id: "c3f1a9",
    time_sync: { ts_client: tsClient, ts_server: 100 },
    robot: {
      display_name: "Unitree Go2",
      body_bounds_m: [0.7, 0.5, 0.55],
      footprint_m: [0.7, 0.5],
      base_height_m: 0.33,
    },
    capabilities: {
      lidar: { available: true, reason: null },
      navigation: { available: true, reason: null },
      localization: { available: true, reason: null },
      estop: { available: true, reason: null },
    },
  };
}

function handshake(session: ARModuleSession, transport: FakeTransport, clock: FakeClock): void {
  session.start();
  session.onTransportOpen();
  session.onTransportText(`${JSON.stringify(helloAt(clock.nowS))}\n${JSON.stringify(STATE)}\n`);
  expect(session.view().connection).toBe("ready");
  expect(transport.texts).toHaveLength(1);
}

function makeController(): {
  controller: LocalizationCaptureEpisode;
  session: ARModuleSession;
  transport: FakeTransport;
  clock: FakeClock;
  originStore: ClientTrackingOriginStore;
  tracking: FakeTracking;
  capture: FakeCapture;
} {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const originStore = new ClientTrackingOriginStore();
  const tracking = new FakeTracking();
  const capture = new FakeCapture();
  const session = new ARModuleSession({
    transport,
    clock,
    clientTrackingOriginStore: originStore,
    config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
  });
  handshake(session, transport, clock);
  const controller = new LocalizationCaptureEpisode({
    session,
    clientTrackingOriginStore: originStore,
    clock,
    tracking,
    capture,
    geometry: GEOMETRY,
    config: CAPTURE_CONFIG,
  });
  return { controller, session, transport, clock, originStore, tracking, capture };
}

function deliverRequest(session: ARModuleSession, request: LocalizationObservationsRequest): void {
  session.onTransportText(`${JSON.stringify(request)}\n`);
}

function deliverPose(session: ARModuleSession, position: Vec3): void {
  session.onTransportText(
    JSON.stringify({
      type: "pose",
      position,
      orientation: IDENTITY_Q,
      ts: 1,
    }) + "\n",
  );
}

function deliverResult(session: ARModuleSession, position: Vec3 = [0, 0, 0]): void {
  session.onTransportText(
    JSON.stringify({
      type: "localization_result",
      position,
      orientation: IDENTITY_Q,
      confidence: 1,
      ts: 1,
    }) + "\n",
  );
}

function startRequestCount(transport: FakeTransport): number {
  return transport.texts.filter((text) => text.includes("localization_start_request")).length;
}

function setOriginLookingAtRobot(session: ARModuleSession): void {
  deliverResult(session);
  deliverPose(session, [0, 0, 1]);
}

describe("geometric gate", () => {
  const camera = { position: [0, 0, 0] as Vec3, orientation: IDENTITY_Q };

  it("passes when optical +Z points at a robot inside the distance band", () => {
    expect(passesGeometricGate(camera, [0, 0, 1], GEOMETRY)).toBe(true);
  });

  it("fails when the robot is too close, too far, or 90 degrees off optical +Z", () => {
    expect(passesGeometricGate(camera, [0, 0, 0.2], GEOMETRY)).toBe(false);
    expect(passesGeometricGate(camera, [0, 0, 4], GEOMETRY)).toBe(false);
    expect(passesGeometricGate(camera, [1, 0, 0], GEOMETRY)).toBe(false);
  });

  it("does not treat tracking -Z as view: a robot behind identity optical +Z fails", () => {
    expect(passesGeometricGate(camera, [0, 0, -1], GEOMETRY)).toBe(false);
  });

  it("fails degenerate look-at at zero distance", () => {
    expect(passesGeometricGate(camera, [0, 0, 0], GEOMETRY)).toBe(false);
  });

  it("rejects non-finite positions and a zero quaternion", () => {
    expect(() =>
      passesGeometricGate({ position: [Number.NaN, 0, 0], orientation: IDENTITY_Q }, [0, 0, 1], GEOMETRY),
    ).toThrow(/finite/);
    expect(() => passesGeometricGate({ position: [0, 0, 0], orientation: [0, 0, 0, 0] }, [0, 0, 1], GEOMETRY)).toThrow(
      /non-zero/,
    );
  });
});

describe("localization capture", () => {
  it.each([
    {
      type: "localization_observations_request",
      capture_policy: "robot_los_required",
      observation_count: 1,
    },
    {
      type: "localization_observations_request",
      capture_policy: "robot_los_preferred",
      observation_count: 1,
      wait_timeout_s: 2,
    },
    {
      type: "localization_observations_request",
      capture_policy: "any_angle",
      observation_count: 1,
    },
  ] as const)("captures immediately with no tracking origin under $capture_policy", async (request) => {
    const { controller, session, capture } = makeController();
    deliverRequest(session, request);
    expect(controller.view().phase).toBe("capturing");
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
    expect(controller.view().phase).toBe("awaiting_result");
  });

  it("waits for distance and look-at when it has T_odom_client under robot_los_required", async () => {
    const { controller, session, capture } = makeController();
    setOriginLookingAtRobot(session);
    deliverPose(session, [4, 0, 0]);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 1 });
    expect(controller.view().phase).toBe("waiting_for_geometric_gate");
    controller.tick();
    expect(capture.calls).toBe(0);
    deliverPose(session, [0, 0, 1]);
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
    expect(controller.view().phase).toBe("awaiting_result");
  });

  it("gates in the tracking frame when T_odom_client is not the identity", async () => {
    const { controller, session, capture } = makeController();
    deliverResult(session, [10, 0, 0]);
    deliverPose(session, [10, 0, 1]);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 1 });
    expect(controller.view().phase).toBe("capturing");
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
  });

  it("does not wait when it has T_odom_client under any_angle", async () => {
    const { controller, session, capture } = makeController();
    setOriginLookingAtRobot(session);
    deliverPose(session, [4, 0, 0]);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    expect(controller.view().phase).toBe("capturing");
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
  });

  it("captures after wait_timeout_s under robot_los_preferred if the gate never passes", async () => {
    const { controller, session, capture, clock } = makeController();
    setOriginLookingAtRobot(session);
    deliverPose(session, [4, 0, 0]);
    deliverRequest(session, {
      type: "localization_observations_request",
      capture_policy: "robot_los_preferred",
      observation_count: 1,
      wait_timeout_s: 2,
    });
    expect(controller.view().phase).toBe("waiting_for_geometric_gate");
    clock.nowS = 1.9;
    controller.tick();
    expect(capture.calls).toBe(0);
    clock.nowS = 2;
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
    expect(controller.view().phase).toBe("awaiting_result");
  });

  it("captures N frames at frameSpacingS and sends one LOCA batch", async () => {
    const { controller, session, capture, clock, transport } = makeController();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 3 });
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
    expect(transport.binaries).toHaveLength(0);
    clock.nowS = 1.4;
    controller.tick();
    expect(capture.calls).toBe(1);
    clock.nowS = 1.5;
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(2);
    clock.nowS = 3;
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(3);
    expect(transport.binaries).toHaveLength(1);
    expect(decodeLocalizationObservations(transport.binaries[0]).observations).toHaveLength(3);
    expect(controller.view().phase).toBe("awaiting_result");
  });

  it("encodes Capture camera pose unchanged", async () => {
    const { controller, session, capture, transport } = makeController();
    capture.camera_position = [1, 2, 3];
    capture.camera_orientation = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)];
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    await settleCapture();
    const encoded = decodeLocalizationObservations(transport.binaries[0]).observations[0];
    expectVec3(encoded.camera_position, [1, 2, 3]);
    expectQuat(encoded.camera_orientation, capture.camera_orientation);
  });

  it("goes idle and hasTrackingOrigin when localization_result arrives", async () => {
    const { controller, session, originStore } = makeController();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    await settleCapture();
    expect(controller.view().phase).toBe("awaiting_result");
    deliverResult(session, [1, 0, 0]);
    expect(controller.view()).toMatchObject({ phase: "idle", lastError: null });
    expect(originStore.hasTrackingOrigin).toBe(true);
    expect(session.view().hasTrackingOrigin).toBe(true);
  });

  it("fails after resultTimeoutS with no localization_result, then retries while missing T_odom_client", async () => {
    const { controller, session, capture, clock, transport } = makeController();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 1 });
    controller.tick();
    await settleCapture();
    expect(controller.view().phase).toBe("awaiting_result");
    clock.nowS = 14.9;
    controller.tick();
    expect(controller.view().phase).toBe("awaiting_result");
    clock.nowS = 15;
    controller.tick();
    expect(controller.view()).toMatchObject({ phase: "failed", lastError: "result timeout" });
    expect(startRequestCount(transport)).toBe(0);
    clock.nowS = 16.9;
    controller.tick();
    expect(startRequestCount(transport)).toBe(0);
    clock.nowS = 17;
    controller.tick();
    expect(startRequestCount(transport)).toBe(1);
    expect(controller.view()).toMatchObject({ phase: "failed", lastError: "result timeout" });
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 1 });
    expect(controller.view().phase).toBe("capturing");
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(2);
    expect(controller.view().phase).toBe("awaiting_result");
    deliverResult(session);
    expect(controller.view().phase).toBe("idle");
    clock.nowS = 50;
    controller.tick();
    expect(startRequestCount(transport)).toBe(1);
  });

  it("does not self-retry after a failure once it has T_odom_client", async () => {
    const { controller, session, clock, transport } = makeController();
    setOriginLookingAtRobot(session);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    await settleCapture();
    clock.nowS = 15;
    controller.tick();
    expect(controller.view().phase).toBe("failed");
    clock.nowS = 20;
    controller.tick();
    expect(startRequestCount(transport)).toBe(0);
    expect(controller.view().phase).toBe("failed");
  });

  it("requestStart sends while idle or failed, and is a no-op while capturing", () => {
    const { controller, session, transport } = makeController();
    controller.requestStart();
    expect(startRequestCount(transport)).toBe(1);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 2 });
    expect(controller.view().phase).toBe("capturing");
    controller.requestStart();
    expect(startRequestCount(transport)).toBe(1);
  });

  it("requestStart can ask again after a failure once it has T_odom_client", async () => {
    const { controller, session, clock, transport } = makeController();
    setOriginLookingAtRobot(session);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    await settleCapture();
    clock.nowS = 15;
    controller.tick();
    expect(controller.view().phase).toBe("failed");
    controller.requestStart();
    expect(startRequestCount(transport)).toBe(1);
    expect(controller.view().phase).toBe("failed");
  });

  it("a localization_result after failed still ends the episode", async () => {
    const { controller, session, clock } = makeController();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    await settleCapture();
    clock.nowS = 15;
    controller.tick();
    expect(controller.view().phase).toBe("failed");
    deliverResult(session);
    expect(controller.view().phase).toBe("idle");
  });

  it("fails when tracking throws while waiting for the gate", () => {
    const { controller, session, tracking } = makeController();
    setOriginLookingAtRobot(session);
    deliverPose(session, [4, 0, 0]);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 1 });
    expect(controller.view().phase).toBe("waiting_for_geometric_gate");
    tracking.failWith = new Error("no tracking");
    controller.tick();
    expect(controller.view()).toMatchObject({ phase: "failed", lastError: "no tracking" });
  });

  it("clears the episode on disconnect", () => {
    const { controller, session, capture } = makeController();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 2 });
    controller.tick();
    expect(controller.view().phase).toBe("capturing");
    expect(capture.calls).toBe(1);
    session.onTransportClose();
    expect(controller.view()).toMatchObject({ phase: "idle", lastError: null });
  });

  it("dispose unsubscribes so a later episode is the only handler", async () => {
    const { controller, session, capture, clock, originStore, tracking } = makeController();
    controller.dispose();
    const again = new LocalizationCaptureEpisode({
      session,
      clientTrackingOriginStore: originStore,
      clock,
      tracking,
      capture,
      geometry: GEOMETRY,
      config: CAPTURE_CONFIG,
    });
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    expect(controller.view().phase).toBe("idle");
    expect(again.view().phase).toBe("capturing");
    again.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
    expect(again.view().phase).toBe("awaiting_result");
  });

  it("replaces an in-flight request and sends only the new batch", async () => {
    const { controller, session, capture, transport } = makeController();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 3 });
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(1);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    expect(controller.view().phase).toBe("capturing");
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(2);
    expect(transport.binaries).toHaveLength(1);
    expect(decodeLocalizationObservations(transport.binaries[0]).observations).toHaveLength(1);
  });

  it("fails the episode when capture throws", () => {
    const { controller, session, capture } = makeController();
    capture.failWith = new Error("camera busy");
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    expect(controller.view()).toMatchObject({ phase: "failed", lastError: "camera busy" });
  });

  it("rejects missing or invalid geometry and config at construction", () => {
    const { session, originStore, clock, tracking, capture } = makeController();
    const deps = {
      session,
      clientTrackingOriginStore: originStore,
      clock,
      tracking,
      capture,
      geometry: GEOMETRY,
      config: CAPTURE_CONFIG,
    };
    expect(() => new LocalizationCaptureEpisode({ ...deps, geometry: { ...GEOMETRY, minDistanceM: 3, maxDistanceM: 3 } })).toThrow(
      /minDistanceM must be less than maxDistanceM/,
    );
    expect(() => new LocalizationCaptureEpisode({ ...deps, config: { resultTimeoutS: 0, retryBackoffS: 2 } })).toThrow(
      /resultTimeoutS/,
    );
  });

  it("robot_los_required with T_odom_client but no pose stays waiting_for_geometric_gate", () => {
    const { controller, session, capture } = makeController();
    deliverResult(session);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 1 });
    expect(controller.view().phase).toBe("waiting_for_geometric_gate");
    controller.tick();
    expect(capture.calls).toBe(0);
    expect(controller.view().phase).toBe("waiting_for_geometric_gate");
  });

  it("does not start another capture while a Promise is in flight", () => {
    const { controller, session, capture } = makeController();
    capture.defer();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 2 });
    controller.tick();
    expect(capture.calls).toBe(1);
    controller.tick();
    expect(capture.calls).toBe(1);
    expect(controller.view().phase).toBe("capturing");
  });

  it("fails the episode when capture rejects", async () => {
    const { controller, session, capture } = makeController();
    const pending = capture.defer();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    pending.reject(new Error("jpeg failed"));
    await settleCapture();
    expect(controller.view()).toMatchObject({ phase: "failed", lastError: "jpeg failed" });
    expect(capture.stopCount).toBe(1);
  });

  it("ignores a stale capture after replacement while in flight", async () => {
    const { controller, session, capture, transport } = makeController();
    const first = capture.defer();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    expect(capture.calls).toBe(1);
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    expect(controller.view().phase).toBe("capturing");
    expect(capture.startCount).toBe(1);
    first.resolve(capture.observation());
    await settleCapture();
    expect(transport.binaries).toHaveLength(0);
    expect(controller.view().phase).toBe("capturing");
    controller.tick();
    await settleCapture();
    expect(capture.calls).toBe(2);
    expect(transport.binaries).toHaveLength(1);
    expect(decodeLocalizationObservations(transport.binaries[0]).observations).toHaveLength(1);
  });

  it("ignores a stale capture after disconnect while in flight and stops hardware", async () => {
    const { controller, session, capture, transport } = makeController();
    const pending = capture.defer();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 1 });
    controller.tick();
    expect(capture.calls).toBe(1);
    session.onTransportClose();
    expect(controller.view()).toMatchObject({ phase: "idle", lastError: null });
    expect(capture.stopCount).toBe(1);
    pending.resolve(capture.observation());
    await settleCapture();
    expect(controller.view().phase).toBe("idle");
    expect(transport.binaries).toHaveLength(0);
  });

  it("dispose stops capture hardware", () => {
    const { controller, session, capture } = makeController();
    deliverRequest(session, { type: "localization_observations_request", capture_policy: "any_angle", observation_count: 2 });
    controller.tick();
    expect(capture.startCount).toBe(1);
    controller.dispose();
    expect(capture.stopCount).toBe(1);
    expect(controller.view().phase).toBe("idle");
  });

  it("capture() while stopped throws", () => {
    const capture = new FakeCapture();
    expect(() => {
      void capture.capture();
    }).toThrow(/while stopped/);
    capture.start();
    capture.stop();
    expect(() => {
      void capture.capture();
    }).toThrow(/while stopped/);
  });
});

