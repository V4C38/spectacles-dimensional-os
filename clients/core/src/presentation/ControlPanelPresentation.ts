import type { ARModuleSessionState } from "../websocket/ARModuleSession";
import type { LocalizationCaptureState } from "../localization/LocalizationCaptureEpisode";

/** One label catalog shared by immersive and landing capability summaries. */
export const CAPABILITY_LABELS = {
  manipulation: "Manipulation", navigation: "Navigation", agent: "Agent mode",
  object_detection: "Object detection", lidar: "LiDAR", localization: "Localization",
  estop: "Emergency Stop",
} as const;

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

const compactControlScale = CONTROL_PANEL_SCALE.runtime / .7;
/** OpenYAM controls only; the robot badge is anchored independently. */
export const ARM_PANEL_STYLE = {
  widthM: 0.224, headerM: 0.04, rowM: 0.04, paddingM: 0.028,
  buttonHeightM: CONTROL_PANEL_CONTROLS.height * compactControlScale,
  buttonFontM: CONTROL_PANEL_TYPE.buttonDp * CONTROL_PANEL_TYPE.dpToMetres * compactControlScale,
  cornerM: .025,
  defaultScale: 0.875, minScale: 0.65625, maxScale: 1.75,
  pinXM: 0.088, pinYM: -0.024, pinSizeM: CONTROL_PANEL_CONTROLS.iconSize * compactControlScale, iconStrokeM: 0.0015,
} as const;
export function clampArmPanelScale(scale: number): number {
  return Math.max(ARM_PANEL_STYLE.minScale, Math.min(ARM_PANEL_STYLE.maxScale, scale));
}

/** Shared thumbtack icon, in design metres, as independent line-segment endpoints. */
export const PANEL_PIN_SEGMENTS: readonly (readonly [number, number])[] = [
 [-.005,.007],[.005,.007], [-.005,.007],[-.003,.001],
 [.005,.007],[.003,.001], [-.003,.001],[-.006,-.002],
 [-.006,-.002],[.006,-.002], [.006,-.002],[.003,.001],
 [0,-.002],[0,-.009],
];
export const PANEL_SCAN_SEGMENTS: readonly (readonly [number, number])[] = [
 [-.007,.003],[-.007,.007],[-.007,.007],[-.003,.007],
 [.003,.007],[.007,.007],[.007,.007],[.007,.003],
 [.007,-.003],[.007,-.007],[.007,-.007],[.003,-.007],
 [-.003,-.007],[-.007,-.007],[-.007,-.007],[-.007,-.003],
 [-.003,0],[.003,0],[0,-.003],[0,.003],
];

export const PANEL_RESIZE_S = 0.28;

/** Interruptible height animation. The host keeps its top reference stationary. */
export class PanelHeightAnimation {
  height: number = CONTROL_PANEL_LAYOUT.height;
  target = this.height;
  private start = this.height;
  private elapsed = PANEL_RESIZE_S;

  request(height: number, immediate = false): void {
    if (immediate) { this.height = this.target = this.start = height; this.elapsed = PANEL_RESIZE_S; return; }
    if (height === this.target) return;
    this.start = this.height; this.target = height; this.elapsed = 0;
  }
  tick(deltaS: number, paused = false): void {
    if (paused || this.height === this.target) return;
    this.elapsed = Math.min(PANEL_RESIZE_S, this.elapsed + Math.max(0, deltaS));
    const t = this.elapsed / PANEL_RESIZE_S;
    this.height = this.elapsed === PANEL_RESIZE_S ? this.target : this.start + (this.target - this.start) * t * t * (3 - 2 * t);
  }
}

export const NO_ROBOT_CONNECTED_LABEL = "- Disconnected -";

export type SessionLinkPhase = "disconnected" | "connecting" | "robotOffline" | "connected";

export type StatusTone = "error" | "warn" | "success" | "neutral" | "muted";

export interface StatusText {
  text: string;
  color: StatusTone;
}

export interface SessionLinkTransitionLog {
  hudText: string;
  hudColor: StatusTone;
  consoleText: string;
  consoleColor: StatusTone;
  hudDurationS?: number;
}

export function deriveSessionLinkPhase(view: ARModuleSessionState): SessionLinkPhase {
  if (view.connection === "disconnected" || view.connection === "failed") {
    return "disconnected";
  }
  if (view.connection === "connecting" || view.connection === "awaiting_hello") {
    return "connecting";
  }
  if (!view.pose) {
    return "robotOffline";
  }
  return "connected";
}

export function sessionLinkStatus(
  view: ARModuleSessionState,
  displayName: string = NO_ROBOT_CONNECTED_LABEL,
): StatusText {
  switch (deriveSessionLinkPhase(view)) {
    case "disconnected":
      return {
        text: `\n\n\n${NO_ROBOT_CONNECTED_LABEL}`,
        color: "error",
      };
    case "connecting":
      return {
        text: "\n\n\nConnecting…",
        color: "error",
      };
    case "robotOffline":
      return {
        text: "\n\n\nConnected - Robot not connected",
        color: "warn",
      };
    case "connected":
      return {
        text: `\n\n\nConnected - ${displayName}`,
        color: "success",
      };
  }
}

export function sessionLinkTransitionLog(
  prev: SessionLinkPhase,
  next: SessionLinkPhase,
): SessionLinkTransitionLog | null {
  if (prev === next) {
    return null;
  }
  if (next === "disconnected") {
    return {
      hudText: "Disconnected",
      hudColor: "error",
      consoleText: "Disconnected",
      consoleColor: "error",
      hudDurationS: 3.0,
    };
  }
  if (prev === "connected" && next === "robotOffline") {
    return {
      hudText: "Robot disconnected",
      hudColor: "error",
      consoleText: "Robot disconnected",
      consoleColor: "error",
      hudDurationS: 3.0,
    };
  }
  if (prev === "robotOffline" && next === "connected") {
    return {
      hudText: "Robot connected",
      hudColor: "success",
      consoleText: "Robot connected",
      consoleColor: "success",
      hudDurationS: 2.0,
    };
  }
  return null;
}

export interface CaptureStatusText {
  text: string;
  color: StatusTone;
}

export function localizationCaptureStatus(
  sessionView: ARModuleSessionState,
  episodeView: LocalizationCaptureState,
  nowS: number = 0,
): CaptureStatusText {
  if (sessionView.connection !== "ready") {
    return { text: "Inactive — not ready", color: "muted" };
  }
  if (!sessionView.capabilities?.localization.available) {
    const reason = sessionView.capabilities?.localization.reason ?? "Localization unavailable";
    return { text: reason, color: "warn" };
  }
  if (sessionView.hasTrackingOrigin && episodeView.phase === "idle") {
    return { text: "Localized", color: "success" };
  }
  if (sessionView.localizationNotice) return { text: sessionView.localizationNotice, color: "warn" };

  switch (episodeView.phase) {
    case "idle":
      return { text: "Ready to scan", color: "neutral" };
    case "waiting_for_geometric_gate":
      return { text: "Look toward the robot to scan", color: "warn" };
    case "waiting_for_retry":
      return { text: "Localized — correction retry pending", color: "muted" };
    case "capturing":
    case "awaiting_result":
      return { text: `Scanning ${".".repeat(1 + Math.floor(nowS / 0.4) % 3)}\n${episodeView.capturePolicy === "any_angle" ? "Look around the mapped room" : "Look at the marker"}`, color: "neutral" };
    case "failed":
      if (episodeView.retryInS != null) return { text: "Retrying scan automatically…", color: "neutral" };
      return {
        text: episodeView.lastError ? `Capture failed — ${episodeView.lastError}` : "Capture failed",
        color: "error",
      };
  }
}


export type OperatingMode = "manual" | "agent";

export function operatingMode(view: ARModuleSessionState, fallback: OperatingMode = "manual"): OperatingMode {
  const mode = view.interaction?.mode ?? fallback;
  return mode === "agent" && view.capabilities?.agent.available !== true ? "manual" : mode;
}

/** Shared mode policy; native authority remains the source whenever it is available. */
export class OperatingModeController {
  private fallback: OperatingMode = "manual";
  constructor(private readonly options: { resetFallbackWithSharedState?: boolean } = {}) {}
  effective(view: ARModuleSessionState): OperatingMode { return operatingMode(view, this.fallback); }
  set(view: ARModuleSessionState, mode: OperatingMode, requestMode: (mode: OperatingMode) => void): void {
    if (mode === "agent" && view.capabilities?.agent.available !== true) {
      throw new Error("hello.capabilities.agent is not available");
    }
    if (view.interaction) requestMode(mode);
    else this.fallback = mode;
  }
  reset(view: ARModuleSessionState): void {
    if (!view.interaction || this.options.resetFallbackWithSharedState) this.fallback = "manual";
  }
}

export function isSelectionEligible(
  view: ARModuleSessionState,
  setupCompleted: boolean,
  alignmentReviewPending: boolean,
  retainingFeedback = false,
): boolean {
  return setupCompleted && !alignmentReviewPending && (view.connection === "ready" || retainingFeedback);
}

export function isAgentEnabled(view: ARModuleSessionState, setupCompleted: boolean, mode: OperatingMode): boolean {
  return setupCompleted && mode === "agent" && view.connection === "ready" && view.capabilities?.agent.available === true;
}

export function isManualControlEnabled(
  view: ARModuleSessionState,
  setupCompleted: boolean,
  alignmentReviewPending: boolean,
  setupCelebrating = false,
  mode: OperatingMode = operatingMode(view),
): boolean {
  return setupCompleted && !alignmentReviewPending && !setupCelebrating &&
    mode === "manual" && view.connection === "ready";
}
