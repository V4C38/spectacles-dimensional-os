import { describe, it, expect } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  computeCameraPolicy,
  CameraPolicyDynamicInput,
  CameraPolicyStaticContext,
} from "../../Assets/Scripts/ARBridge/Camera/CameraStreamPolicy";
import { CaptureHint } from "../../Assets/Scripts/ARBridge/Network/Protocol";

const hints: CaptureHint[] = ["burst", "steady", "off"];
const origin = new vec3(0, 0, 0);
const identityRot = quat.quatIdentity();
const robotNear = new vec3(0, 0, -200);

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
    ...overrides,
  });
}

function staticContext(
  overrides: Partial<CameraPolicyStaticContext> = {},
): CameraPolicyStaticContext {
  return {
    forceOff: false,
    appPhase: "registration",
    tagCaptureSessionActive: false,
    worldFrameCommitted: false,
    bridgeConnected: true,
    registrationCaptureHint: "off",
    ...overrides,
  };
}

describe("computeCameraPolicy", () => {
  it("forceOff overrides all inputs", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          appPhase: "registration",
          worldFrameCommitted: true,
          tagCaptureSessionActive: true,
          registrationCaptureHint: "burst",
          forceOff: true,
        }),
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "force_off",
    });
  });

  it.each(hints)("setup tag capture session uses capture hint %s", (hint) => {
    expect(
      computeCameraPolicy(
        staticContext({
          tagCaptureSessionActive: true,
          registrationCaptureHint: hint,
        }),
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: true,
      mode: "registration",
      policy: hint,
      streamOffReason: null,
    });
  });

  it.each(hints)(
    "post-succeeded window keeps tag capture session active with hint %s",
    (hint) => {
      expect(
        computeCameraPolicy(
          staticContext({
            appPhase: "registration",
            worldFrameCommitted: true,
            tagCaptureSessionActive: true,
            registrationCaptureHint: hint,
          }),
          emptyDynamic(),
        ),
      ).toEqual({
        streamEnabled: true,
        mode: "registration",
        policy: hint,
        streamOffReason: null,
      });
    },
  );

  it("runtime committed uses runtime mode when stream gates pass", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          appPhase: "runtime",
          worldFrameCommitted: true,
        }),
        runtimeDynamic(),
      ),
    ).toEqual({
      streamEnabled: true,
      mode: "runtime",
      policy: "off",
      streamOffReason: null,
    });
  });

  it("runtime uncommitted stays off", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          appPhase: "runtime",
          worldFrameCommitted: false,
        }),
        runtimeDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "inactive_phase",
    });
  });

  it("setup without tag capture session stays off even with capture hint", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          registrationCaptureHint: "steady",
        }),
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "inactive_phase",
    });
  });

  it("setup committed without tag capture session stays off (post-succeeded latch cleared)", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          appPhase: "registration",
          worldFrameCommitted: true,
          registrationCaptureHint: "off",
        }),
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "inactive_phase",
    });
  });

  it("runtime committed ignores active tag capture latch", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          appPhase: "runtime",
          worldFrameCommitted: true,
          tagCaptureSessionActive: true,
          registrationCaptureHint: "burst",
        }),
        runtimeDynamic(),
      ),
    ).toEqual({
      streamEnabled: true,
      mode: "runtime",
      policy: "off",
      streamOffReason: null,
    });
  });

  it("runtime uncommitted ignores active tag capture latch", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          appPhase: "runtime",
          worldFrameCommitted: false,
          tagCaptureSessionActive: true,
          registrationCaptureHint: "burst",
        }),
        runtimeDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "inactive_phase",
    });
  });

  it("enterRuntime before bridge_status: runtime uncommitted is off", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          appPhase: "runtime",
          worldFrameCommitted: false,
          registrationCaptureHint: "steady",
        }),
        runtimeDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "inactive_phase",
    });
  });

  it("hello reconnect setup with no tag capture session stays off", () => {
    expect(
      computeCameraPolicy(
        staticContext({
          registrationCaptureHint: "burst",
        }),
        emptyDynamic(),
      ),
    ).toEqual({
      streamEnabled: false,
      mode: "off",
      policy: "off",
      streamOffReason: "inactive_phase",
    });
  });
});
