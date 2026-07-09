import { describe, it, expect } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  computeCameraPolicy,
  CameraPolicyDynamicInput,
  CameraPolicyStaticContext,
  CameraStreamLatch,
  isLookingAtTarget,
  isRobotMoving,
  isRobotStopped,
  isWithinStreamDistance,
  RUNTIME_STREAM_MAX_DISTANCE_CM,
  RUNTIME_STOP_SPEED_MPS,
  shouldLogStreamOffReason,
} from "../../Assets/Scripts/ARBridge/Camera/CameraStreamPolicy";
import { CaptureHint } from "../../Assets/Scripts/ARBridge/Network/Protocol";

const origin = new vec3(0, 0, 0);
const identityRot = quat.quatIdentity();
const robotNear = new vec3(0, 0, -200);
const robotFar = new vec3(0, 0, -400);

function emptyDynamic(
  overrides: Partial<CameraPolicyDynamicInput> = {},
): CameraPolicyDynamicInput {
  return {
    robotWorldPos: null,
    cameraPos: null,
    cameraRot: null,
    robotSpeedMps: null,
    correctionSinceLastMovement: false,
    ...overrides,
  };
}

function runtimeDynamic(
  overrides: Partial<CameraPolicyDynamicInput> = {},
): CameraPolicyDynamicInput {
  return emptyDynamic({
    robotWorldPos: robotNear,
    cameraPos: origin,
    cameraRot: identityRot,
    robotSpeedMps: 0.2,
    correctionSinceLastMovement: false,
    ...overrides,
  });
}

function runtimeStatic(
  overrides: Partial<CameraPolicyStaticContext> = {},
): CameraPolicyStaticContext {
  return {
    forceOff: false,
    appPhase: "runtime",
    tagCaptureSessionActive: false,
    worldFrameCommitted: true,
    bridgeConnected: true,
    registrationCaptureHint: "off",
    ...overrides,
  };
}

describe("computeCameraPolicy", () => {
  it("forceOff overrides all inputs", () => {
    expect(
      computeCameraPolicy(
        runtimeStatic({ forceOff: true, tagCaptureSessionActive: true }),
        runtimeDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "force_off",
    });
  });

  it("AprilTag session on when connected", () => {
    expect(
      computeCameraPolicy(
        {
          forceOff: false,
          appPhase: "registration",
          tagCaptureSessionActive: true,
          worldFrameCommitted: false,
          bridgeConnected: true,
          registrationCaptureHint: "steady",
        },
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: true,
      mode: "registration",
      policy: "steady",
      streamOffReason: null,
    });
  });

  it("AprilTag session off when disconnected", () => {
    expect(
      computeCameraPolicy(
        {
          forceOff: false,
          appPhase: "registration",
          tagCaptureSessionActive: true,
          worldFrameCommitted: false,
          bridgeConnected: false,
          registrationCaptureHint: "steady",
        },
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "bridge_disconnected",
    });
  });

  it("runtime on when near, looking, and moving", () => {
    expect(computeCameraPolicy(runtimeStatic(), runtimeDynamic())).toEqual({
      streamEnabled: true,
      mode: "runtime",
      policy: "off",
      streamOffReason: null,
    });
  });

  it("runtime off without pose inputs reports missing robot pose", () => {
    expect(computeCameraPolicy(runtimeStatic(), emptyDynamic())).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "missing_robot_pose",
    });
  });

  it("runtime on when stopped awaiting correction", () => {
    expect(
      computeCameraPolicy(
        runtimeStatic(),
        runtimeDynamic({
          robotSpeedMps: 0.0,
          correctionSinceLastMovement: false,
        }),
      ),
    ).toEqual({
      streamEnabled: true,
      mode: "runtime",
      policy: "off",
      streamOffReason: null,
    });
  });

  it("runtime off when stopped and corrected since movement", () => {
    expect(
      computeCameraPolicy(
        runtimeStatic(),
        runtimeDynamic({
          robotSpeedMps: 0.0,
          correctionSinceLastMovement: true,
        }),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "stopped_after_correction",
    });
  });

  it("runtime off when outside 3 m even if moving", () => {
    expect(
      computeCameraPolicy(
        runtimeStatic(),
        runtimeDynamic({
          robotWorldPos: robotFar,
        }),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "robot_too_far",
    });
  });

  it("runtime off when not looking at robot", () => {
    expect(
      computeCameraPolicy(
        runtimeStatic(),
        runtimeDynamic({
          robotWorldPos: new vec3(200, 0, 0),
        }),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "not_looking_at_robot",
    });
  });

  it("runtime off when world frame not committed", () => {
    expect(
      computeCameraPolicy(
        runtimeStatic({ worldFrameCommitted: false }),
        runtimeDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "inactive_phase",
    });
  });
});

describe("isWithinStreamDistance", () => {
  it("accepts targets within 3 m", () => {
    expect(isWithinStreamDistance(origin, new vec3(0, 0, -299))).toBe(true);
  });

  it("rejects targets beyond 3 m", () => {
    expect(isWithinStreamDistance(origin, new vec3(0, 0, -(RUNTIME_STREAM_MAX_DISTANCE_CM + 1)))).toBe(
      false,
    );
  });
});

describe("isLookingAtTarget", () => {
  it("accepts targets inside the 45 degree cone", () => {
    expect(isLookingAtTarget(origin, identityRot, new vec3(0, 0, -100))).toBe(true);
  });

  it("rejects targets outside the 45 degree cone", () => {
    expect(isLookingAtTarget(origin, identityRot, new vec3(200, 0, 0))).toBe(false);
  });

  it("accepts targets near the 45 degree boundary", () => {
    const angleRad = (44.9 * Math.PI) / 180;
    const x = Math.sin(angleRad) * 100;
    const z = -Math.cos(angleRad) * 100;
    expect(isLookingAtTarget(origin, identityRot, new vec3(x, 0, z))).toBe(true);
  });

  it("rejects targets just past the 45 degree boundary", () => {
    const angleRad = (46 * Math.PI) / 180;
    const x = Math.sin(angleRad) * 100;
    const z = -Math.cos(angleRad) * 100;
    expect(isLookingAtTarget(origin, identityRot, new vec3(x, 0, z))).toBe(false);
  });
});

describe("movement helpers", () => {
  it("classifies moving and stopped speeds", () => {
    expect(isRobotMoving(RUNTIME_STOP_SPEED_MPS)).toBe(true);
    expect(isRobotMoving(RUNTIME_STOP_SPEED_MPS - 0.001)).toBe(false);
    expect(isRobotStopped(RUNTIME_STOP_SPEED_MPS - 0.001)).toBe(true);
    expect(isRobotStopped(null)).toBe(false);
  });
});

describe("CameraStreamLatch", () => {
  it("clears correction latch when movement starts", () => {
    const latch = new CameraStreamLatch();
    latch.onRobotSpeed(0.0);
    latch.onWorldFrameCorrection();
    expect(latch.correctionSinceLastMovement).toBe(true);

    latch.onRobotSpeed(0.2);
    expect(latch.correctionSinceLastMovement).toBe(false);
  });

  it("sets correction latch on world_frame_correction", () => {
    const latch = new CameraStreamLatch();
    latch.onRobotSpeed(0.2);
    latch.onWorldFrameCorrection();
    expect(latch.correctionSinceLastMovement).toBe(true);
  });

  it("re-enables stream after movement restarts following stop+correction", () => {
    const latch = new CameraStreamLatch();
    latch.onRobotSpeed(0.2);
    latch.onRobotSpeed(0.0);
    latch.onWorldFrameCorrection();
    expect(
      computeCameraPolicy(
        runtimeStatic(),
        runtimeDynamic({
          robotSpeedMps: 0.0,
          correctionSinceLastMovement: latch.correctionSinceLastMovement,
        }),
      ).streamEnabled,
    ).toBe(false);

    latch.onRobotSpeed(0.2);
    expect(
      computeCameraPolicy(
        runtimeStatic(),
        runtimeDynamic({
          robotSpeedMps: 0.2,
          correctionSinceLastMovement: latch.correctionSinceLastMovement,
        }),
      ).streamEnabled,
    ).toBe(true);
  });
});

describe("shouldLogStreamOffReason", () => {
  it("logs actionable runtime reasons only", () => {
    expect(shouldLogStreamOffReason("stopped_after_correction")).toBe(true);
    expect(shouldLogStreamOffReason("missing_robot_pose")).toBe(true);
    expect(shouldLogStreamOffReason("missing_camera_pose")).toBe(true);
    expect(shouldLogStreamOffReason("robot_too_far")).toBe(false);
    expect(shouldLogStreamOffReason("not_looking_at_robot")).toBe(false);
    expect(shouldLogStreamOffReason(null)).toBe(false);
  });
});

describe("registration capture hints", () => {
  const hints: CaptureHint[] = ["burst", "steady", "off"];

  it.each(hints)("setup tag capture session uses capture hint %s", (hint) => {
    expect(
      computeCameraPolicy(
        {
          forceOff: false,
          appPhase: "registration",
          tagCaptureSessionActive: true,
          worldFrameCommitted: false,
          bridgeConnected: true,
          registrationCaptureHint: hint,
        },
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: true,
      mode: "registration",
      policy: hint,
      streamOffReason: null,
    });
  });
});
