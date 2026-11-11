import { helloAt } from "../fixtures/SessionFixture";
import { describe, expect, it } from "vitest";
import {
  deriveRobotMarkerApplyInput,
  getRobotActivityState,
  robotTitleText,
} from "../../Assets/Scripts/DimOSARClient/robot/RobotMarkerState";
import { NO_ROBOT_CONNECTED_LABEL } from "../../Assets/Scripts/DimOSARClient/websocket/sessionLinkStatus";
import type { ARModuleSessionState } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type { ClientTrackingOrigin } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import type { Hello, Pose, RobotDescription } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

const GO2: RobotDescription = {
  odom_scale_correction_factor: 1,
  display_name: "Unitree Go2",
  body_bounds_m: [0.7, 0.5, 0.55],
  footprint_m: [0.7, 0.5],
  base_height_m: 0.33,
};

const POSE: Pose = {
  position: [1, 2, 3],
  orientation: [0, 0, 0, 1],
};

const ORIGIN: ClientTrackingOrigin = {
  position: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  confidence: 1,
  ts: 0,
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
    capabilities: overrides.hello?.capabilities ?? null,
    nav: null,
    agentMessage: null,
    lastError: null,
    ...overrides,
  };
}

function helloView(): Hello {
  return { ...helloAt(0), client_id: "test-client", robot: GO2,
    time_sync: { ts_client: 0, ts_server: 0 } };
}

describe("deriveRobotMarkerApplyInput", () => {
  it.each([[true, false], [false, true], [true, true], [false, false]])(
    "uses only navigation capability for marker visibility (navigation=%s, manipulation=%s)",
    (navigation, manipulation) => {
      const hello = helloView();
      hello.capabilities.navigation.available = navigation;
      hello.capabilities.manipulation = { available: manipulation, reason: null };
      const view = baseView({ hello, hasTrackingOrigin: true, pose: POSE });
      expect(deriveRobotMarkerApplyInput({ setupCompleted: true, view, origin: ORIGIN }).mode)
        .toBe(navigation ? "localizedOdom" : "hidden");
    },
  );


  it("returns hidden before setup is completed", () => {
    expect(
      deriveRobotMarkerApplyInput({
        setupCompleted: false,
        view: baseView(),
        origin: null,
      }),
    ).toEqual({ mode: "hidden" });
  });

  it("hides the marker after skip-connect without advertised capabilities", () => {
    const view = baseView({ hello: null });
    expect(
      deriveRobotMarkerApplyInput({
        setupCompleted: true,
        view,
        origin: null,
      }),
    ).toEqual({ mode: "hidden" });
  });

  it("returns unlocalizedFallbackPosition with hello robot when not localized", () => {
    const view = baseView({ hello: helloView() });
    expect(
      deriveRobotMarkerApplyInput({
        setupCompleted: true,
        view,
        origin: null,
      }),
    ).toEqual({
      mode: "unlocalizedFallbackPosition",
      robot: GO2,
      view,
    });
  });

  it("promotes to localizedOdom when a later capture sets the tracking origin", () => {
    const view = baseView({
      hasTrackingOrigin: true,
      hello: helloView(),
      pose: POSE,
    });
    expect(
      deriveRobotMarkerApplyInput({
        setupCompleted: true,
        view,
        origin: ORIGIN,
      }),
    ).toEqual({
      mode: "localizedOdom",
      robot: GO2,
      pose: POSE,
      origin: ORIGIN,
      view,
    });
  });

  it("falls back when hello remains after origin is cleared", () => {
    const view = baseView({ hello: helloView(), hasTrackingOrigin: false, pose: null });
    expect(
      deriveRobotMarkerApplyInput({
        setupCompleted: true,
        view,
        origin: null,
      }),
    ).toEqual({
      mode: "unlocalizedFallbackPosition",
      robot: GO2,
      view,
    });
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
