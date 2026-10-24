import { expect, it } from "vitest";
import { InteractionCapture } from "../src/input/InteractionCapture";

it("authorizes actual button release callbacks once and rejects competing and cancelled presses", () => {
  const capture = new InteractionCapture(), a = { userData: { id: 1 } }, b = { userData: { id: 2 } };
  const button = {}, other = {};
  expect(capture.press(a, button)).toBe(true);
  expect(capture.press(b, other)).toBe(false);
  expect(capture.activate(2, other)).toBe(false);
  capture.release(a); // XR Blocks may dispatch its button callback after the app's release.
  expect(capture.activate(1, button)).toBe(true);
  expect(capture.activate(1, button)).toBe(false);
  capture.press(a, button); capture.cancel();
  expect(capture.activate(1, button)).toBe(false);
  expect(capture.press(b, other)).toBe(true);
});
