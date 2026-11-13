import { describe, expect, it } from "vitest";
import { localizationCaptureStatus } from "../../src/presentation/ControlPanelPresentation";
import type { ARModuleSessionState } from "../../src/websocket/ARModuleSession";
import type { LocalizationCapturePhase } from "../../src/localization/LocalizationCaptureEpisode";

function view(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
  return {
    connection: "disconnected",
    hasTrackingOrigin: false,
    hello: null,
    state: null,
    pose: null,
    nav_goal: null,
    lidar: null,
    capabilities: null,
    nav: null,
    agentMessage: null,
    lastError: null,
    ...overrides,
  };
}

describe("localizationCaptureStatus", () => {
  it("gives mapped-room guidance for VPS frames instead of asking for a marker", () => {
    const session = view({ connection: "ready", capabilities: {
      localization: { available: true, reason: null },
    } as ARModuleSessionState["capabilities"] });
    expect(localizationCaptureStatus(session, { phase: "capturing", lastError: null,
      capturePolicy: "any_angle" }).text).toBe("Scanning .\nLook around the mapped room");
  });
  it.each<LocalizationCapturePhase>(["capturing", "awaiting_result"])(
    "keeps scan guidance stable during %s without implying frames are marker sightings",
    (phase) => {
      const session = view({ connection: "ready", capabilities: {
        localization: { available: true, reason: null },
      } as ARModuleSessionState["capabilities"] });
      const status = localizationCaptureStatus(session, {
        phase, lastError: null, capturedCount: 1, observationCount: 3,
      });
      expect(status.text).toBe("Scanning .\nLook at the marker");
    },
  );

  it("animates one, two, three dots and shows runtime scans despite an existing origin", () => {
    const session = view({ connection: "ready", hasTrackingOrigin: true, capabilities: {
      localization: { available: true, reason: null },
    } as ARModuleSessionState["capabilities"] });
    const episode = { phase: "capturing" as const, lastError: null };
    expect([0, 0.45, 0.85, 1.25].map((t) => localizationCaptureStatus(session, episode, t).text))
      .toEqual(["Scanning .\nLook at the marker", "Scanning ..\nLook at the marker", "Scanning ...\nLook at the marker", "Scanning .\nLook at the marker"]);
  });

  it("returns portable tones", () => {
    expect(localizationCaptureStatus(view(), { phase: "idle", lastError: null }).color).toBe("muted");
    expect(
      localizationCaptureStatus(
        view({
          connection: "ready",
          hasTrackingOrigin: true,
          capabilities: {
            manipulation: { available: false, reason: "No arm" },
            object_detection: { available: false, reason: "No detector" },
            lidar: { available: true, reason: null },
            navigation: {
              available: true,
              reason: null,
              nav_goal: { preview: false, available: true, reason: null },
              nav_joystick: { available: true, reason: null },
            },
            localization: { available: true, reason: null },
            estop: { available: true, reason: null },
            agent: { available: true, reason: null },
          },
        }),
        { phase: "idle", lastError: null },
      ).color,
    ).toBe("success");
  });
});
