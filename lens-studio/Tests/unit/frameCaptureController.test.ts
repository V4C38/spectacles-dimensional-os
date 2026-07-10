import { describe, it, expect } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  CameraStreamSession,
  STREAM_GATE_DEBOUNCE_S,
  evaluateOptionalGeometricGates,
  evaluateOptionalSpeedGate,
  resolveHardwareTransition,
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

/** Mirrors production speed-based arming in FrameCaptureController. */
function createSpeedArmingHarness() {
  const session = new CameraStreamSession();
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
    onRegistrationStart: () => session.startRegistration(),
    onRegistrationEnd: () => session.requestStreamStop(),
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

  it("optional geometric gates pass when policy is not applied", () => {
    expect(
      evaluateOptionalGeometricGates(
        origin,
        identityRot,
        robotFar,
        35,
        300,
        false,
      ),
    ).toBe(true);
  });

  it("optional geometric gates enforce distance when pose and policy exist", () => {
    expect(
      evaluateOptionalGeometricGates(
        origin,
        identityRot,
        robotNear,
        35,
        300,
        true,
      ),
    ).toBe(true);
    expect(
      evaluateOptionalGeometricGates(
        origin,
        identityRot,
        robotFar,
        35,
        300,
        true,
      ),
    ).toBe(false);
  });

  it("optional speed gate passes when speed is unknown", () => {
    expect(evaluateOptionalSpeedGate(null, 0.45, true)).toBe(true);
  });

  it("optional speed gate passes when policy is not applied", () => {
    expect(evaluateOptionalSpeedGate(1.0, 0.45, false)).toBe(true);
  });

  it("optional speed gate blocks above policy max", () => {
    expect(evaluateOptionalSpeedGate(1.0, 0.45, true)).toBe(false);
    expect(evaluateOptionalSpeedGate(0.2, 0.45, true)).toBe(true);
  });
});

describe("FrameCaptureController speed arming", () => {
  it("movement arms tracking_motion when committed", () => {
    const harness = createSpeedArmingHarness();
    harness.setCommitted(true);
    harness.onPose(0.0);
    harness.onPose(0.2);
    expect(harness.session.requestActive).toBe(true);
    expect(harness.session.phase).toBe("tracking_motion");
  });

  it("stop edge arms refining_stop when committed", () => {
    const harness = createSpeedArmingHarness();
    harness.setCommitted(true);
    harness.onPose(0.2);
    harness.onPose(0.0);
    expect(harness.session.requestActive).toBe(true);
    expect(harness.session.phase).toBe("refining_stop");
  });

  it("does not arm runtime capture before world frame commit", () => {
    const harness = createSpeedArmingHarness();
    harness.onPose(0.2);
    expect(harness.session.requestActive).toBe(false);
  });

  it("registration end disarms to off", () => {
    const harness = createSpeedArmingHarness();
    harness.onRegistrationStart();
    harness.onRegistrationEnd();
    expect(harness.session.requestActive).toBe(false);
    expect(harness.session.phase).toBe("off");
  });
});

describe("FrameCaptureController hardware lifecycle", () => {
  it("gate pause keeps request active with hardware off and waiting status", () => {
    const session = new CameraStreamSession();
    session.applyPolicy(samplePolicy);
    session.startStopRefinement();
    session.evaluate(allGatesPass(), 0);

    const failAt = 1.0;
    session.evaluate(allGatesPass({ geometricGatesPass: false }), failAt);
    const evalResult = session.evaluate(
      allGatesPass({ geometricGatesPass: false }),
      failAt + STREAM_GATE_DEBOUNCE_S + 0.01,
    );

    const transition = resolveHardwareTransition({
      evalHardwareEnabled: evalResult.hardwareEnabled,
      requestActive: evalResult.requestActive,
      hardwareCurrentlyEnabled: true,
      pendingHardwareOff: false,
      hasInFlightCapture: false,
    });

    expect(evalResult.requestActive).toBe(true);
    expect(transition.targetHardwareEnabled).toBe(false);
    expect(transition.displayStatus).toBe("waiting");
    expect(transition.stopIsLifecycleEnd).toBe(false);
  });

  it("refinement_complete disarms with lifecycle stop", () => {
    const session = new CameraStreamSession();
    session.applyPolicy(samplePolicy);
    session.startStopRefinement();
    session.evaluate(allGatesPass(), 0);
    session.onFrameAck(true, true);

    const evalResult = session.evaluate(allGatesPass(), 1.0);
    const transition = resolveHardwareTransition({
      evalHardwareEnabled: evalResult.hardwareEnabled,
      requestActive: evalResult.requestActive,
      hardwareCurrentlyEnabled: true,
      pendingHardwareOff: false,
      hasInFlightCapture: false,
    });

    expect(evalResult.requestActive).toBe(false);
    expect(transition.stopIsLifecycleEnd).toBe(true);
    expect(transition.displayStatus).toBe("off");
  });

  it("gate recovery resumes without resetting accepted observations", () => {
    const session = new CameraStreamSession();
    session.applyPolicy(samplePolicy);
    session.startStopRefinement();
    session.evaluate(allGatesPass(), 0);
    session.onFrameAck(true);
    expect(session.obsAccepted).toBe(1);

    const failAt = 1.0;
    session.evaluate(
      allGatesPass({ geometricGatesPass: false }),
      failAt + STREAM_GATE_DEBOUNCE_S + 0.01,
    );
    session.evaluate(allGatesPass(), failAt + STREAM_GATE_DEBOUNCE_S + 0.5);

    expect(session.requestActive).toBe(true);
    expect(session.obsAccepted).toBe(1);
  });
});
