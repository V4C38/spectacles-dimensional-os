import { describe, expect, it } from "vitest";
import { frameTimeToClientClock } from "../src/time/BrowserClientClock";

describe("frameTimeToClientClock", () => {
  it("converts a DOMHighResTimeStamp onto ClientClock seconds", () => {
    const clock = { now: () => 20 };
    expect(frameTimeToClientClock(19500, clock, 20000)).toBeCloseTo(19.5);
    expect(() => frameTimeToClientClock(Number.NaN, clock, 20000)).toThrow("not finite");
  });
});
