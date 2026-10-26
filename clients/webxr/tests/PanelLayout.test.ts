import { expect, it } from "vitest";
import { PANEL_TOP, RUNTIME_FOOTER_GAP, RUNTIME_LAYOUTS, SETUP_LAYOUTS, panelFooterY } from "../src/presentation/PanelLayout";

it.each(Object.entries({ ...RUNTIME_LAYOUTS, ...SETUP_LAYOUTS }))("keeps %s rows and footer within the calibrated panel height", (_, profile) => {
  expect(profile.height).toBeLessThanOrEqual(0.76);
  const bottom = PANEL_TOP - profile.height;
  for (const y of Object.values(profile.rows)) {
    expect(y).toBeLessThan(PANEL_TOP - 0.05);
    expect(y).toBeGreaterThan(bottom + 0.05);
  }
  expect(panelFooterY(profile.height) - 0.032).toBeCloseTo(bottom + 0.05);
});

it("reserves a taller agent page and camera capture state without growing with text", () => {
  expect(RUNTIME_LAYOUTS.manual.height).toBeLessThan(RUNTIME_LAYOUTS.agent.height);
  expect(SETUP_LAYOUTS.entry.height).toBeLessThan(SETUP_LAYOUTS.connected.height);
  expect(SETUP_LAYOUTS.entry.height).toBeLessThan(SETUP_LAYOUTS.capture.height);
  expect(SETUP_LAYOUTS.success.height).toBeLessThan(SETUP_LAYOUTS.capture.height);
});

it.each([
  ["manual", "status", 0.018], ["agent", "status", 0.018], ["settings", "sound", 0.064],
  ["sensors", "statistics", 0.1], ["diagnostics", "logs", 0.4], ["alignment", "actions", 0.064],
] as const)("reserves a clear gap above Emergency Stop on %s", (name, lastRow, rowHeight) => {
  const profile = RUNTIME_LAYOUTS[name];
  const contentBottom = profile.rows[lastRow] - rowHeight / 2;
  const buttonTop = panelFooterY(profile.height) + 0.032;
  expect(contentBottom - buttonTop).toBeGreaterThanOrEqual(RUNTIME_FOOTER_GAP - 1e-8);
});
