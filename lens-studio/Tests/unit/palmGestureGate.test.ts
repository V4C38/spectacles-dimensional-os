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

const testConfig = {
  ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
  openDebounceSec: 0,
  closeDebounceSec: 0,
};

describe("PalmGestureGate", () => {
  it("opens after show pitch is held through debounce", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      openDebounceSec: 0.28,
      closeDebounceSec: 0.08,
    });

    expect(gate.update({ ...baseInput, palmPitchDeg: 45 }, 0)).toBe(false);
    expect(gate.isOpen).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45 }, 0.29)).toBe(true);
    expect(gate.isOpen).toBe(true);
  });

  it("uses hysteresis so the menu stays open between hide and show thresholds", () => {
    const gate = new PalmGestureGate(testConfig);

    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: true }, 0);
    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: true }, 0);
    expect(gate.isOpen).toBe(true);

    expect(gate.update({ ...baseInput, palmPitchDeg: -5, isFacingCamera: true }, 0.01)).toBe(
      false,
    );
    expect(gate.isOpen).toBe(true);

    gate.update({ ...baseInput, palmPitchDeg: -20, isFacingCamera: true }, 0.02);
    expect(gate.update({ ...baseInput, palmPitchDeg: -20, isFacingCamera: true }, 0.03)).toBe(
      true,
    );
    expect(gate.isOpen).toBe(false);
  });

  it("closes immediately when tracking is lost", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      openDebounceSec: 0.28,
      closeDebounceSec: 0.08,
    });

    gate.update({ ...baseInput, palmPitchDeg: 45 }, 0);
    gate.update({ ...baseInput, palmPitchDeg: 45 }, 0.29);
    expect(gate.isOpen).toBe(true);

    expect(
      gate.update(
        { ...baseInput, isTracked: false, palmPitchDeg: null, isFacingCamera: false },
        0.3,
      ),
    ).toBe(true);
    expect(gate.isOpen).toBe(false);
  });

  it("opens when palm faces camera above the camera pitch threshold", () => {
    const gate = new PalmGestureGate(testConfig);

    expect(
      gate.update({ ...baseInput, palmPitchDeg: 30, isFacingCamera: true }, 0),
    ).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 30, isFacingCamera: true }, 0.01)).toBe(
      true,
    );
    expect(gate.isOpen).toBe(true);
  });

  it("opens when palm faces camera at wrist height with low camera-relative pitch", () => {
    const gate = new PalmGestureGate(testConfig);

    expect(
      gate.update({ ...baseInput, palmPitchDeg: -5, isFacingCamera: true }, 0),
    ).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: -5, isFacingCamera: true }, 0.01)).toBe(
      true,
    );
    expect(gate.isOpen).toBe(true);
  });

  it("does not open when facing camera below the camera pitch threshold", () => {
    const gate = new PalmGestureGate(testConfig);

    expect(
      gate.update({ ...baseInput, palmPitchDeg: -20, isFacingCamera: true }, 0),
    ).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: -20, isFacingCamera: true }, 0.01)).toBe(
      false,
    );
    expect(gate.isOpen).toBe(false);
  });

  it("opens when palm is up even if not facing camera when stay-open does not require camera", () => {
    const gate = new PalmGestureGate({
      ...testConfig,
      requireFacingCameraToStayOpen: false,
    });

    expect(
      gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0),
    ).toBe(false);
    expect(
      gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0.01),
    ).toBe(true);
    expect(gate.isOpen).toBe(true);
  });

  it("does not reopen when palm is up but not facing camera and stay-open requires camera", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      openDebounceSec: 0.28,
      closeDebounceSec: 0.08,
    });

    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: true }, 0);
    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: true }, 0.29);
    expect(gate.isOpen).toBe(true);

    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0.3);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0.39)).toBe(
      true,
    );
    expect(gate.isOpen).toBe(false);

    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0.4);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0.69)).toBe(
      false,
    );
    expect(gate.isOpen).toBe(false);
  });

  it("does not open when neither facing camera nor palm is up enough", () => {
    const gate = new PalmGestureGate(testConfig);

    expect(
      gate.update({ ...baseInput, palmPitchDeg: 15, isFacingCamera: false }, 0),
    ).toBe(false);
    expect(
      gate.update({ ...baseInput, palmPitchDeg: 15, isFacingCamera: false }, 0.01),
    ).toBe(false);
    expect(gate.isOpen).toBe(false);
  });

  it("closes when open and palm stops facing camera", () => {
    const gate = new PalmGestureGate({
      ...testConfig,
      requireFacingCameraToStayOpen: true,
    });

    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: true }, 0);
    gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: true }, 0.01);
    expect(gate.isOpen).toBe(true);

    expect(
      gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0.02),
    ).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45, isFacingCamera: false }, 0.03)).toBe(
      true,
    );
    expect(gate.isOpen).toBe(false);
  });

  it("closes faster than it opens when signals flicker at the boundary", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      openDebounceSec: 0.28,
      closeDebounceSec: 0.08,
    });

    gate.update({ ...baseInput, palmPitchDeg: 45 }, 0);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45 }, 0.29)).toBe(true);
    expect(gate.isOpen).toBe(true);

    gate.update({ ...baseInput, palmPitchDeg: -20, isFacingCamera: true }, 0.3);
    expect(gate.update({ ...baseInput, palmPitchDeg: -20, isFacingCamera: true }, 0.35)).toBe(
      false,
    );
    expect(gate.isOpen).toBe(true);
    expect(gate.update({ ...baseInput, palmPitchDeg: -20, isFacingCamera: true }, 0.39)).toBe(
      true,
    );
    expect(gate.isOpen).toBe(false);

    gate.update({ ...baseInput, palmPitchDeg: 45 }, 0.4);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45 }, 0.5)).toBe(false);
    expect(gate.isOpen).toBe(false);
  });

  it("reset clears open state and pending debounce", () => {
    const gate = new PalmGestureGate({
      ...DEFAULT_PALM_GESTURE_GATE_CONFIG,
      openDebounceSec: 0.28,
      closeDebounceSec: 0.08,
    });

    gate.update({ ...baseInput, palmPitchDeg: 45 }, 0);
    gate.reset();
    expect(gate.isOpen).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45 }, 0.05)).toBe(false);
    expect(gate.update({ ...baseInput, palmPitchDeg: 45 }, 0.34)).toBe(true);
  });
});
