import type { LocalizationCaptureState } from "./localizationCaptureEpisode";
import type { ARModuleSessionState } from "../websocket/arModuleSession";
import type { StatusTone } from "../websocket/sessionLinkStatus";

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

  switch (episodeView.phase) {
    case "idle":
      return { text: "Ready to scan", color: "neutral" };
    case "waiting_for_geometric_gate":
      return { text: "Look toward the robot to scan", color: "warn" };
    case "capturing":
    case "sending":
    case "awaiting_result":
      return { text: `Scanning ${".".repeat(1 + Math.floor(nowS / 0.4) % 3)}\nLook at the marker`, color: "neutral" };
    case "failed":
      return {
        text: episodeView.lastError ? `Capture failed — ${episodeView.lastError}` : "Capture failed",
        color: "error",
      };
  }
}
