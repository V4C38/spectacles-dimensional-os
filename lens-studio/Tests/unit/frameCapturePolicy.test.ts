import { describe, it, expect } from "vitest";
import { computeFrameCapturePolicy } from "../../Assets/Scripts/ARBridge/Session/InboundRouter";
import { CaptureHint } from "../../Assets/Scripts/ARBridge/Network/Protocol";

const hints: CaptureHint[] = ["burst", "steady", "off"];

describe("computeFrameCapturePolicy", () => {
  it("forceOff overrides all inputs", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: true,
        tagCaptureSessionActive: true,
        registrationCaptureHint: "burst",
        forceOff: true,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it.each(hints)("setup tag capture session uses capture hint %s", (hint) => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: false,
        tagCaptureSessionActive: true,
        registrationCaptureHint: hint,
        forceOff: false,
      }),
    ).toEqual({ mode: "registration", policy: hint });
  });

  it.each(hints)(
    "post-succeeded window keeps tag capture session active with hint %s",
    (hint) => {
      expect(
        computeFrameCapturePolicy({
          appPhase: "registration",
          worldFrameCommitted: true,
          tagCaptureSessionActive: true,
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
        tagCaptureSessionActive: false,
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
        tagCaptureSessionActive: false,
        registrationCaptureHint: "off",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("setup without tag capture session stays off even with capture hint", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: false,
        tagCaptureSessionActive: false,
        registrationCaptureHint: "steady",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("setup committed without tag capture session stays off (post-succeeded latch cleared)", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: true,
        tagCaptureSessionActive: false,
        registrationCaptureHint: "off",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("runtime committed ignores active tag capture latch", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "runtime",
        worldFrameCommitted: true,
        tagCaptureSessionActive: true,
        registrationCaptureHint: "burst",
        forceOff: false,
      }),
    ).toEqual({ mode: "runtime", policy: "off" });
  });

  it("runtime uncommitted ignores active tag capture latch", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "runtime",
        worldFrameCommitted: false,
        tagCaptureSessionActive: true,
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
        tagCaptureSessionActive: false,
        registrationCaptureHint: "steady",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });

  it("hello reconnect setup with no tag capture session stays off", () => {
    expect(
      computeFrameCapturePolicy({
        appPhase: "registration",
        worldFrameCommitted: false,
        tagCaptureSessionActive: false,
        registrationCaptureHint: "burst",
        forceOff: false,
      }),
    ).toEqual({ mode: "off", policy: "off" });
  });
});
