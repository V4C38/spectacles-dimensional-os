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
  let appPhase: "registration" | "runtime" = "registration";
  let lastSpeedMps: number | null = null;

  function runtimeCaptureArmed(): boolean {
    return appPhase === "runtime" && worldFrameCommitted;
  }

  function onPose(speedMps: number | null): void {
    if (runtimeCaptureArmed()) {
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
    setPhase: (phase: "registration" | "runtime") => {
      appPhase = phase;
    },
    onRegistrationStart: () => {
      session.endCameraCapture();
      session.beginCameraCapture();
    },
    onRegistrationEnd: () => session.endCameraCapture(),
    resetCapturePipeline: () => {
      lastSpeedMps = null;
      session.endCameraCapture();
    },
  };
}

function registrationGeometricGatesPass(
  worldFrameCommitted: boolean,
  robotWorldPos: vec3 | null,
): boolean {
  const useRuntimeGates = worldFrameCommitted;
  return evaluateOptionalGeometricGates(
    origin,
    identityRot,
    useRuntimeGates ? robotWorldPos : null,
    35,
    300,
    true,
  );
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
    harness.setPhase("runtime");
    harness.setCommitted(true);
    harness.onPose(0.0);
    harness.onPose(0.2);
    expect(harness.session.obsBudget).toBe(0);
  });

  it("stop edge arms budgeted capture when committed", () => {
    const harness = createSpeedArmingHarness();
    harness.setPhase("runtime");
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

  it("does not arm capture from telemetry during registration even when committed", () => {
    const harness = createSpeedArmingHarness();
    harness.setPhase("registration");
    harness.setCommitted(true);
    harness.onPose(0.2);
    expect(harness.session.obsBudget).toBeNull();
  });

  it("arms capture from telemetry during runtime when committed", () => {
    const harness = createSpeedArmingHarness();
    harness.setPhase("runtime");
    harness.setCommitted(true);
    harness.onPose(0.0);
    harness.onPose(0.2);
    expect(harness.session.obsBudget).toBe(0);
  });

  it("registration restart clears pre-armed capture intent", () => {
    const harness = createSpeedArmingHarness();
    harness.setPhase("runtime");
    harness.setCommitted(true);
    harness.onPose(0.0);
    harness.onPose(0.2);
    expect(harness.session.obsBudget).toBe(0);

    harness.resetCapturePipeline();
    harness.setPhase("registration");
    harness.setCommitted(false);
    harness.onRegistrationStart();
    expect(harness.session.obsBudget).toBe(0);
  });
});

describe("FrameCaptureController capture state", () => {
  it("registration phase ignores committed snapshot for geometric gates", () => {
    expect(registrationGeometricGatesPass(false, robotFar)).toBe(true);
  });

  it("runtime phase enforces geometric gates when committed", () => {
    expect(registrationGeometricGatesPass(true, robotFar)).toBe(false);
    expect(registrationGeometricGatesPass(true, robotNear)).toBe(true);
  });

  it("registration status re-arm resets gate debounce after end+begin", () => {
    const session = new CameraCaptureSession();
    session.beginCameraCapture(0);
    const failingGates = {
      bridgeConnected: true,
      posesReady: true,
      geometricGatesPass: false,
      speedGatePass: true,
      hasInFlightCapture: false,
    };
    const passGates = { ...failingGates, geometricGatesPass: true };
    session.updateGateDebounce(passGates, 0);
    const failAt = 1.0;
    session.updateGateDebounce(failingGates, failAt);
    const afterDebounce = failAt + CAPTURE_GATE_DEBOUNCE_S + 0.01;
    session.updateGateDebounce(failingGates, afterDebounce);
    expect(
      deriveCameraCapture(session.getFacts(), failingGates, afterDebounce),
    ).toBe("waiting");

    session.endCameraCapture();
    session.beginCameraCapture(0);
    session.updateGateDebounce(passGates, afterDebounce + 1);
    expect(
      deriveCameraCapture(session.getFacts(), passGates, afterDebounce + 1),
    ).toBe("capturing");
  });

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
