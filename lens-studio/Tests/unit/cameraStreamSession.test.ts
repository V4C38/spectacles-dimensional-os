import { describe, it, expect } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  CameraStreamSession,
  STREAM_GATE_DEBOUNCE_S,
  STREAM_MAX_DISTANCE_CM,
  evaluateGeometricGates,
  evaluateStreamGeometricGates,
  isLookingAtTarget,
  isWithinStreamDistance,
} from "../../Assets/Scripts/ARBridge/Camera/CameraStreamSession";

const origin = new vec3(0, 0, 0);
const identityRot = quat.quatIdentity();
const robotNear = new vec3(0, 0, -200);
const robotFar = new vec3(0, 0, -400);

function allGatesPass(overrides: Partial<{
  bridgeConnected: boolean;
  posesReady: boolean;
  geometricGatesPass: boolean;
}> = {}) {
  return {
    bridgeConnected: true,
    posesReady: true,
    geometricGatesPass: true,
    ...overrides,
  };
}

describe("CameraStreamSession request replace", () => {
  it("requestStreamStart(0) overrides pending limited budget", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(2);
    session.requestStreamStart(0);
    session.onFrameAck();
    session.onFrameAck();
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

describe("CameraStreamSession frame budget", () => {
  it("auto-stops after N ACKs", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(2);
    session.evaluate(allGatesPass(), 0);
    session.onFrameAck();
    expect(session.requestActive).toBe(true);
    session.onFrameAck();
    expect(session.requestActive).toBe(false);
  });

  it("unlimited budget stays active", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(0);
    session.onFrameAck();
    session.onFrameAck();
    expect(session.requestActive).toBe(true);
  });
});

describe("CameraStreamSession geometric debounce", () => {
  it("brief gate failure does not pause", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(0);
    session.evaluate(allGatesPass(), 0);
    expect(session.hardwareEnabled).toBe(true);

    session.evaluate(allGatesPass({ geometricGatesPass: false }), 0.5);
    expect(session.hardwareEnabled).toBe(true);

    session.evaluate(allGatesPass(), 1.0);
    expect(session.hardwareEnabled).toBe(true);
  });

  it("sustained look-away pauses then resumes", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(0);
    session.evaluate(allGatesPass(), 0);
    expect(session.hardwareEnabled).toBe(true);

    const failAt = 1.0;
    session.evaluate(allGatesPass({ geometricGatesPass: false }), failAt);
    session.evaluate(
      allGatesPass({ geometricGatesPass: false }),
      failAt + STREAM_GATE_DEBOUNCE_S + 0.01,
    );
    expect(session.hardwareEnabled).toBe(false);

    session.evaluate(allGatesPass(), failAt + STREAM_GATE_DEBOUNCE_S + 0.5);
    expect(session.hardwareEnabled).toBe(true);
  });

  it("sustained too-far pauses then resumes", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(0);
    session.evaluate(allGatesPass(), 0);

    const failAt = 2.0;
    session.evaluate(allGatesPass({ geometricGatesPass: false }), failAt);
    session.evaluate(
      allGatesPass({ geometricGatesPass: false }),
      failAt + STREAM_GATE_DEBOUNCE_S + 0.01,
    );
    expect(session.hardwareEnabled).toBe(false);

    session.evaluate(allGatesPass(), failAt + STREAM_GATE_DEBOUNCE_S + 1.0);
    expect(session.hardwareEnabled).toBe(true);
  });
});

describe("CameraStreamSession pause/resume prerequisites", () => {
  it("stays off without bridge connection", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(0);
    const result = session.evaluate(
      allGatesPass({ bridgeConnected: false }),
      0,
    );
    expect(result.hardwareEnabled).toBe(false);
    expect(result.requestActive).toBe(true);
  });

  it("stays off until camera pose is ready", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(0);
    const result = session.evaluate(
      allGatesPass({ posesReady: false }),
      0,
    );
    expect(result.hardwareEnabled).toBe(false);
  });

  it("starts when bridge is connected and geometric gates pass without robot pose", () => {
    const session = new CameraStreamSession();
    session.requestStreamStart(0);
    const result = session.evaluate(
      {
        bridgeConnected: true,
        posesReady: true,
        geometricGatesPass: true,
      },
      0,
    );
    expect(result.hardwareEnabled).toBe(true);
  });
});

describe("geometric helpers", () => {
  it("evaluateStreamGeometricGates passes when robot pose is unknown", () => {
    expect(evaluateStreamGeometricGates(origin, identityRot, null)).toBe(true);
  });

  it("evaluateStreamGeometricGates enforces gates once robot pose is known", () => {
    expect(evaluateStreamGeometricGates(origin, identityRot, robotNear)).toBe(true);
    expect(evaluateStreamGeometricGates(origin, identityRot, robotFar)).toBe(false);
  });

  it("evaluateGeometricGates requires distance and look-at", () => {
    expect(evaluateGeometricGates(origin, identityRot, robotNear)).toBe(true);
    expect(evaluateGeometricGates(origin, identityRot, robotFar)).toBe(false);
    expect(
      evaluateGeometricGates(origin, identityRot, new vec3(200, 0, 0)),
    ).toBe(false);
  });

  it("isWithinStreamDistance enforces 3 m", () => {
    expect(isWithinStreamDistance(origin, new vec3(0, 0, -299))).toBe(true);
    expect(
      isWithinStreamDistance(origin, new vec3(0, 0, -(STREAM_MAX_DISTANCE_CM + 1))),
    ).toBe(false);
  });

  it("isLookingAtTarget enforces 45 degree cone", () => {
    expect(isLookingAtTarget(origin, identityRot, new vec3(0, 0, -100))).toBe(true);
    expect(isLookingAtTarget(origin, identityRot, new vec3(200, 0, 0))).toBe(false);
  });
});
