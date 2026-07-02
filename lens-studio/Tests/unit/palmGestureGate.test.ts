import { describe, it, expect } from "vitest";
import {
  DEFAULT_PALM_GESTURE_GATE_CONFIG,
  PalmGestureGate,
} from "../../Assets/Scripts/App/UI/PalmGestureGate";

const baseInput = {
  isTracked: true,
  palmPitchDeg: 0,
  isFacingCamera: true,
};

describe("PalmGestureGate", () => {
  it("opens after show pitch is held through debounce", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      debounceSec: 0.15,
    });

    expect(gate.update({ ...baseInput, palmPitchDeg: 30 }, 0)).toBe(false);
    expect(gate.isOpen).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 30 }, 0.16)).toBe(true);
    expect(gate.isOpen).toBe(true);
  });

  it("uses hysteresis so the menu stays open between hide and show thresholds", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      debounceSec: 0,
    });

    gate.update({ ...baseInput, palmPitchDeg: 30 }, 0);
    gate.update({ ...baseInput, palmPitchDeg: 30 }, 0);
    expect(gate.isOpen).toBe(true);

    expect(gate.update({ ...baseInput, palmPitchDeg: 10 }, 0.01)).toBe(false);
    expect(gate.isOpen).toBe(true);

    gate.update({ ...baseInput, palmPitchDeg: 4 }, 0.02);
    expect(gate.update({ ...baseInput, palmPitchDeg: 4 }, 0.02)).toBe(true);
    expect(gate.isOpen).toBe(false);
  });

  it("closes immediately when tracking is lost", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      debounceSec: 0.15,
    });

    gate.update({ ...baseInput, palmPitchDeg: 30 }, 0);
    gate.update({ ...baseInput, palmPitchDeg: 30 }, 0.16);
    expect(gate.isOpen).toBe(true);

    expect(
      gate.update(
        { ...baseInput, isTracked: false, palmPitchDeg: null, isFacingCamera: false },
        0.2,
      ),
    ).toBe(true);
    expect(gate.isOpen).toBe(false);
  });

  it("requires palm facing camera when configured", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      debounceSec: 0,
      requireFacingCamera: true,
    });

    expect(
      gate.update({ ...baseInput, palmPitchDeg: 30, isFacingCamera: false }, 0),
    ).toBe(false);
    expect(gate.isOpen).toBe(false);

    expect(
      gate.update({ ...baseInput, palmPitchDeg: 30, isFacingCamera: true }, 0),
    ).toBe(false);
    expect(
      gate.update({ ...baseInput, palmPitchDeg: 30, isFacingCamera: true }, 0.01),
    ).toBe(true);
    expect(gate.isOpen).toBe(true);
  });

  it("reset clears open state and pending debounce", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      debounceSec: 0.15,
    });

    gate.update({ ...baseInput, palmPitchDeg: 30 }, 0);
    gate.reset();
    expect(gate.isOpen).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 30 }, 0.05)).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 30 }, 0.2)).toBe(true);
  });
});
