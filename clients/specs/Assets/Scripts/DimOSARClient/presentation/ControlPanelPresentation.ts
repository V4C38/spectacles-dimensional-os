import type { ARModuleSessionState } from "../websocket/arModuleSession";

/** Copy and proportions shared by host-native control panels. */
export const CONTROL_PANEL_LAYOUT = { width: 0.9, height: 0.76, margin: 0.05, cornerRadius: 0.05, titleY: 0.306 } as const;
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
  stop: "EMERGENCY STOP", settings: "Settings", sensors: "Sensors", diagnostics: "Diagnostics",
  robot: "Robot", headset: "Headset", relocalize: "Re-localize", localizeRobot: "Localize robot", setup: "Setup",
  done: "Done", back: "Back", connect: "01 Connect", connected: "✓ Connected", localization: "02 Localization",
  continue: "Continue", skip: "Skip", reconnect: "Reconnect", tryAgain: "Try again", dismiss: "Dismiss",
  manualGuidance: "Drag the marker, or select the robot and aim at the floor.\nPinch or click to preview, then again to move.",
  alignmentTitle: "Check localization",
  alignmentGuidance: "Tracking resumed. Robot localization may have shifted.\nRe-localize if its displayed position looks incorrect.",
  localizationComplete: "Localization complete",
} as const;
export type LocalizationKind = "marker" | "vps" | "mixed" | "unknown" | "unavailable";
export function localizationGuidance(kind: LocalizationKind): string {
  return kind === "vps" ? "Look around the mapped space." :
    kind === "mixed" ? "Frame the tag, or look around the mapped space." :
      kind === "marker" ? "Frame the tag at the guide’s approximate size." :
        kind === "unavailable" ? "Skip to continue without localization." : "Waiting for camera…";
}
export function localizationProviderLabel(kind: LocalizationKind): string {
  return kind === "vps" ? "VPS" : kind === "mixed" ? "AprilTag + VPS" :
    kind === "marker" ? "AprilTag" : kind === "unavailable" ? "No localization provider" : "Waiting for localization…";
}
export function availableFeatures(capabilities: ARModuleSessionState["capabilities"]): string {
  const labels = { navigation: "Navigation", agent: "Agent", lidar: "LiDAR", localization: "Localization", estop: "Emergency Stop" } as const;
  const features = (Object.keys(labels) as (keyof typeof labels)[]).filter(key => capabilities?.[key]?.available).map(key => labels[key]);
  return features.length ? `Available: ${features.join(", ")}` : "No features available";
}
export function robotBadgeText(name: string, connection: string, selected: boolean, activity: string): string {
  const title = name.length > 36 ? `${name.slice(0, 35)}…` : name;
  return `${title}\n${connection === "Connected" ? `${selected ? "Selected · " : ""}${activity === "Following Path" ? "Following path" : activity}` : connection}`;
}
export function sensorStatusText(available: boolean, received: number, camera = "Not capturing", tracking = "Not tracking", surfaces: number | string = 0): string {
  return `${available ? `Received: ${received} points · Range shared with clients` : "LiDAR unavailable"}\nCamera: ${camera}\n${tracking} · Surfaces: ${surfaces}`;
}
