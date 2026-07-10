import { describe, it, expect } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  CameraStreamSession,
  STREAM_GATE_DEBOUNCE_S,
  evaluateGeometricGates,
  evaluateStreamGeometricGates,
  isLookingAtTarget,
  isWithinStreamDistance,
} from "../../Assets/Scripts/ARBridge/Camera/CameraStreamSession";
import { CapturePolicyMessage } from "../../Assets/Scripts/ARBridge/Network/Protocol";

const origin = new vec3(0, 0, 0);
const identityRot = quat.quatIdentity();
const robotNear = new vec3(0, 0, -200);
const robotFar = new vec3(0, 0, -400);

const samplePolicy: CapturePolicyMessage = {
  type: "capture_policy",
  ts: 1,
  max_stream_distance_m: 3.0,
  min_stream_distance_m: 0.35,
  max_capture_speed_mps: 0.45,
  static_speed_mps: 0.05,
  min_observations: 3,
};

function allGatesPass(overrides: Partial<{
  bridgeConnected: boolean;
  posesReady: boolean;
  geometricGatesPass: boolean;
  speedGatePass: boolean;
}> = {}) {
  return {
    bridgeConnected: true,
    posesReady: true,
    geometricGatesPass: true,
    speedGatePass: true,
    ...overrides,
  };
}

function applyPolicy(session: CameraStreamSession): void {
  session.applyPolicy(samplePolicy);
}

describe("CameraStreamSession request replace", () => {
  it("requestStreamStart(0) overrides pending limited budget", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.requestStreamStart(3);
    session.requestStreamStart(0);
    session.onFrameAck(true);
    session.onFrameAck(true);
    expect(session.requestActive).toBe(true);
  });

  it("requestStreamStop is idempotent", () => {
    const session = new CameraStreamSession();
    session.requestStreamStop();
    session.requestStreamStop();
    expect(session.requestActive).toBe(false);
    expect(session.hardwareEnabled).toBe(false);
  });
});

describe("CameraStreamSession observation budget", () => {
  it("stops only when bridge reports a completed refinement", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.startStopRefinement();
    session.evaluate(allGatesPass(), 0);
    session.onFrameAck(false);
    session.onFrameAck(false);
    expect(session.requestActive).toBe(true);
    session.onFrameAck(true);
    session.onFrameAck(true);
    expect(session.requestActive).toBe(true);
    session.onFrameAck(true, true);
    expect(session.requestActive).toBe(false);
  });

  it("unlimited budget stays active", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.requestStreamStart(0);
    session.onFrameAck(true);
    session.onFrameAck(false);
    expect(session.requestActive).toBe(true);
  });
});

describe("CameraStreamSession geometric debounce", () => {
  it("brief gate failure does not pause", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.requestStreamStart(0);
    session.evaluate(allGatesPass(), 0);
    expect(session.hardwareEnabled).toBe(true);

    session.evaluate(allGatesPass({ geometricGatesPass: false }), 0.5);
    expect(session.hardwareEnabled).toBe(true);

    session.evaluate(allGatesPass(), 1.0);
    expect(session.hardwareEnabled).toBe(true);
  });

  it("sustained look-away pauses then resumes with accepted count preserved", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.startStopRefinement();
    session.evaluate(allGatesPass(), 0);
    session.onFrameAck(true);

    const failAt = 1.0;
    session.evaluate(allGatesPass({ geometricGatesPass: false }), failAt);
    session.evaluate(
      allGatesPass({ geometricGatesPass: false }),
      failAt + STREAM_GATE_DEBOUNCE_S + 0.01,
    );
    expect(session.hardwareEnabled).toBe(false);
    expect(session.requestActive).toBe(true);

    session.evaluate(allGatesPass(), failAt + STREAM_GATE_DEBOUNCE_S + 0.5);
    expect(session.hardwareEnabled).toBe(true);
    session.onFrameAck(true);
    session.onFrameAck(true, true);
    expect(session.requestActive).toBe(false);
  });

  it("speed gate blocks streaming above max_capture_speed_mps", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.requestStreamStart(0);
    const result = session.evaluate(
      allGatesPass({ speedGatePass: false }),
      0,
    );
    expect(result.hardwareEnabled).toBe(false);
    expect(result.requestActive).toBe(true);
  });
});

describe("CameraStreamSession pause/resume prerequisites", () => {
  it("stays off without bridge connection", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.requestStreamStart(0);
    const result = session.evaluate(
      allGatesPass({ bridgeConnected: false }),
      0,
    );
    expect(result.hardwareEnabled).toBe(false);
    expect(result.requestActive).toBe(true);
  });

  it("starts when bridge is connected and geometric gates pass without robot pose", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    session.requestStreamStart(0);
    const result = session.evaluate(
      {
        bridgeConnected: true,
        posesReady: true,
        geometricGatesPass: true,
        speedGatePass: true,
      },
      0,
    );
    expect(result.hardwareEnabled).toBe(true);
  });
});

describe("CameraStreamSession applyPolicy", () => {
  it("sets distance gate values from bridge policy", () => {
    const session = new CameraStreamSession();
    applyPolicy(session);
    expect(session.minObs).toBe(3);
    expect(session.maxSpeedMps).toBe(0.45);
    expect(session.getDistanceGateCm()).toEqual({
      minDistanceCm: 35,
      maxDistanceCm: 300,
    });
  });
});

describe("geometric helpers", () => {
  it("evaluateStreamGeometricGates passes when robot pose is unknown", () => {
    expect(
      evaluateStreamGeometricGates(origin, identityRot, null, 35, 300),
    ).toBe(true);
  });

  it("evaluateStreamGeometricGates enforces gates once robot pose is known", () => {
    expect(
      evaluateStreamGeometricGates(origin, identityRot, robotNear, 35, 300),
    ).toBe(true);
    expect(
      evaluateStreamGeometricGates(origin, identityRot, robotFar, 35, 300),
    ).toBe(false);
  });

  it("evaluateGeometricGates requires distance and look-at", () => {
    expect(
      evaluateGeometricGates(origin, identityRot, robotNear, 35, 300),
    ).toBe(true);
    expect(
      evaluateGeometricGates(origin, identityRot, robotFar, 35, 300),
    ).toBe(false);
    expect(
      evaluateGeometricGates(origin, identityRot, new vec3(200, 0, 0), 35, 300),
    ).toBe(false);
  });

  it("isWithinStreamDistance enforces min and max", () => {
    expect(isWithinStreamDistance(origin, new vec3(0, 0, -200), 35, 300)).toBe(
      true,
    );
    expect(isWithinStreamDistance(origin, new vec3(0, 0, -10), 35, 300)).toBe(
      false,
    );
    expect(isWithinStreamDistance(origin, new vec3(0, 0, -301), 35, 300)).toBe(
      false,
    );
  });

  it("isLookingAtTarget enforces 45 degree cone", () => {
    expect(isLookingAtTarget(origin, identityRot, new vec3(0, 0, -100))).toBe(
      true,
    );
    expect(isLookingAtTarget(origin, identityRot, new vec3(200, 0, 0))).toBe(
      false,
    );
  });
});
