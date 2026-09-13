import { describe, expect, it } from "vitest";
import {
  deriveSessionLinkPhase,
  sessionLinkStatus,
  sessionLinkTransitionLog,
} from "../../../Assets/Scripts/DimOSARClient/websocket/sessionLinkStatus";
import type { ARModuleSessionState } from "../../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";

function baseView(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
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
    lastError: null,
    ...overrides,
  };
}

describe("deriveSessionLinkPhase", () => {
  it("maps connection and pose to link phases", () => {
    expect(deriveSessionLinkPhase(baseView())).toBe("disconnected");
    expect(deriveSessionLinkPhase(baseView({ connection: "connecting" }))).toBe("connecting");
    expect(deriveSessionLinkPhase(baseView({ connection: "ready", hello: {} as any }))).toBe(
      "robotOffline",
    );
    expect(
      deriveSessionLinkPhase(baseView({ connection: "ready", hello: {} as any, pose: {} as any })),
    ).toBe("connected");
  });
});

describe("sessionLinkStatus", () => {
  it("matches v19 bridge strings", () => {
    expect(sessionLinkStatus(baseView()).text).toContain("Bridge not connected");
    expect(sessionLinkStatus(baseView({ connection: "ready", hello: {} as any })).text).toContain(
      "Robot not connected",
    );
    expect(
      sessionLinkStatus(
        baseView({ connection: "ready", hello: { robot: { display_name: "Go2" } } as any, pose: {} as any }),
        "Go2",
      ).text,
    ).toContain("Bridge connected - Go2");
  });
});

describe("sessionLinkTransitionLog", () => {
  it("logs robot connect/disconnect transitions", () => {
    expect(sessionLinkTransitionLog("connected", "robotOffline")?.consoleText).toBe(
      "Robot disconnected",
    );
    expect(sessionLinkTransitionLog("robotOffline", "connected")?.consoleText).toBe("Robot connected");
  });
});
