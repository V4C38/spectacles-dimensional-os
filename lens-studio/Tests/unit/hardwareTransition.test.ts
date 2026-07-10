import { describe, it, expect } from "vitest";
import {
  cameraStreamLogStatus,
  resolveHardwareTransition,
} from "../../Assets/Scripts/ARBridge/Camera/CameraStreamSession";

describe("resolveHardwareTransition", () => {
  it("keeps hardware off when armed but gates fail", () => {
    const result = resolveHardwareTransition({
      evalHardwareEnabled: false,
      requestActive: true,
      hardwareCurrentlyEnabled: false,
      pendingHardwareOff: false,
      hasInFlightCapture: false,
    });

    expect(result.targetHardwareEnabled).toBe(false);
    expect(result.captureEnabled).toBe(false);
    expect(result.displayStatus).toBe("waiting");
    expect(result.stopIsLifecycleEnd).toBe(false);
  });

  it("drains in-flight capture before turning hardware off", () => {
    const draining = resolveHardwareTransition({
      evalHardwareEnabled: false,
      requestActive: true,
      hardwareCurrentlyEnabled: true,
      pendingHardwareOff: false,
      hasInFlightCapture: true,
    });
    expect(draining.targetHardwareEnabled).toBe(true);
    expect(draining.nextPendingHardwareOff).toBe(true);
    expect(draining.captureEnabled).toBe(true);
    expect(draining.displayStatus).toBe("on");

    const stopped = resolveHardwareTransition({
      evalHardwareEnabled: false,
      requestActive: true,
      hardwareCurrentlyEnabled: true,
      pendingHardwareOff: true,
      hasInFlightCapture: false,
    });
    expect(stopped.targetHardwareEnabled).toBe(false);
    expect(stopped.nextPendingHardwareOff).toBe(false);
    expect(stopped.displayStatus).toBe("waiting");
  });

  it("marks lifecycle end when disarming with hardware on", () => {
    const result = resolveHardwareTransition({
      evalHardwareEnabled: false,
      requestActive: false,
      hardwareCurrentlyEnabled: true,
      pendingHardwareOff: false,
      hasInFlightCapture: false,
    });

    expect(result.targetHardwareEnabled).toBe(false);
    expect(result.displayStatus).toBe("off");
    expect(result.stopIsLifecycleEnd).toBe(true);
  });

  it("does not keep hardware on merely because a request is active", () => {
    const result = resolveHardwareTransition({
      evalHardwareEnabled: false,
      requestActive: true,
      hardwareCurrentlyEnabled: true,
      pendingHardwareOff: false,
      hasInFlightCapture: false,
    });

    expect(result.targetHardwareEnabled).toBe(false);
    expect(result.displayStatus).toBe("waiting");
  });
});

describe("cameraStreamLogStatus", () => {
  it("maps device running state to ON, armed idle to Waiting, and disarmed to OFF", () => {
    expect(cameraStreamLogStatus(true, true)).toBe("on");
    expect(cameraStreamLogStatus(true, false)).toBe("on");
    expect(cameraStreamLogStatus(false, true)).toBe("waiting");
    expect(cameraStreamLogStatus(false, false)).toBe("off");
  });
});
