import { describe, expect, it } from "vitest";
import { shouldTriggerStopBurst } from "../../Assets/Scripts/ARBridge/Camera/CameraClient";

describe("shouldTriggerStopBurst", () => {
  it("triggers on moving to stopped transition", () => {
    expect(shouldTriggerStopBurst(0.5, 0.0)).toBe(true);
    expect(shouldTriggerStopBurst(0.05, 0.04)).toBe(true);
  });

  it("does not trigger when already stopped", () => {
    expect(shouldTriggerStopBurst(0.0, 0.0)).toBe(false);
    expect(shouldTriggerStopBurst(0.02, 0.01)).toBe(false);
  });

  it("does not trigger when still moving", () => {
    expect(shouldTriggerStopBurst(0.5, 0.3)).toBe(false);
  });

  it("does not trigger on first sample without prior speed", () => {
    expect(shouldTriggerStopBurst(null, 0.0)).toBe(false);
  });

  it("does not trigger when speed becomes unknown", () => {
    expect(shouldTriggerStopBurst(0.5, null)).toBe(false);
  });
});
