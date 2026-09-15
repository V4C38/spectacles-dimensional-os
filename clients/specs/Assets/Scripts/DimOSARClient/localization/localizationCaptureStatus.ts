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
): CaptureStatusText {
  if (sessionView.connection !== "ready") {
    return { text: "Inactive — not ready", color: "muted" };
  }
  if (!sessionView.capabilities?.localization.available) {
    const reason = sessionView.capabilities?.localization.reason ?? "Localization unavailable";
    return { text: reason, color: "warn" };
  }
  if (sessionView.hasTrackingOrigin) {
    return { text: "Localized", color: "success" };
  }

  switch (episodeView.phase) {
    case "idle":
      return { text: "Waiting for capture request", color: "neutral" };
    case "waiting_for_geometric_gate":
      return { text: "Waiting for geometric gate — look at robot", color: "warn" };
    case "capturing":
      return { text: "Capturing observations", color: "success" };
    case "sending":
      return { text: "Sending observations", color: "neutral" };
    case "awaiting_result":
      return { text: "Awaiting localization result", color: "neutral" };
    case "failed":
      return {
        text: episodeView.lastError ? `Capture failed — ${episodeView.lastError}` : "Capture failed",
        color: "error",
      };
  }
}
