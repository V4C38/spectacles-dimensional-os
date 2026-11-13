import { CAPABILITY_LABELS } from "./CapabilityPresentation";
import type { ARModuleSessionState } from "../websocket/arModuleSession";

/** Copy and proportions shared by host-native control panels. */
export const CONTROL_PANEL_LAYOUT = { width: 0.9, height: 0.76, margin: 0.05, cornerRadius: 0.05, titleY: 0.306 } as const;
/** Every settings/sensors section uses this one heading style. */
export const CONTROL_PANEL_SECTION = { left: -0.4, width: 0.8, height: 0.03, fontDp: 19, color: "#aeaeb2", depthM: 0.006 } as const;
/** Metre-space design coordinates, before the calibrated host scale. */
export const CONTROL_PANEL_CONTROLS = { height: 0.064, iconSize: 0.072, gap: 0.02 } as const;
export const CONTROL_PANEL_MESSAGE = { height: 0.12, padding: 0.028, captionHeight: 0.02, captionY: 0.033, textY: -0.016, textHeight: 0.057 } as const;
export const CONTROL_PANEL_SCALE = { setup: 0.432, runtime: 0.432 * 0.8 } as const;
export const CONTROL_PANEL_TYPE = { dpToMetres: 0.000868, labelScale: 1.35, buttonDp: 26 } as const;
export function controlPanelTab(count: number, index: number): { x: number; width: number } {
  const content = CONTROL_PANEL_LAYOUT.width - CONTROL_PANEL_LAYOUT.margin * 2;
  const width = (content - 0.012 - 0.006 * (count - 1)) / count;
  return { width, x: (index - (count - 1) / 2) * (width + 0.006) };
}
export const CONTROL_PANEL_COPY = {
  appName: "dimOS AR", setupTitle: "Setup Wizard", manual: "Manual", agent: "Agent", yourMessage: "Your message",
  send: "Send to agent", clear: "Clear", hold: "Hold to record", microphoneUnavailable: "Microphone unavailable",
  stop: "EMERGENCY STOP", settings: "Settings", sensors: "Capabilities", diagnostics: "Diagnostics",
  robot: "Robot", headset: "Headset", relocalize: "Re-localize", localizeRobot: "Localize robot", setup: "Setup",
  done: "Done", back: "Back", connect: "01 Connect", connected: "✓ Connected", localization: "02 Localization",
  continue: "Continue", skip: "Skip", reconnect: "Reconnect", tryAgain: "Try again", dismiss: "Dismiss",
  manualGuidance: "Drag the marker, or select the robot and aim at the floor.\nPinch or click to preview, then again to move.",
  alignmentTitle: "Check localization",
  alignmentGuidance: "Tracking resumed. Robot localization may have shifted.\nRe-localize if its displayed position looks incorrect.",
  localizationComplete: "Localization complete",
} as const;
export type LocalizationKind = "marker" | "vps" | "mixed" | "unknown" | "unavailable";
/** Configured providers describe the UI. */
export function localizationKind(view: Pick<ARModuleSessionState, "hello" | "capabilities">): LocalizationKind {
  if (!view.capabilities) return "unknown";
  if (!view.capabilities.localization.available) return "unavailable";
  const providers = view.hello?.localization?.providers;
  if (providers) {
    const marker = providers.includes("fiducial_marker"), vps = providers.includes("vps");
    return marker && vps ? "mixed" : marker ? "marker" : vps ? "vps" : "unavailable";
  }
  return "unknown";
}
export function localizationGuidance(kind: LocalizationKind): string {
  return kind === "vps" ? "Look around the mapped space." :
    kind === "mixed" ? "Frame the tag, or look around the mapped space." :
      kind === "marker" ? "Frame the tag at the guide’s approximate size." :
        kind === "unavailable" ? "Skip to continue without localization." : "Waiting for camera…";
}
export function localizationProviderLabel(kind: LocalizationKind): string {
  return kind === "vps" ? "VPS" : kind === "mixed" ? "Fiducial marker + VPS" :
    kind === "marker" ? "Fiducial marker" : kind === "unavailable" ? "No localization provider" : "Waiting for localization…";
}
export function availableCapabilityLabels(capabilities: ARModuleSessionState["capabilities"]): string[] {
  const labels = CAPABILITY_LABELS;
  return (Object.keys(labels) as (keyof typeof labels)[]).filter(key => capabilities?.[key]?.available).map(key => labels[key]);
}
export function availableFeatures(capabilities: ARModuleSessionState["capabilities"]): string {
  const features = availableCapabilityLabels(capabilities);
  return `Capabilities: ${features.length ? features.join(", ") : "None"}`;
}
export function robotBadgeText(name: string, connection: string, selected: boolean, activity: string): string {
  const title = name.length > 36 ? `${name.slice(0, 35)}…` : name;
  return `${title}\n${connection === "Connected" ? `${selected ? "Selected · " : ""}${activity === "Following Path" ? "Following path" : activity}` : connection}`;
}
export function sensorStatusText(available: boolean, received: number, camera = "Not capturing", tracking = "Not tracking", surfaces: number | string = 0): string {
  return `${available ? `Received: ${received} points · Range shared with clients` : "LiDAR unavailable"}\nCamera: ${camera}\n${tracking} · Surfaces: ${surfaces}`;
}

export interface PanelProfile { height: number; rows: Record<string, number>; }
export type LayoutRow = readonly [name: string, height: number, gapBefore?: number];

/** Unit-independent row placement; hosts supply their calibrated geometry. */
export function layoutPanelRows(startY: number, rows: readonly LayoutRow[], geometry: {
  top: number; gap: number; bottom: number; action: number; maximumHeight: number; quantum: number;
}, footer: boolean, footerGap = geometry.gap): PanelProfile {
  let cursor = startY;
  const positions: Record<string, number> = {};
  rows.forEach(([name, height, gapBefore], index) => {
    if (index) cursor -= gapBefore ?? geometry.gap;
    positions[name] = cursor - height / 2;
    cursor -= height;
  });
  if (footer) {
    cursor -= footerGap;
    positions.footer = cursor - geometry.action / 2;
    cursor -= geometry.action;
  }
  const height = Math.ceil((geometry.top - cursor + geometry.bottom) / geometry.quantum - 1e-8) * geometry.quantum;
  if (height > geometry.maximumHeight) throw new Error(`Panel profile exceeds calibrated height: ${height}`);
  return { height, rows: positions };
}
