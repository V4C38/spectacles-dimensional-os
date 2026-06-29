import { describe, it, expect } from "vitest";
import { computeFrameCapturePolicy } from "../../Assets/Scripts/ARBridge/Session/InboundRouter";
import { CaptureHint } from "../../Assets/Scripts/ARBridge/Network/Protocol";

const hints: CaptureHint[] = ["burst", "hold", "steady", "off"];

describe("computeFrameCapturePolicy", () => {
  it("forceOff overrides all inputs", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: true,
        baselineCaptureSessionActive: true,
        registrationCaptureHint: "burst",
        forceOff: true,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it.each(hints)("setup baseline session uses capture hint %s", (hint) => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: false,
        baselineCaptureSessionActive: true,
        registrationCaptureHint: hint,
        forceOff: false,
      }),
    ).toEqual({ mode: "registration", policy: hint });
  });

  it.each(hints)(
    "post-succeeded window keeps baseline session active with hint %s",
    (hint) => {
      expect(
        computeFrameCapturePolicy({
          appPhase: "registration",
          worldFrameCommitted: true,
          baselineCaptureSessionActive: true,
          registrationCaptureHint: hint,
          forceOff: false,
        }),
      ).toEqual({ mode: "registration", policy: hint });
    },
  );

  it("runtime committed uses runtime mode with off policy", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "runtime",
        worldFrameCommitted: true,
        baselineCaptureSessionActive: false,
        registrationCaptureHint: "off",
        forceOff: false,
      }),
    ).toEqual({ mode: "runtime", policy: "off" });
  });

  it("runtime uncommitted stays off", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "runtime",
        worldFrameCommitted: false,
        baselineCaptureSessionActive: false,
        registrationCaptureHint: "off",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("setup without baseline session stays off even with capture hint", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: false,
        baselineCaptureSessionActive: false,
        registrationCaptureHint: "steady",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("setup committed without baseline session stays off (post-succeeded latch cleared)", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: true,
        baselineCaptureSessionActive: false,
        registrationCaptureHint: "hold",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("runtime committed ignores active baseline latch", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "runtime",
        worldFrameCommitted: true,
        baselineCaptureSessionActive: true,
        registrationCaptureHint: "burst",
        forceOff: false,
      }),
    ).toEqual({ mode: "runtime", policy: "off" });
  });

  it("runtime uncommitted ignores active baseline latch", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "runtime",
        worldFrameCommitted: false,
        baselineCaptureSessionActive: true,
        registrationCaptureHint: "burst",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("enterRuntime before bridge_status: runtime uncommitted is off", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "runtime",
        worldFrameCommitted: false,
        baselineCaptureSessionActive: false,
        registrationCaptureHint: "steady",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("hello reconnect setup with no baseline session stays off", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: false,
        baselineCaptureSessionActive: false,
        registrationCaptureHint: "burst",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });
});
