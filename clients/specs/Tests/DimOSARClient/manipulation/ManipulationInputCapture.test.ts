import { expect, it } from "vitest";
import { ManipulationInputCapture } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationInputCapture";

it("keeps drag ownership through another hand's gripper press and release", () => {
  const capture = new ManipulationInputCapture();
  expect(capture.begin("right")).toBe(true);
  expect(capture.begin("left")).toBe(false);
  expect(capture.pressGripper("right")).toBe(false);
  expect(capture.pressGripper("left")).toBe(true);
  expect(capture.pressGripper("left")).toBe(false);
  expect(capture.release("left")).toBe(false);
  expect(capture.owner).toBe("right");
  expect(capture.pressGripper("left")).toBe(true);
  expect(capture.release("right")).toBe(true);
  capture.reset();
  expect(capture.owner).toBeNull();
  expect(capture.pressGripper("left")).toBe(true);
});
