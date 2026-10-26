import { expect, it } from "vitest";
import { CONTROL_PANEL_SCALE, CONTROL_PANEL_CONTROLS, controlPanelTab, CONTROL_PANEL_COPY, CONTROL_PANEL_LAYOUT, robotBadgeText, sensorStatusText, localizationGuidance, localizationProviderLabel } from "../../Assets/Scripts/DimOSARClient/presentation/ControlPanelPresentation";

it("uses one set of panel proportions and command labels across hosts", () => {
  expect(CONTROL_PANEL_LAYOUT.width / CONTROL_PANEL_LAYOUT.height).toBeCloseTo(0.9 / 0.76);
  expect(CONTROL_PANEL_COPY.send).toBe("Send to agent");
  expect(robotBadgeText("Go2", "Connected", true, "Following Path")).toBe("Go2\nSelected · Following path");
  expect(robotBadgeText("Go2", "Disconnected", true, "Idle")).toBe("Go2\nDisconnected");
});
it("keeps alignment guidance tied to the capture policy", () => {
  expect(localizationProviderLabel("mixed")).toBe("AprilTag + VPS");
  expect(localizationGuidance("mixed")).toBe("Frame the tag, or look around the mapped space.");
  expect(localizationGuidance("unavailable")).toBe("Skip to continue without localization.");
});
it("formats actual sensor facts without confusing received points with the local limit", () => {
  expect(sensorStatusText(true, 2300, "Not capturing", "Tracking", "—")).toBe("Received: 2300 points · Range shared with clients\nCamera: Not capturing\nTracking · Surfaces: —");
});

it("preserves WebXR's calibrated physical panel, control sizes and segmented spacing", () => {
  expect(CONTROL_PANEL_LAYOUT.width * CONTROL_PANEL_SCALE.setup * 100).toBeCloseTo(38.88);
  expect(CONTROL_PANEL_LAYOUT.height * CONTROL_PANEL_SCALE.setup * 100).toBeCloseTo(32.832);
  expect(CONTROL_PANEL_LAYOUT.width * CONTROL_PANEL_SCALE.runtime * 100).toBeCloseTo(31.104);
  expect(CONTROL_PANEL_LAYOUT.height * CONTROL_PANEL_SCALE.runtime * 100).toBeCloseTo(26.2656);
  expect(CONTROL_PANEL_CONTROLS.height * CONTROL_PANEL_SCALE.runtime * 100).toBeCloseTo(2.21184);
  for (const count of [2, 3]) {
    const first = controlPanelTab(count, 0), last = controlPanelTab(count, count - 1);
    expect(first.x - first.width / 2).toBeCloseTo(-0.394);
    expect(last.x + last.width / 2).toBeCloseTo(0.394);
    expect(controlPanelTab(count, 1).x - first.x - first.width).toBeCloseTo(0.006);
  }
});
