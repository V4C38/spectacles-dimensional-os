import { describe, expect, it } from "vitest";
import {
  CameraCaptureSession,
  isRobotMoving,
} from "../../Assets/Scripts/ARBridge/Camera/CameraCaptureSession";
import { CapturePolicyMessage } from "../../Assets/Scripts/ARBridge/Network/Protocol";

const samplePolicy: CapturePolicyMessage = {
  type: "capture_policy",
  ts: 1,
  max_capture_distance_m: 3.0,
  min_capture_distance_m: 0.35,
  max_capture_speed_mps: 0.45,
  static_speed_mps: 0.05,
  min_observations: 3,
};

describe("isRobotMoving", () => {
  it("detects movement above static threshold", () => {
    expect(isRobotMoving(0.5, 0.05)).toBe(true);
    expect(isRobotMoving(0.06, 0.05)).toBe(true);
    expect(isRobotMoving(null, 0.05)).toBe(false);
  });

  it("treats speeds at or below threshold as stopped", () => {
    expect(isRobotMoving(0.05, 0.05)).toBe(false);
    expect(isRobotMoving(0.0, 0.05)).toBe(false);
  });
});

describe("onSpeedChanged", () => {
  it("arms unbounded capture on start edge when policy is applied", () => {
    const session = new CameraCaptureSession();
    session.applyPolicy(samplePolicy);
    session.onSpeedChanged(0.0, 0.2);
    expect(session.obsBudget).toBe(0);
  });

  it("arms budgeted capture on stop edge when policy is applied", () => {
    const session = new CameraCaptureSession();
    session.applyPolicy(samplePolicy);
    session.onSpeedChanged(0.2, 0.0);
    expect(session.obsBudget).toBe(3);
  });
});
