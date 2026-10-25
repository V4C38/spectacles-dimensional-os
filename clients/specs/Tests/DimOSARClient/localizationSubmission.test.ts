import { describe, expect, it } from "vitest";
import { LocalizationSubmission } from "../../Assets/Scripts/DimOSARClient/localization/localizationSubmission";

describe("localization submission correlation", () => {
  it("accepts only the newest batch in the converted server clock", () => {
    const gate = new LocalizationSubmission();
    gate.begin(1, 100, 0, 15);
    gate.begin(2, 100, 1, 15);
    expect(gate.accept(101, 2)).toBe(false);
    expect(gate.accept(102, 2)).toBe(true);
    expect(gate.accept(102, 2)).toBe(false);
  });

  it("rejects paused, expired, and disconnected submissions", () => {
    const gate = new LocalizationSubmission();
    gate.begin(1, 100, 0, 15);
    gate.cancel();
    expect(gate.accept(101, 1)).toBe(false);
    gate.begin(2, 100, 0, 15);
    expect(gate.accept(102, 15)).toBe(false);
    gate.reset();
    gate.begin(1, 200, 20, 15);
    expect(gate.accept(102, 21)).toBe(false);
    expect(gate.accept(201, 21)).toBe(true);
  });

  it("requires new camera frames after retries, even if the prior result was discarded", () => {
    const gate = new LocalizationSubmission();
    gate.begin(1, 100, 0, 15);
    gate.cancel();
    expect(() => gate.begin(1, 100, 1, 15)).toThrow(/timestamps must increase/);
    expect(() => gate.begin(NaN, 100, 1, 15)).toThrow();
    expect(() => gate.begin(2, 100, 1, 0)).toThrow();
    gate.begin(2, 100, 1, 15);
    expect(gate.accept(102, 2)).toBe(true);
  });

  it("allows float64 epoch rounding without accepting a different capture", () => {
    const gate = new LocalizationSubmission();
    gate.begin(1, 1_700_000_000, 0, 15);
    expect(gate.accept(1_700_000_001.00001, 1)).toBe(false);
    expect(gate.accept(1_700_000_001.0000002, 1)).toBe(true);
  });
});
