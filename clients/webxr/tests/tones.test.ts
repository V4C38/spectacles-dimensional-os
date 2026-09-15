import { describe, expect, it } from "vitest";
import { sessionLinkStatus } from "@dimos-ar-client/websocket/sessionLinkStatus";
import { localizationCaptureStatus } from "@dimos-ar-client/localization/localizationCaptureStatus";
import { toneCss, toneHex } from "../src/presentation/tones";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";

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

describe("WebXR status tones", () => {
  it("maps ClientCore tones to Three.js colors", () => {
    expect(toneHex(sessionLinkStatus(view()).color)).toBe(0xff0000);
    expect(toneCss("error")).toBe("#ff0000");
    expect(toneCss("warn")).toBe("#ffd900");
    expect(
      toneHex(
        localizationCaptureStatus(view(), {
          phase: "idle",
          lastError: null,
        }).color,
      ),
    ).toBe(0x8c8c8c);
  });
});
