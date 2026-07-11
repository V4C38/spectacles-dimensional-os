import { describe, it, expect } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  CameraCaptureSession,
  CAPTURE_GATE_DEBOUNCE_S,
  deriveCameraCapture,
  evaluateOptionalGeometricGates,
  evaluateOptionalSpeedGate,
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

function createSpeedArmingHarness() {
  const session = new CameraCaptureSession();
  session.applyPolicy(samplePolicy);
  let worldFrameCommitted = false;
  let lastSpeedMps: number | null = null;

  function onPose(speedMps: number | null): void {
    if (worldFrameCommitted) {
      session.onSpeedChanged(lastSpeedMps, speedMps);
    }
    lastSpeedMps = speedMps;
  }

  return {
    session,
    onPose,
    setCommitted: (committed: boolean) => {
      worldFrameCommitted = committed;
    },
    onRegistrationStart: () => session.beginCameraCapture(),
    onRegistrationEnd: () => session.endCameraCapture(),
  };
}

describe("FrameCaptureController capture semantics", () => {
  it("optional geometric gates pass when robot pose is unknown", () => {
    expect(
      evaluateOptionalGeometricGates(
        origin,
        identityRot,
        null,
        35,
        300,
        true,
      ),
    ).toBe(true);
  });

  it("optional speed gate blocks above policy max", () => {
    expect(evaluateOptionalSpeedGate(1.0, 0.45, true)).toBe(false);
    expect(evaluateOptionalSpeedGate(0.2, 0.45, true)).toBe(true);
  });
});

describe("FrameCaptureController speed arming", () => {
  it("movement arms unbounded capture when committed", () => {
    const harness = createSpeedArmingHarness();
    harness.setCommitted(true);
    harness.onPose(0.0);
    harness.onPose(0.2);
    expect(harness.session.obsBudget).toBe(0);
  });

  it("stop edge arms budgeted capture when committed", () => {
    const harness = createSpeedArmingHarness();
    harness.setCommitted(true);
    harness.onPose(0.2);
    harness.onPose(0.0);
    expect(harness.session.obsBudget).toBe(3);
  });

  it("does not arm runtime capture before world frame commit", () => {
    const harness = createSpeedArmingHarness();
    harness.onPose(0.2);
    expect(harness.session.obsBudget).toBeNull();
  });

  it("registration end disarms capture", () => {
    const harness = createSpeedArmingHarness();
    harness.onRegistrationStart();
    harness.onRegistrationEnd();
    expect(harness.session.obsBudget).toBeNull();
  });
});

describe("FrameCaptureController capture state", () => {
  it("gate pause keeps intent with waiting state", () => {
    const session = new CameraCaptureSession();
    session.applyPolicy(samplePolicy);
    session.beginCameraCapture(3);
    const gates = {
      bridgeConnected: true,
      posesReady: true,
      geometricGatesPass: true,
      speedGatePass: true,
      hasInFlightCapture: false,
    };
    session.updateGateDebounce(gates, 0);
    const failingGates = { ...gates, geometricGatesPass: false };
    const failAt = 1.0;
    session.updateGateDebounce(failingGates, failAt);
    const afterDebounce = failAt + CAPTURE_GATE_DEBOUNCE_S + 0.01;
    session.updateGateDebounce(failingGates, afterDebounce);
    expect(
      deriveCameraCapture(session.getFacts(), failingGates, afterDebounce),
    ).toBe("waiting");
    expect(session.obsBudget).toBe(3);
  });

  it("capturing_budgeted_complete disarms capture", () => {
    const session = new CameraCaptureSession();
    session.applyPolicy(samplePolicy);
    session.beginCameraCapture(3);
    session.onFrameAck({
      type: "camera_frame_ack",
      ts: 1,
      seq: 1,
      capturing_budgeted_complete: true,
    });
    expect(session.obsBudget).toBeNull();
    expect(deriveCameraCapture(session.getFacts(), {
      bridgeConnected: true,
      posesReady: true,
      geometricGatesPass: true,
      speedGatePass: true,
      hasInFlightCapture: false,
    }, 1)).toBe("off");
  });
});
