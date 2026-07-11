import { describe, it, expect } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  CameraCaptureSession,
  CAPTURE_GATE_DEBOUNCE_S,
  deriveCameraCapture,
  evaluateCaptureGeometricGates,
  evaluateGeometricGates,
  isLookingAtTarget,
  isWithinCaptureDistance,
} from "../../Assets/Scripts/ARBridge/Camera/CameraCaptureSession";
import { CapturePolicyMessage } from "../../Assets/Scripts/ARBridge/Network/Protocol";

const origin = new vec3(0, 0, 0);
const identityRot = quat.quatIdentity();
const robotNear = new vec3(0, 0, -200);
const robotFar = new vec3(0, 0, -400);

const samplePolicy: CapturePolicyMessage = {
  type: "capture_policy",
  ts: 1,
  max_capture_distance_m: 3.0,
  min_capture_distance_m: 0.35,
  max_capture_speed_mps: 0.45,
  static_speed_mps: 0.05,
  min_observations: 3,
};

function allGatesPass(overrides: Partial<{
  bridgeConnected: boolean;
  posesReady: boolean;
  geometricGatesPass: boolean;
  speedGatePass: boolean;
  hasInFlightCapture: boolean;
}> = {}) {
  return {
    bridgeConnected: true,
    posesReady: true,
    geometricGatesPass: true,
    speedGatePass: true,
    hasInFlightCapture: false,
    ...overrides,
  };
}

function applyPolicy(session: CameraCaptureSession): void {
  session.applyPolicy(samplePolicy);
}

function derive(
  session: CameraCaptureSession,
  gates: ReturnType<typeof allGatesPass>,
  now: number,
): ReturnType<typeof deriveCameraCapture> {
  session.updateGateDebounce(gates, now);
  return deriveCameraCapture(session.getFacts(), gates, now);
}

describe("CameraCaptureSession beginCameraCapture", () => {
  it("beginCameraCapture() overrides pending budgeted capture", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture(3);
    session.beginCameraCapture();
    expect(session.obsBudget).toBe(0);
  });

  it("endCameraCapture is idempotent", () => {
    const session = new CameraCaptureSession();
    session.endCameraCapture();
    session.endCameraCapture();
    expect(session.obsBudget).toBeNull();
  });
});

describe("CameraCaptureSession budgeted completion", () => {
  it("ends only when bridge reports capturing_budgeted_complete", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture(3);
    session.onFrameAck({
      type: "camera_frame_ack",
      ts: 1,
      seq: 1,
      capturing_budgeted_complete: false,
    });
    expect(session.obsBudget).toBe(3);
    session.onFrameAck({
      type: "camera_frame_ack",
      ts: 2,
      seq: 2,
      capturing_budgeted_complete: true,
    });
    expect(session.obsBudget).toBeNull();
  });

  it("unbounded capture stays active without completion ack", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture();
    session.onFrameAck({
      type: "camera_frame_ack",
      ts: 1,
      seq: 1,
      capturing_budgeted_complete: false,
    });
    expect(session.obsBudget).toBe(0);
  });
});

describe("deriveCameraCapture", () => {
  it("returns off when not armed", () => {
    const session = new CameraCaptureSession();
    expect(derive(session, allGatesPass(), 0)).toBe("off");
  });

  it("returns waiting when armed but gates fail", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture();
    expect(
      derive(session, allGatesPass({ geometricGatesPass: false }), 0),
    ).toBe("waiting");
  });

  it("returns capturing when unbounded and gates pass", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture();
    expect(derive(session, allGatesPass(), 0)).toBe("capturing");
  });

  it("returns capturing_budgeted when budgeted and gates pass", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture(3);
    expect(derive(session, allGatesPass(), 0)).toBe("capturing_budgeted");
  });

  it("brief gate failure stays capturing during debounce", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture();
    expect(derive(session, allGatesPass(), 0)).toBe("capturing");
    expect(
      derive(session, allGatesPass({ geometricGatesPass: false }), 0.5),
    ).toBe("capturing");
    expect(derive(session, allGatesPass(), 1.0)).toBe("capturing");
  });

  it("sustained gate failure becomes waiting", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture();
    derive(session, allGatesPass(), 0);
    const failAt = 1.0;
    derive(session, allGatesPass({ geometricGatesPass: false }), failAt);
    expect(
      derive(
        session,
        allGatesPass({ geometricGatesPass: false }),
        failAt + CAPTURE_GATE_DEBOUNCE_S + 0.01,
      ),
    ).toBe("waiting");
  });

  it("pendingDrain keeps active state while in flight", () => {
    const session = new CameraCaptureSession();
    applyPolicy(session);
    session.beginCameraCapture();
    derive(session, allGatesPass(), 0);
    derive(
      session,
      allGatesPass({ geometricGatesPass: false, hasInFlightCapture: true }),
      1.0,
    );
    session.updatePendingDrain("waiting", true);
    expect(derive(session, allGatesPass({ geometricGatesPass: false }), 1.0)).toBe(
      "capturing",
    );
  });
});

describe("CameraCaptureSession applyPolicy", () => {
  it("sets distance gate values from bridge policy", () => {
    const session = new CameraCaptureSession();
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
  it("evaluateCaptureGeometricGates passes when robot pose is unknown", () => {
    expect(
      evaluateCaptureGeometricGates(origin, identityRot, null, 35, 300),
    ).toBe(true);
  });

  it("evaluateCaptureGeometricGates enforces gates once robot pose is known", () => {
    expect(
      evaluateCaptureGeometricGates(origin, identityRot, robotNear, 35, 300),
    ).toBe(true);
    expect(
      evaluateCaptureGeometricGates(origin, identityRot, robotFar, 35, 300),
    ).toBe(false);
  });

  it("isWithinCaptureDistance enforces min and max", () => {
    expect(isWithinCaptureDistance(origin, new vec3(0, 0, -200), 35, 300)).toBe(
      true,
    );
    expect(isWithinCaptureDistance(origin, new vec3(0, 0, -10), 35, 300)).toBe(
      false,
    );
  });
});
