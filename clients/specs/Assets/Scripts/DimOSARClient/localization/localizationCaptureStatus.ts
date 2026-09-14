import type { LocalizationCaptureState } from "./localizationCaptureEpisode";
import type { ARModuleSessionState } from "../websocket/arModuleSession";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WARN, COLOR_WHITE } from "../websocket/sessionLinkStatus";

export interface CaptureStatusText {
  text: string;
  color: vec4;
}

export function localizationCaptureStatus(
  sessionView: ARModuleSessionState,
  episodeView: LocalizationCaptureState,
): CaptureStatusText {
  if (sessionView.connection !== "ready") {
    return { text: "Inactive — not ready", color: COLOR_MUTED() };
  }
  if (!sessionView.capabilities?.localization.available) {
    const reason = sessionView.capabilities.localization.reason ?? "Localization unavailable";
    return { text: reason, color: COLOR_WARN };
  }
  if (sessionView.hasTrackingOrigin) {
    return { text: "Localized", color: COLOR_SUCCESS };
  }

  switch (episodeView.phase) {
    case "idle":
      return { text: "Waiting for capture request", color: COLOR_WHITE };
    case "waiting_for_geometric_gate":
      return { text: "Waiting for geometric gate — look at robot", color: COLOR_WARN };
    case "capturing":
      return { text: "Capturing observations", color: COLOR_SUCCESS };
    case "sending":
      return { text: "Sending observations", color: COLOR_WHITE };
    case "awaiting_result":
      return { text: "Awaiting localization result", color: COLOR_WHITE };
    case "failed":
      return {
        text: episodeView.lastError ? `Capture failed — ${episodeView.lastError}` : "Capture failed",
        color: COLOR_ERROR,
      };
  }
}

function COLOR_MUTED(): vec4 {
  return new vec4(1, 1, 1, 0.55);
}
