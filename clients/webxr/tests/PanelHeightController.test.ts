import { expect, it } from "vitest";
import { PanelHeightController, PANEL_RESIZE_S } from "../src/presentation/PanelHeightController";

it("eases shrinking and growing over 280ms without restarting identical requests", () => {
  const controller = new PanelHeightController();
  controller.request(0.5);
  controller.tick(PANEL_RESIZE_S / 2);
  expect(controller.height).toBeCloseTo(0.63);
  controller.request(0.5);
  controller.tick(PANEL_RESIZE_S / 2);
  expect(controller.height).toBe(0.5);
  controller.request(0.7);
  controller.tick(PANEL_RESIZE_S / 2);
  expect(controller.height).toBeCloseTo(0.6);
  controller.tick(PANEL_RESIZE_S / 2);
  expect(controller.height).toBe(0.7);
});

it("retargets from the displayed height and pauses during manipulation", () => {
  const controller = new PanelHeightController();
  controller.request(0.5); controller.tick(0.1);
  const displayed = controller.height;
  controller.request(0.7);
  expect(controller.height).toBe(displayed);
  controller.tick(1, true);
  expect(controller.height).toBe(displayed);
  controller.tick(-1);
  expect(controller.height).toBe(displayed);
  controller.tick(PANEL_RESIZE_S / 2);
  expect(controller.height).toBeCloseTo((displayed + 0.7) / 2);
  controller.tick(PANEL_RESIZE_S / 2);
  expect(controller.height).toBe(0.7);
});

it("settles hidden state changes immediately even during an interrupted animation", () => {
  const controller = new PanelHeightController();
  controller.request(0.5); controller.tick(0.1);
  controller.request(0.6, true);
  expect(controller.height).toBe(0.6);
  expect(controller.target).toBe(0.6);
  controller.tick(1);
  expect(controller.height).toBe(0.6);
});
