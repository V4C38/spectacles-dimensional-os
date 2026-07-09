import { describe, expect, it } from "vitest";
import {
  isStartingMovement,
  isStoppingMovement,
} from "../../Assets/Scripts/ARBridge/Camera/CameraStreamSession";

describe("isStartingMovement", () => {
  it("detects stopped to moving transition", () => {
    expect(isStartingMovement(0.0, 0.5)).toBe(true);
    expect(isStartingMovement(0.04, 0.05)).toBe(true);
    expect(isStartingMovement(null, 0.2)).toBe(true);
  });

  it("does not trigger when already moving", () => {
    expect(isStartingMovement(0.5, 0.3)).toBe(false);
  });

  it("does not trigger when still stopped", () => {
    expect(isStartingMovement(0.0, 0.0)).toBe(false);
    expect(isStartingMovement(0.02, 0.01)).toBe(false);
  });
});

describe("isStoppingMovement", () => {
  it("detects moving to stopped transition", () => {
    expect(isStoppingMovement(0.5, 0.0)).toBe(true);
    expect(isStoppingMovement(0.05, 0.04)).toBe(true);
  });

  it("does not trigger when already stopped", () => {
    expect(isStoppingMovement(0.0, 0.0)).toBe(false);
    expect(isStoppingMovement(0.02, 0.01)).toBe(false);
  });

  it("does not trigger when still moving", () => {
    expect(isStoppingMovement(0.5, 0.3)).toBe(false);
  });

  it("does not trigger on first sample without prior speed", () => {
    expect(isStoppingMovement(null, 0.0)).toBe(false);
  });

  it("does not trigger when speed becomes unknown", () => {
    expect(isStoppingMovement(0.5, null)).toBe(false);
  });
});
