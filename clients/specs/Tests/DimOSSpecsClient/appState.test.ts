import { describe, expect, it } from "vitest";
import {
  AppState,
  agentModeAccessible,
  agentSpeechShouldRun,
  getRobotActivityState,
  robotTitleText,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/AppState";
import { NO_ROBOT_CONNECTED_LABEL } from "../../Assets/Scripts/DimOSARClient/websocket/sessionLinkStatus";
import type { ARModuleSessionState } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type { Hello, Pose, RobotDescription } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

const GO2: RobotDescription = {
  display_name: "Unitree Go2",
  body_bounds_m: [0.7, 0.5, 0.55],
  footprint_m: [0.7, 0.5],
  base_height_m: 0.33,
};

const POSE: Pose = {
  position: [1, 2, 3],
  orientation: [0, 0, 0, 1],
};

function baseView(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
  return {
    connection: "ready",
    hasTrackingOrigin: false,
    hello: null,
    state: null,
    pose: null,
    nav_goal: null,
    lidar: null,
    capabilities: null,
    nav: null,
    agentText: null,
    lastError: null,
    ...overrides,
  };
}

function helloView(): Hello {
  return {
    type: "hello",
    client_id: "test-client",
    time_sync: { ts_client: 0, ts_server: 0 },
    robot: GO2,
    capabilities: {
      lidar: { available: true, reason: null },
      navigation: { available: true, reason: null },
      localization: { available: true, reason: null },
      estop: { available: true, reason: null },
      agent: { available: false, reason: "current blueprint has no DimOS agent" },
    },
  };
}

describe("AppState", () => {
  it("stores debug mode", () => {
    const state = new AppState();
    expect(state.debugModeEnabled).toBe(false);
    state.setDebugMode(true);
    expect(state.debugModeEnabled).toBe(true);
  });

  it("clears operating mode when the wizard is reset", () => {
    const state = new AppState();
    state.setOperatingMode("agent");
    state.finishWizard(true);
    state.resetWizard();
    expect(state.operatingMode).toBe("manual");
    expect(state.wizardFinished).toBe(false);
  });
});

describe("robotTitleText", () => {
  it("shows no robot connected when the session is not attached", () => {
    expect(robotTitleText(baseView({ connection: "disconnected" }))).toBe(
      NO_ROBOT_CONNECTED_LABEL,
    );
    expect(robotTitleText(baseView({ connection: "connecting" }))).toBe(NO_ROBOT_CONNECTED_LABEL);
  });

  it("shows robot display name once the session is attached", () => {
    expect(
      robotTitleText(baseView({ connection: "ready", hello: helloView(), pose: POSE })),
    ).toBe("Unitree Go2");
  });
});

const VOICE_OFF = { asrRunning: false, ttsPlaying: false };

describe("agentModeAccessible", () => {
  it("unlocks agent when the capability is available or debug is on", () => {
    expect(agentModeAccessible(true, false)).toBe(true);
    expect(agentModeAccessible(false, true)).toBe(true);
    expect(agentModeAccessible(false, false)).toBe(false);
  });
});

describe("agentSpeechShouldRun", () => {
  it("runs live agent speech only when ready and capable", () => {
    expect(agentSpeechShouldRun("agent", false, true, true)).toBe(true);
    expect(agentSpeechShouldRun("agent", false, false, true)).toBe(false);
    expect(agentSpeechShouldRun("agent", false, true, false)).toBe(false);
    expect(agentSpeechShouldRun("manual", false, true, true)).toBe(false);
  });

  it("runs speech in debug agent mode without a session or capability", () => {
    expect(agentSpeechShouldRun("agent", true, false, false)).toBe(true);
    expect(agentSpeechShouldRun("manual", true, false, false)).toBe(false);
  });
});

describe("getRobotActivityState", () => {
  it("returns Idle when nav is null, idle, or resolved", () => {
    expect(getRobotActivityState(baseView({ nav: null }), VOICE_OFF)).toBe("Idle");
    expect(
      getRobotActivityState(baseView({ nav: { state: "idle", outcome: null } }), VOICE_OFF),
    ).toBe("Idle");
  });

  it("returns Following Path when nav is following_path, even while listening or thinking", () => {
    expect(
      getRobotActivityState(baseView({ nav: { state: "following_path", outcome: null } }), {
        asrRunning: true,
        ttsPlaying: true,
      }),
    ).toBe("Following Path");
    expect(
      getRobotActivityState(
        baseView({
          nav: { state: "following_path", outcome: null },
          state: {
            type: "state",
            server: { connected_clients: 1 },
            lidar: { enabled: false, min_height_m: 0, max_height_m: 1, max_range_m: 1 },
            nav: { state: "following_path", outcome: null },
            agent: { idle: false },
          },
        }),
        { asrRunning: true, ttsPlaying: true },
      ),
    ).toBe("Following Path");
  });

  it("returns Thinking when the agent is not idle", () => {
    expect(
      getRobotActivityState(
        baseView({
          state: {
            type: "state",
            server: { connected_clients: 1 },
            lidar: { enabled: false, min_height_m: 0, max_height_m: 1, max_range_m: 1 },
            nav: { state: "idle", outcome: null },
            agent: { idle: false },
          },
        }),
        { asrRunning: true, ttsPlaying: true },
      ),
    ).toBe("Thinking");
  });

  it("returns Responding while TTS is playing", () => {
    expect(getRobotActivityState(baseView(), { asrRunning: true, ttsPlaying: true })).toBe(
      "Responding",
    );
  });

  it("returns Listening while ASR is running", () => {
    expect(getRobotActivityState(baseView(), { asrRunning: true, ttsPlaying: false })).toBe(
      "Listening",
    );
  });
});
