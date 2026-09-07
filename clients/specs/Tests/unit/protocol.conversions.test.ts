import { describe, it, expect } from "vitest";
import {
  protocolMetersToLensCentimeters,
  lensCentimetersToProtocolMeters,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";
import { vec3 } from "../shims/lens-runtime";

describe("protocol unit conversion", () => {
  it("converts meters to lens centimeters", () => {
    const cm = protocolMetersToLensCentimeters([1, 2, 3]);
    expect(cm.x).toBe(100);
    expect(cm.y).toBe(200);
    expect(cm.z).toBe(300);
  });

  it("converts lens centimeters to protocol meters", () => {
    expect(lensCentimetersToProtocolMeters(new vec3(100, 200, 300))).toEqual([
      1, 2, 3,
    ]);
  });

  it("round-trips m to cm to m", () => {
    const samples: [number, number, number][] = [
      [1, 2, 3],
      [-0.5, 0, 2.5],
      [0, -1.25, 0.01],
    ];
    for (const meters of samples) {
      const back = lensCentimetersToProtocolMeters(
        protocolMetersToLensCentimeters(meters),
      );
      expect(back[0]).toBeCloseTo(meters[0], 9);
      expect(back[1]).toBeCloseTo(meters[1], 9);
      expect(back[2]).toBeCloseTo(meters[2], 9);
    }
  });

  it("round-trips cm to m to cm", () => {
    const samples = [
      new vec3(100, 200, 300),
      new vec3(-50, 0, 250),
      new vec3(0, -125, 1),
    ];
    for (const cm of samples) {
      const back = protocolMetersToLensCentimeters(
        lensCentimetersToProtocolMeters(cm),
      );
      expect(back.x).toBeCloseTo(cm.x, 9);
      expect(back.y).toBeCloseTo(cm.y, 9);
      expect(back.z).toBeCloseTo(cm.z, 9);
    }
  });
});
