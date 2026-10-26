import { CONTROL_PANEL_SCALE } from "../../DimOSARClient/presentation/ControlPanelPresentation";

/** Scale each native frame and its descendants together. */
export const SETUP_PANEL_SCALE = CONTROL_PANEL_SCALE.setup * 0.75;
export const RUNTIME_PANEL_SCALE = CONTROL_PANEL_SCALE.runtime * 0.75;

/** Specs-only design centimetres. Native content keeps its calibrated scale. */
export const PANEL_GEOMETRY = { width: 90, maximumHeight: 76, top: 38, gap: 2, sectionGap: 3, bottom: 5, action: 6.4 } as const;
export interface PanelProfile { height: number; rows: Record<string, number>; }
export type LayoutRow = readonly [name: string, height: number, gapBefore?: number];

export function panelProfile(startY: number, rows: readonly LayoutRow[], footer = true): PanelProfile {
  let cursor = startY;
  const positions: Record<string, number> = {};
  rows.forEach(([name, height, gapBefore], index) => {
    if (index) cursor -= gapBefore ?? PANEL_GEOMETRY.gap;
    positions[name] = cursor - height / 2;
    cursor -= height;
  });
  if (footer) {
    cursor -= PANEL_GEOMETRY.gap;
    positions.footer = cursor - PANEL_GEOMETRY.action / 2;
    cursor -= PANEL_GEOMETRY.action;
  }
  const height = Math.ceil(PANEL_GEOMETRY.top - cursor + PANEL_GEOMETRY.bottom);
  if (height > PANEL_GEOMETRY.maximumHeight) throw new Error(`Panel profile exceeds calibrated height: ${height}`);
  return { height, rows: positions };
}
export function panelContentOffset(height: number): number { return (height - PANEL_GEOMETRY.maximumHeight) / 2; }
export function panelFooterY(height: number): number {
  return PANEL_GEOMETRY.top - height + PANEL_GEOMETRY.bottom + PANEL_GEOMETRY.action / 2;
}
export function easePanel(t: number): number { const p = Math.max(0, Math.min(1, t)); return p * p * (3 - 2 * p); }

export const RUNTIME_LAYOUTS = {
  manual: panelProfile(14.6, [["guidance", 18], ["status", 1.8]]),
  agent: panelProfile(14.6, [["reply", 12], ["draft", 12], ["actions", 6.4], ["status", 1.8]]),
  settings: panelProfile(23, [["robot", 3], ["robotActions", 6.4], ["headset", 3, 3], ["debug", 6.4], ["diagnostics", 6.4], ["sound", 6.4]]),
  sensors: panelProfile(11.2, [["range", 6.4], ["points", 6.4], ["statistics", 10, 3]]),
  diagnostics: panelProfile(23, [["logs", 40]]),
  alignment: panelProfile(23, [["guidance", 7], ["actions", 6.4]]),
} as const;
export const SETUP_LAYOUTS = {
  entry: panelProfile(14.5, [["intro", 3], ["status", 4], ["entry", 6.4]]),
  error: panelProfile(14.5, [["intro", 3], ["status", 6.5], ["entry", 6.4]]),
  connected: panelProfile(14.5, [["intro", 3], ["status", 4], ["entry", 6.4], ["details", 11.5]]),
  capture: panelProfile(14.5, [["provider", 3], ["camera", 22], ["previewLabel", 2.2, 1.2]]),
  message: panelProfile(14.5, [["provider", 3], ["status", 4], ["details", 10]]),
  success: panelProfile(23, [["glyph", 18.8], ["title", 5], ["detail", 4]], false),
} as const;
