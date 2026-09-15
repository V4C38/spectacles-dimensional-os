import { describe, expect, it } from "vitest";
import {
  COLOR_ERROR,
  COLOR_MUTED,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
  statusToneColor,
} from "../mocks/UIKit";

describe("statusToneColor", () => {
  it("maps portable ClientCore tones onto UIKit colors", () => {
    expect(statusToneColor("error")).toEqual(COLOR_ERROR);
    expect(statusToneColor("warn")).toEqual(COLOR_WARN);
    expect(statusToneColor("success")).toEqual(COLOR_SUCCESS);
    expect(statusToneColor("neutral")).toEqual(COLOR_WHITE);
    expect(statusToneColor("muted")).toEqual(COLOR_MUTED);
  });
});
