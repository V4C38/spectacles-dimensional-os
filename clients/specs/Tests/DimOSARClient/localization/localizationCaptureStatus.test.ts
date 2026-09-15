import { describe, expect, it } from "vitest";
import { localizationCaptureStatus } from "../../../Assets/Scripts/DimOSARClient/localization/localizationCaptureStatus";
import type { ARModuleSessionState } from "../../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";

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
  it("returns portable tones", () => {
    expect(localizationCaptureStatus(view(), { phase: "idle", lastError: null }).color).toBe("muted");
    expect(
      localizationCaptureStatus(
        view({
          connection: "ready",
          hasTrackingOrigin: true,
          capabilities: {
            lidar: { available: true, reason: null },
            navigation: {
              available: true,
              reason: null,
              nav_goal: { available: true, reason: null },
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
