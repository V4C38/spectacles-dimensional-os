import { describe, it, expect } from "vitest";
import { clampCameraSmallerDimension } from "../../Assets/Scripts/App/Utilities/Utilities";

describe("clampCameraSmallerDimension", () => {
  it("passes through when requested is within supported max", () => {
    const supported = [{ x: 1024, y: 682 }, { x: 756, y: 1008 }];
    expect(clampCameraSmallerDimension(500, supported)).toBe(500);
    expect(clampCameraSmallerDimension(756, supported)).toBe(756);
  });

  it("clamps to max smaller dimension on PC preview limits", () => {
    const supported = [{ x: 910, y: 682 }];
    expect(clampCameraSmallerDimension(756, supported)).toBe(682);
  });

  it("uses PC preview fallback when resolution query fails", () => {
    expect(clampCameraSmallerDimension(756, [])).toBe(756);
  });

  it("returns non-positive requested unchanged", () => {
    expect(clampCameraSmallerDimension(0, [{ x: 910, y: 682 }])).toBe(0);
    expect(clampCameraSmallerDimension(-1, [{ x: 910, y: 682 }])).toBe(-1);
  });
});
