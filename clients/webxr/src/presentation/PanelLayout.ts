import { CONTROL_PANEL_LAYOUT, CONTROL_PANEL_CONTROLS } from "@dimos-ar-client/presentation/ControlPanelPresentation";

/** Metre-space profiles; controls keep their calibrated physical size. */
export interface PanelProfile { height: number; rows: Record<string, number>; }
export type LayoutRow = readonly [name: string, height: number, gapBefore?: number];
export const PANEL_TOP = CONTROL_PANEL_LAYOUT.height / 2;
export const PANEL_BOTTOM_PADDING = 0.05;
/** Keep Emergency Stop visually separate from the runtime page content. */
export const RUNTIME_FOOTER_GAP = 0.04;

export function panelProfile(startY: number, rows: readonly LayoutRow[], footer = true, footerGap: number = CONTROL_PANEL_CONTROLS.gap): PanelProfile {
  let cursor = startY;
  const positions: Record<string, number> = {};
  rows.forEach(([name, height, gapBefore], index) => {
    if (index) cursor -= gapBefore ?? CONTROL_PANEL_CONTROLS.gap;
    positions[name] = cursor - height / 2;
    cursor -= height;
  });
  if (footer) {
    cursor -= footerGap;
    positions.footer = cursor - CONTROL_PANEL_CONTROLS.height / 2;
    cursor -= CONTROL_PANEL_CONTROLS.height;
  }
  // Match Specs' centimetre rounding, accounting for floating-point row sums.
  const height = Math.ceil((PANEL_TOP - cursor + PANEL_BOTTOM_PADDING) * 100 - 1e-8) / 100;
  if (height > CONTROL_PANEL_LAYOUT.height) throw new Error(`Panel profile exceeds calibrated height: ${height}`);
  return { height, rows: positions };
}

export function panelFooterY(height: number): number {
  return PANEL_TOP - height + PANEL_BOTTOM_PADDING + CONTROL_PANEL_CONTROLS.height / 2;
}

function runtimeProfile(startY: number, rows: readonly LayoutRow[]): PanelProfile {
  return panelProfile(startY, rows, true, RUNTIME_FOOTER_GAP);
}

export const RUNTIME_LAYOUTS = {
  manual: runtimeProfile(0.146, [["guidance", 0.18], ["status", 0.018]]),
  agent: runtimeProfile(0.146, [["reply", 0.12], ["draft", 0.12], ["actions", 0.064], ["status", 0.018, 0.01]]),
  settings: runtimeProfile(0.23, [["robot", 0.03], ["robotActions", 0.064, 0.01], ["speed", 0.064, 0.01], ["headset", 0.03, 0.01], ["debug", 0.064, 0.01], ["diagnostics", 0.064, 0.01], ["sound", 0.064, 0.01]]),
  sensors: runtimeProfile(0.112, [["range", 0.064], ["points", 0.064], ["statistics", 0.1, 0.03]]),
  diagnostics: runtimeProfile(0.23, [["logs", 0.4]]),
  alignment: runtimeProfile(0.23, [["guidance", 0.07], ["actions", 0.064]]),
} as const;

// WebXR connects through the launcher, so it has no PIN/IP entry row.
export const SETUP_LAYOUTS = {
  entry: panelProfile(0.145, [["intro", 0.03], ["status", 0.04], ["details", 0.04]]),
  error: panelProfile(0.145, [["intro", 0.03], ["status", 0.065], ["details", 0.1]]),
  connected: panelProfile(0.145, [["intro", 0.03], ["status", 0.04], ["details", 0.115]]),
  capture: panelProfile(0.145, [["provider", 0.03], ["camera", 0.22], ["previewLabel", 0.022, 0.012]]),
  message: panelProfile(0.145, [["provider", 0.03], ["status", 0.04], ["details", 0.1]]),
  success: panelProfile(0.23, [["glyph", 0.188], ["title", 0.05], ["detail", 0.04]], false),
} as const;

