import { helloAt, stateFrame, navigationSnapshot } from "./support/SessionFixture";
import { describe, it, expect } from "vitest";
import {
  LIDAR_FOURCC,
  LOCALIZATION_OBSERVATIONS_FOURCC,
  TextFramer,
  decodeLidar,
  decodeLocalizationObservations,
  decodeOutbound,
  encodeEstopRequest,
  encodeResumeOperationRequest,
  encodeNavGoalRequest,
  encodeClientPose,
  encodeHelloRequest,
  encodeUserMessageRequest,
  encodeLidarSettingsRequest,
  encodeLocalizationObservations,
  encodeLocalizationStartRequest,
  encodeStateRequest,
  encodeNavJoystickRequest,
  encodeText,
} from "../src/websocket/protocol";
import type { LocalizationObservation } from "../src/ClientContracts";

function decodeNavigation(value: Record<string, unknown>) {
  const snapshot = navigationSnapshot(null, value as unknown as import("../src/ClientContracts").NavGoal);
  const decoded = decodeOutbound(JSON.stringify(snapshot));
  if (decoded.type !== "interaction_state") throw new Error("Missing navigation snapshot");
  return (value.preview ? decoded.preview : decoded.active_goal)!;
}

const HELLO_FIXTURE = { ...helloAt(1234.567), time_sync: { ts_client: 1234.567, ts_server: 5678.901 } };

it("preserves actionable local-dictation availability and bounds its setup reason", () => {
  const unavailable = { ...HELLO_FIXTURE, speech_transcription: false,
    speech_transcription_reason: "Install the speech extra in the selected DimOS environment." };
  expect(decodeOutbound(JSON.stringify(unavailable))).toMatchObject({
    speech_transcription: false, speech_transcription_reason: unavailable.speech_transcription_reason,
  });
  expect(() => decodeOutbound(JSON.stringify({ ...unavailable, speech_transcription_reason: "x".repeat(513) })))
    .toThrow(/speech_transcription_reason/);
});

const STATE_FIXTURE = stateFrame();

it("validates canonical stop facts and encodes their matching Resume request", () => {
  expect(JSON.parse(encodeResumeOperationRequest("epoch", "stop"))).toEqual({ type: "resume_operation_request", epoch: "epoch", stop_id: "stop" });
  expect(decodeOutbound(JSON.stringify({ ...STATE_FIXTURE, safety: { stopped: true, can_resume: true, stop_id: "stop" } }))).toMatchObject({ safety: { stopped: true, can_resume: true, stop_id: "stop" } });
  expect(() => decodeOutbound(JSON.stringify({ ...STATE_FIXTURE, safety: { stopped: true, can_resume: true } }))).toThrow(/stop_id/);
  expect(() => decodeOutbound(JSON.stringify({ ...STATE_FIXTURE, safety: { stopped: false, can_resume: true } }))).toThrow(/stopped/);
});

it("decodes optional selected localization providers without inventing absent metadata", () => {
  expect(decodeOutbound(JSON.stringify(HELLO_FIXTURE))).toHaveProperty("localization");
  expect(() => decodeOutbound(JSON.stringify({ ...HELLO_FIXTURE, localization: undefined }))).toThrow(/localization/);
  for (const providers of [[], ["fiducial_marker"], ["vps"], ["fiducial_marker", "vps"]]) {
    expect(decodeOutbound(JSON.stringify({ ...HELLO_FIXTURE, localization: { providers } })))
      .toHaveProperty("localization", { providers });
  }
  for (const localization of [null, {}, { providers: "vps" }, { providers: ["marker"] },
    { providers: [1] }, { providers: ["vps", "vps"] }]) {
    expect(() => decodeOutbound(JSON.stringify({ ...HELLO_FIXTURE, localization }))).toThrow(/localization|providers/);
  }
});

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const PYTHON_LIDAR_ONE = hexToBytes("5241444c000000000000f83f010000000000803f0000004000004040");
const PYTHON_LIDAR_EMPTY = hexToBytes("5241444c000000000000000000000000");
const TYPESCRIPT_LOCA_ONE = hexToBytes(
  "41434f4c01009a000000000000000000f03f0400000066000000000000000000803f00000040000040400000000000000000000000000000803fffd8ffd97b226678223a3130302c226679223a3130302c226378223a35302c226379223a35302c227769647468223a3130302c22686569676874223a3130302c22646973746f7274696f6e5f6d6f64656c223a226e6f6e65222c22646973746f7274696f6e223a5b5d7d",
);

const LOCALIZATION_RESULT_FIXTURE = {
  type: "localization_result",
  position: [1.0, 2.0, 3.0],
  orientation: [0.0, 0.0, 0.0, 1.0],
  confidence: 0.8,
  ts: 100.0,
};

const POSE_FIXTURE = {
  type: "pose",
  position: [1.0, 2.0, 3.0],
  orientation: [0.0, 0.0, 0.0, 1.0],
  ts: 4.0,
};

const INTRINSICS_NONE = {
  fx: 100,
  fy: 100,
  cx: 50,
  cy: 50,
  width: 100,
  height: 100,
  distortion_model: "none" as const,
  distortion: [] as number[],
};

function sampleObservation(overrides: Partial<LocalizationObservation> = {}): LocalizationObservation {
  return {
    ts_capture: 1.0,
    jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    intrinsics: { ...INTRINSICS_NONE },
    camera_position: [1, 2, 3],
    camera_orientation: [0, 0, 0, 1],
    ...overrides,
  };
}

describe("text framing", () => {
  it("appends a newline on every JSON encode", () => {
    expect(encodeText({ type: "state_request" })).toBe('{"type":"state_request"}\n');
    expect(encodeHelloRequest({ ts_client: 99.5 }).endsWith("\n")).toBe(true);
    expect(encodeStateRequest().endsWith("\n")).toBe(true);
    expect(encodeLocalizationStartRequest().endsWith("\n")).toBe(true);
    expect(encodeEstopRequest().endsWith("\n")).toBe(true);
  });

  it("splits batched lines, keeps a partial tail, and ignores blanks", () => {
    const framer = new TextFramer();
    expect(framer.push('{"type":"estop_request"}\n\n{"type":"state_request"}')).toEqual([
      '{"type":"estop_request"}',
    ]);
    expect(framer.push("\n")).toEqual(['{"type":"state_request"}']);
    expect(framer.push("   \n")).toEqual([]);
  });
});

describe("encode inbound JSON", () => {
  it("omits robot_id and alignment while advertising protocol v2", () => {
    const msg = JSON.parse(encodeHelloRequest({ ts_client: 1 }));
    expect(msg).not.toHaveProperty("robot_id");
    expect(msg.protocol_version).toBe(2);
    expect(msg).not.toHaveProperty("alignment");
  });

  it("rejects non-finite hello ts_client", () => {
    expect(() => encodeHelloRequest({ ts_client: Number.NaN })).toThrow(/ts_client/);
  });

  it("rejects inverted lidar band", () => {
    expect(() =>
      encodeLidarSettingsRequest({
        enabled: true,
        min_height_m: 2,
        max_height_m: 1,
        max_range_m: 5,
      }),
    ).toThrow(/min_height_m/);
  });
});

describe("decodeOutbound fixtures", () => {

  it("decodes hello from PROTOCOL.md", () => {
    const hello = decodeOutbound(JSON.stringify(HELLO_FIXTURE));
    expect(hello).toEqual({ ...HELLO_FIXTURE, capabilities: { ...HELLO_FIXTURE.capabilities, navigation: { ...HELLO_FIXTURE.capabilities.navigation, nav_goal: { ...HELLO_FIXTURE.capabilities.navigation.nav_goal, preview: false } } } });
  });

  it("decodes state from PROTOCOL.md", () => {
    const state = decodeOutbound(JSON.stringify(STATE_FIXTURE));
    expect(state).toEqual(STATE_FIXTURE);
  });

  it("decodes navigation endpoints from canonical interaction snapshots", () => {
    const active = decodeNavigation({
        type: "nav_goal",
        pose: [1.0, 2.0, 0.0, 0.7854],
        path_poses: [
          [0.0, 0.0, 0.0, 0.0],
          [1.0, 2.0, 0.0, 0.7854],
        ],
        ts: 5.0,
      });
    expect(active).toEqual({
      type: "nav_goal",
      pose: [1.0, 2.0, 0.0, 0.7854],
      path_poses: [
        [0.0, 0.0, 0.0, 0.0],
        [1.0, 2.0, 0.0, 0.7854],
      ],
      ts: 5.0,
    });

    const cleared = decodeNavigation({ type: "nav_goal", path_poses: [], ts: 6.0 });
    expect(cleared).toEqual({
      type: "nav_goal",
      pose: null,
      path_poses: [],
      ts: 6.0,
    });

    expect(decodeNavigation({ type: "nav_goal", pose: [1, 0, 0, 0], path_poses: [], ts: 1 }))
      .toMatchObject({ pose: [1, 0, 0, 0], path_poses: [] });
    expect(() =>
      decodeNavigation({ type: "nav_goal", path_poses: [[0, 0, 0, 0]], ts: 1 }),
    ).toThrow(/nav_goal.pose is required/);
  });

  it("decodes localization_observations_request with and without timeout", () => {
    expect(
      decodeOutbound(
        JSON.stringify({
          result_timeout_s: 15,
          type: "localization_observations_request", capture_id: "fixture-capture",
          capture_policy: "any_angle",
          observation_count: 1,
        }),
      ),
    ).toEqual({
      result_timeout_s: 15,
      type: "localization_observations_request", capture_id: "fixture-capture",
      capture_policy: "any_angle",
      observation_count: 1,
    });

    expect(
      decodeOutbound(
        JSON.stringify({
          result_timeout_s: 15,
          type: "localization_observations_request", capture_id: "fixture-capture",
          capture_policy: "robot_los_required",
          observation_count: 3,
        }),
      ),
    ).toEqual({
      result_timeout_s: 15,
      type: "localization_observations_request", capture_id: "fixture-capture",
      capture_policy: "robot_los_required",
      observation_count: 3,
    });

    expect(
      decodeOutbound(
        JSON.stringify({
          result_timeout_s: 15,
          type: "localization_observations_request", capture_id: "fixture-capture",
          capture_policy: "robot_los_preferred",
          observation_count: 3,
          wait_timeout_s: 2.0,
        }),
      ),
    ).toEqual({
      result_timeout_s: 15,
      type: "localization_observations_request", capture_id: "fixture-capture",
      capture_policy: "robot_los_preferred",
      observation_count: 3,
      wait_timeout_s: 2.0,
    });
  });

  it("decodes agent_message text and agent_skill frames", () => {
    expect(decodeOutbound(JSON.stringify({ type: "agent_message", text: "  Heading out.  " }))).toEqual({
      type: "agent_message",
      text: "Heading out.",
    });
    expect(
      decodeOutbound(
        JSON.stringify({
          type: "agent_skill",
          name: "ar_place_marker",
          args: { id: "kitchen", x: 1, y: 0, z: 0 },
        }),
      ),
    ).toEqual({
      type: "agent_skill",
      name: "ar_place_marker",
      args: { id: "kitchen", x: 1, y: 0, z: 0 },
    });
    expect(() => decodeOutbound(JSON.stringify({ type: "agent_message", text: "   " }))).toThrow(
      /non-blank/,
    );
  });

  it("encodes client_pose and rejects non-finite pose or a zero quaternion", () => {
    expect(
      JSON.parse(
        encodeClientPose({
          position: [1, 2, 3],
          orientation: [0, 0, 0, 1],
          ts: 12.5,
        }).trim(),
      ),
    ).toEqual({
      type: "client_pose",
      position: [1, 2, 3],
      orientation: [0, 0, 0, 1],
      ts: 12.5,
    });
    expect(() =>
      encodeClientPose({
        position: [Number.NaN, 0, 0],
        orientation: [0, 0, 0, 1],
        ts: 1,
      }),
    ).toThrow(/finite/);
    expect(() =>
      encodeClientPose({
        position: [0, 0, 0],
        orientation: [0, 0, 0, 0],
        ts: 1,
      }),
    ).toThrow(/non-zero/);
  });

  it("encodes user_message_request and rejects blank or oversized text", () => {
    expect(JSON.parse(encodeUserMessageRequest("  go  ").trim())).toEqual({
      type: "user_message_request",
      text: "go",
    });
    expect(() => encodeUserMessageRequest("   ")).toThrow(/non-blank/);
    expect(() => encodeUserMessageRequest("x".repeat(4001))).toThrow(/4000/);
  });

  it("encodes nav_joystick_request and rejects invalid duration or unsupported axes", () => {
    expect(
      JSON.parse(encodeNavJoystickRequest({ epoch: "test", lease_id: "test", sequence: 1, linear: [0.4, 0, 0], angular: [0, 0, 0.3] }).trim()),
    ).toEqual({
      type: "nav_joystick_request", epoch: "test", lease_id: "test", sequence: 1,
      linear: [0.4, 0, 0],
      angular: [0, 0, 0.3],
    });
    expect(
      JSON.parse(
        encodeNavJoystickRequest({ epoch: "test", lease_id: "test", sequence: 1, linear: [0.4, 0, 0], angular: [0, 0, 0], duration: 0.5 }).trim(),
      ),
    ).toEqual({
      type: "nav_joystick_request", epoch: "test", lease_id: "test", sequence: 1,
      linear: [0.4, 0, 0],
      angular: [0, 0, 0],
      duration: 0.5,
    });
    expect(
      JSON.parse(
        encodeNavJoystickRequest({ epoch: "test", lease_id: "test", sequence: 1, linear: [0.4, 0, 0], angular: [0, 0, 0], duration: 0 }).trim(),
      ),
    ).toEqual({
      type: "nav_joystick_request", epoch: "test", lease_id: "test", sequence: 1,
      linear: [0.4, 0, 0],
      angular: [0, 0, 0],
    });
    expect(() =>
      encodeNavJoystickRequest({ epoch: "test", lease_id: "test", sequence: 1, linear: [0.4, 0, 1], angular: [0, 0, 0] }),
    ).toThrow(/linear.z/);
    expect(() =>
      encodeNavJoystickRequest({ epoch: "test", lease_id: "test", sequence: 1, linear: [0.4, 0, 0], angular: [0.1, 0, 0] }),
    ).toThrow(/angular.x/);
    expect(() =>
      encodeNavJoystickRequest({ epoch: "test", lease_id: "test", sequence: 1, linear: [0.4, 0, 0], angular: [0, 0, 0], duration: 2.1 }),
    ).toThrow(/duration/);
    expect(() =>
      encodeNavJoystickRequest({ epoch: "test", lease_id: "test", sequence: 1, linear: [0.4, 0, 0], angular: [0, 0, 0], duration: Number.NaN }),
    ).toThrow(/finite/);
  });

  it("decodes localization_result and pose fixtures", () => {
    expect(decodeOutbound(JSON.stringify(LOCALIZATION_RESULT_FIXTURE))).toEqual(
      LOCALIZATION_RESULT_FIXTURE,
    );
    expect(decodeOutbound(JSON.stringify(POSE_FIXTURE))).toEqual(POSE_FIXTURE);
  });

  it("decodes resolved nav and an unavailable capability", () => {
    expect(
      decodeOutbound(JSON.stringify({ ...STATE_FIXTURE, nav: { state: "resolved", outcome: "succeeded" } })),
    ).toMatchObject({ nav: { state: "resolved", outcome: "succeeded" } });

    const hello = decodeOutbound(
      JSON.stringify({
        ...HELLO_FIXTURE,
        capabilities: {
          ...HELLO_FIXTURE.capabilities,
          localization: { available: false, reason: "no provider configured" },
        },
      }),
    );
    expect(hello).toMatchObject({
      capabilities: { localization: { available: false, reason: "no provider configured" } },
    });
  });

  it("ignores unknown pose keys", () => {
    const pose = decodeOutbound(JSON.stringify({ ...POSE_FIXTURE, speed_mps: 0.5 }));
    expect(pose).toEqual(POSE_FIXTURE);
  });
});

describe("decodeOutbound errors", () => {
  it("throws on missing fields and unknown type", () => {
    expect(() => decodeOutbound(JSON.stringify({
      resume_token: "fixture-resume",
      odom_reference_id: "fixture-odom",
      localization: { providers: ["fiducial_marker"] },
      type: "hello" }))).toThrow(
      /Missing required field/,
    );
    expect(() => decodeOutbound(JSON.stringify({ type: "nope" }))).toThrow(
      /Unknown outbound/,
    );
  });

  it("throws when preferred policy has no timeout or timeout is on another policy", () => {
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          result_timeout_s: 15,
          type: "localization_observations_request", capture_id: "fixture-capture",
          capture_policy: "robot_los_preferred",
          observation_count: 3,
        }),
      ),
    ).toThrow(/wait_timeout_s/);
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          result_timeout_s: 15,
          type: "localization_observations_request", capture_id: "fixture-capture",
          capture_policy: "any_angle",
          observation_count: 3,
          wait_timeout_s: 1,
        }),
      ),
    ).toThrow(/wait_timeout_s/);
  });

  it("throws when nav.outcome does not match nav.state or is omitted", () => {
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          ...STATE_FIXTURE,
          nav: { state: "resolved", outcome: null },
        }),
      ),
    ).toThrow(/nav.outcome/);
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          ...STATE_FIXTURE,
          nav: { state: "idle", outcome: "succeeded" },
        }),
      ),
    ).toThrow(/nav.outcome/);
    expect(() =>
      decodeOutbound(JSON.stringify({ ...STATE_FIXTURE, nav: { state: "idle" } })),
    ).toThrow(/Missing required field: outcome/);
  });

  it("throws when capability reason is omitted or non-null while available", () => {
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          ...HELLO_FIXTURE,
          capabilities: {
            ...HELLO_FIXTURE.capabilities,
            lidar: { available: true },
          },
        }),
      ),
    ).toThrow(/capabilities.lidar.reason/);
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          ...HELLO_FIXTURE,
          capabilities: {
            ...HELLO_FIXTURE.capabilities,
            lidar: { available: true, reason: "ok" },
          },
        }),
      ),
    ).toThrow(/reason=null/);
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          ...HELLO_FIXTURE,
          capabilities: {
            ...HELLO_FIXTURE.capabilities,
            navigation: { available: true, reason: null },
          },
        }),
      ),
    ).toThrow(/capabilities.navigation.nav_goal/);
  });

  it("throws on confidence outside [0, 1], observation_count < 1, and non-finite pose", () => {
    expect(() =>
      decodeOutbound(JSON.stringify({ ...LOCALIZATION_RESULT_FIXTURE, confidence: 1.1 })),
    ).toThrow(/confidence/);
    expect(() =>
      decodeOutbound(JSON.stringify({ ...LOCALIZATION_RESULT_FIXTURE, confidence: -0.1 })),
    ).toThrow(/confidence/);
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          result_timeout_s: 15,
          type: "localization_observations_request", capture_id: "fixture-capture",
          capture_policy: "any_angle",
          observation_count: 0,
        }),
      ),
    ).toThrow(/observation_count/);
    expect(() =>
      decodeOutbound(JSON.stringify({ ...POSE_FIXTURE, position: [1, Number.NaN, 3] })),
    ).toThrow(/position\[1\]/);
    expect(() =>
      decodeOutbound(
        JSON.stringify({ ...POSE_FIXTURE, orientation: [0, 0, 0, Number.POSITIVE_INFINITY] }),
      ),
    ).toThrow(/orientation\[3\]/);
  });
});

describe("lidar binary", () => {
  it("decodes committed Python encode_lidar_binary bytes", () => {
    expect(new DataView(PYTHON_LIDAR_ONE.buffer).getUint32(0, true)).toBe(LIDAR_FOURCC);
    expect(decodeLidar(PYTHON_LIDAR_ONE)).toEqual({
      type: "lidar",
      ts: 1.5,
      points: [[1, 2, 3]],
    });
    expect(decodeLidar(PYTHON_LIDAR_EMPTY)).toEqual({
      type: "lidar",
      ts: 0,
      points: [],
    });
  });

  it("throws on short buffer, bad FourCC, truncated points, or non-finite points", () => {
    expect(() => decodeLidar(new Uint8Array([1, 2, 3]))).toThrow(/too short/);
    const bad = PYTHON_LIDAR_ONE.slice();
    new DataView(bad.buffer).setUint32(0, 0x11111111, true);
    expect(() => decodeLidar(bad)).toThrow(/fourcc/);
    expect(() => decodeLidar(PYTHON_LIDAR_ONE.subarray(0, PYTHON_LIDAR_ONE.length - 1))).toThrow(
      /payload length/,
    );
    const padded = new Uint8Array(PYTHON_LIDAR_ONE.length + 3);
    padded.set(PYTHON_LIDAR_ONE);
    expect(() => decodeLidar(padded)).toThrow(/payload length/);
    const nanPoint = PYTHON_LIDAR_ONE.slice();
    new DataView(nanPoint.buffer).setFloat32(16, Number.NaN, true);
    expect(() => decodeLidar(nanPoint)).toThrow(/finite/);
  });
});

describe("localization_observations binary", () => {
  it("writes camera at body offset 20 with reserved 0 at 16", () => {
    const frame = encodeLocalizationObservations([sampleObservation()]);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(0, true)).toBe(LOCALIZATION_OBSERVATIONS_FOURCC);
    expect(view.getUint16(4, true)).toBe(1);
    const recordStart = 10;
    expect(view.getFloat64(recordStart, true)).toBeCloseTo(1.0);
    expect(view.getUint32(recordStart + 16, true)).toBe(0);
    expect(view.getFloat32(recordStart + 20, true)).toBeCloseTo(1);
    expect(view.getFloat32(recordStart + 24, true)).toBeCloseTo(2);
    expect(view.getFloat32(recordStart + 28, true)).toBeCloseTo(3);
    expect(view.getFloat32(recordStart + 32, true)).toBeCloseTo(0);
    expect(view.getFloat32(recordStart + 44, true)).toBeCloseTo(1);
    expect(Array.from(frame.subarray(recordStart + 48, recordStart + 52))).toEqual([
      0xff, 0xd8, 0xff, 0xd9,
    ]);
  });

  it("round-trips one and two observations", () => {
    const first = sampleObservation();
    const second = sampleObservation({
      ts_capture: 2.5,
      jpeg: new Uint8Array([1, 2, 3]),
      camera_position: [0, 0, 1],
    });
    expect(decodeLocalizationObservations(encodeLocalizationObservations([first]))).toEqual({
      type: "localization_observations",
      observations: [first],
    });
    const decoded = decodeLocalizationObservations(encodeLocalizationObservations([first, second]));
    expect(decoded.observations).toHaveLength(2);
    expect(decoded.observations[1]).toEqual(second);
  });

  it("matches the committed LOCA bytes decoded by protocol.py", () => {
    expect(encodeLocalizationObservations([sampleObservation()])).toEqual(TYPESCRIPT_LOCA_ONE);
    expect(decodeLocalizationObservations(TYPESCRIPT_LOCA_ONE)).toEqual({
      type: "localization_observations",
      observations: [sampleObservation()],
    });
  });

  it("rejects an empty batch, non-empty none-distortion, and bad records", () => {
    expect(() => encodeLocalizationObservations([])).toThrow(/at least one/);
    expect(() =>
      encodeLocalizationObservations([
        sampleObservation({
          intrinsics: { ...INTRINSICS_NONE, distortion: [0.1] },
        }),
      ]),
    ).toThrow(/distortion must be empty/);

    expect(() => decodeLocalizationObservations(new Uint8Array([1, 2, 3]))).toThrow(/too short/);

    const reserved = encodeLocalizationObservations([sampleObservation()]);
    new DataView(reserved.buffer, reserved.byteOffset, reserved.byteLength).setUint32(26, 1, true);
    expect(() => decodeLocalizationObservations(reserved)).toThrow(/reserved/);

    const truncated = encodeLocalizationObservations([sampleObservation()]);
    new DataView(truncated.buffer, truncated.byteOffset, truncated.byteLength).setUint32(
      6,
      10,
      true,
    );
    expect(() => decodeLocalizationObservations(truncated)).toThrow(/header truncated|record_len/);

    const trailing = encodeLocalizationObservations([sampleObservation()]);
    const padded = new Uint8Array(trailing.length + 1);
    padded.set(trailing);
    expect(() => decodeLocalizationObservations(padded)).toThrow(/trailing/);

    const badJson = encodeLocalizationObservations([sampleObservation()]);
    const view = new DataView(badJson.buffer, badJson.byteOffset, badJson.byteLength);
    const jpegLen = view.getUint32(18, true);
    const jsonStart = 10 + 48 + jpegLen;
    badJson[jsonStart] = 0x7b;
    badJson[jsonStart + 1] = 0x00;
    expect(() => decodeLocalizationObservations(badJson)).toThrow(/intrinsics/);
  });
});

it("decodes explicit preview support and ordinary goals", () => {
  const hello = structuredClone(HELLO_FIXTURE);
  Object.assign(hello.capabilities.navigation.nav_goal, { preview: true });
  const decoded = decodeOutbound(JSON.stringify(hello));
  expect(decoded.type === "hello" && decoded.capabilities.navigation.nav_goal.preview).toBe(true);
  expect(JSON.parse(encodeNavGoalRequest({ epoch: "test", lease_id: "test", sequence: 1, position: [1, 2, 0], orientation: [0, 0, 0, 1], preview: true })).preview).toBe(true);
  expect(JSON.parse(encodeNavGoalRequest({ epoch: "test", lease_id: "test", sequence: 1, position: [1, 2, 0], orientation: [0, 0, 0, 1] })).preview).toBeUndefined();
  expect(decodeNavigation({ type: "nav_goal", preview: true, path_poses: [], ts: 1 })).toEqual({ type: "nav_goal", preview: true, pose: null, path_poses: [], ts: 1 });
  expect(() => decodeNavigation({ type: "nav_goal", preview: "true", path_poses: [], ts: 1 })).toThrow(/boolean/);
});

it("preserves preview correlation and rejects malformed identities without changing normal goals", () => {
  const pose = { position: [1, 2, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] };
  const request = JSON.parse(encodeNavGoalRequest({ epoch: "test", lease_id: "test", sequence: 1, ...pose, preview: true, preview_id: "aim-1" }));
  expect(request.preview_id).toBe("aim-1");
  expect(decodeNavigation({ type: "nav_goal", preview: true, preview_id: "aim-1", path_poses: [], ts: 1 })).toMatchObject({ preview_id: "aim-1", preview: true });
  expect(() => encodeNavGoalRequest({ epoch: "test", lease_id: "test", sequence: 1, ...pose, preview_id: "aim-1" })).toThrow(/requires preview/);
  expect(() => encodeNavGoalRequest({ epoch: "test", lease_id: "test", sequence: 1, ...pose, preview: true, preview_id: "" })).toThrow(/preview_id/);
  expect(() => decodeNavigation({ type: "nav_goal", preview: true, preview_id: 7, path_poses: [], ts: 1 })).toThrow(/preview_id/);
});

it("decodes optional server display metadata", () => {
  const old = decodeOutbound(JSON.stringify(HELLO_FIXTURE));
  expect(old.type === "hello" && old.server_info).toBeUndefined();
  const info = { robot_ip: "192.168.1.42", dimos_version: "0.4.0", armodule_version: "0.2.0" };
  const next = decodeOutbound(JSON.stringify({ ...HELLO_FIXTURE, server_info: info }));
  expect(next.type === "hello" && next.server_info).toEqual(info);
  expect(() => decodeOutbound(JSON.stringify({ ...HELLO_FIXTURE, server_info: { robot_ip: 42 } }))).toThrow();
});

it("decodes optional localization result deadlines and rejects invalid values", () => {
  const request = { result_timeout_s: 15, type: "localization_observations_request", capture_id: "fixture-capture", capture_policy: "any_angle", observation_count: 1 };
  expect(decodeOutbound(JSON.stringify(request))).toEqual(request);
  expect(decodeOutbound(JSON.stringify({ ...request, result_timeout_s: 15 }))).toEqual({ ...request, result_timeout_s: 15 });
  for (const invalid of [0, -1, null, true, "15"]) {
    expect(() => decodeOutbound(JSON.stringify({ ...request, result_timeout_s: invalid }))).toThrow();
  }
});

it("accepts the required robot XY heuristic", () => {
  expect((decodeOutbound(JSON.stringify(HELLO_FIXTURE)) as import("../src/ClientContracts").Hello).robot).toEqual(HELLO_FIXTURE.robot);
  const hello = { ...HELLO_FIXTURE, robot: { ...HELLO_FIXTURE.robot, odom_scale_correction_factor: 1.25 } };
  expect((decodeOutbound(JSON.stringify(hello)) as import("../src/ClientContracts").Hello).robot).toEqual(hello.robot);
  for (const scale of [0, -1, null, true, "1.25"]) {
    expect(() => decodeOutbound(JSON.stringify({ ...hello, robot: { ...hello.robot, odom_scale_correction_factor: scale } }))).toThrow();
  }
});

it("rejects zero quaternions consistently in navigation, telemetry and camera observations", () => {
  expect(() => encodeNavGoalRequest({ epoch: "test", lease_id: "test", sequence: 1, position: [0, 0, 0], orientation: [0, 0, 0, 0] })).toThrow(/non-zero/);
  expect(() => decodeOutbound(JSON.stringify({ ...POSE_FIXTURE, orientation: [0, 0, 0, 0] }))).toThrow(/non-zero/);
  expect(() => decodeOutbound(JSON.stringify({ ...LOCALIZATION_RESULT_FIXTURE, orientation: [0, 0, 0, 0] }))).toThrow(/non-zero/);
  expect(() => encodeLocalizationObservations([sampleObservation({ camera_orientation: [0, 0, 0, 0] })])).toThrow(/non-zero/);
  expect(() => encodeLocalizationObservations([sampleObservation({ camera_position: [Number.MAX_VALUE, 0, 0] })])).toThrow(/float32/);
});

it.each([
  { width: 0 }, { width: -1 }, { height: 1.5 }, { width: true },
  { fx: 0 }, { fy: -1 }, { fx: "100" }, { fy: null },
])("rejects invalid camera calibration values %j", invalid => {
  expect(() => encodeLocalizationObservations([sampleObservation({ intrinsics: { ...INTRINSICS_NONE, ...invalid } as never })])).toThrow();
});

it("validates decoded calibration through the same positive-dimension and focal-length checks", () => {
  for (const [field, replacement] of [["width", '"width":0  '], ["fx", '"fx":0  ']] as const) {
    const data = encodeLocalizationObservations([sampleObservation()]);
    const marker = new TextEncoder().encode(`"${field}":100`);
    const at = data.findIndex((_, i) => marker.every((byte, j) => data[i + j] === byte));
    expect(at).toBeGreaterThan(0);
    data.set(new TextEncoder().encode(replacement), at);
    expect(() => decodeLocalizationObservations(data)).toThrow(/positive/);
  }
});

it("decodes recording source and rejects malformed read-only metadata", () => {
  const source = {kind: "recording", read_only: true, name: "arm.db"};
  expect((decodeOutbound(JSON.stringify({...HELLO_FIXTURE, source})) as any).source).toEqual(source);
  expect(() => decodeOutbound(JSON.stringify({...HELLO_FIXTURE, source: {...source, read_only: "true"}}))).toThrow();
});

it("decodes bounded playback progress and rejects invalid progress", () => {
  const playback = {state: "ended", elapsed_s: 2, duration_s: 2};
  expect((decodeOutbound(JSON.stringify({...STATE_FIXTURE, playback})) as any).playback).toEqual(playback);
  expect(() => decodeOutbound(JSON.stringify({...STATE_FIXTURE, playback: {...playback, elapsed_s: 3}}))).toThrow();

});

it("preserves the validated finishing tail in native and shared interaction snapshots", () => {
  const tail = { generation: 4, group_id: "arm", target_revision: 3, status: "finishing",
    position: [0.1, 0.2, 0.3], orientation: [0, 0, 0, 1], speed_scale: 0.5, joints: { joint: 0.2 } };
  const native = { type: "manipulation_state", available: false, following_tail: tail };
  const shared = {
    targets: [],
    motion_busy: false,
    type: "interaction_state", epoch: "robot", revision: 5, mode: "manual",
    authority: null, target: null, preview: null, active_goal: null, following_tail: tail };
  for (const snapshot of [native, shared]) {
    expect((decodeOutbound(JSON.stringify(snapshot)) as any).following_tail).toEqual(tail);
    for (const invalid of [{generation: -1}, {group_id: ""}, {target_revision: 1.2},
      {status: "completed"}, {orientation: [0,0,0,0]}, {speed_scale: 0}, {joints: {joint: null}}]) {
      expect(() => decodeOutbound(JSON.stringify({...snapshot, following_tail: {...tail, ...invalid}}))).toThrow();
    }
  }
});

it("validates revision-bound observational arm evaluations", () => {
  const evaluation = { group_id: "arm", target_revision: 2, joints: { slide: 0.3 }, pose: null };
  const message = { type: "manipulation_state", available: false, evaluation };
  expect((decodeOutbound(JSON.stringify(message)) as any).evaluation).toEqual(evaluation);
  for (const invalid of [{ group_id: "" }, { target_revision: -1 }, { target_revision: 1.5 },
    { joints: { slide: null } }, { joints: null }, { pose: { position: [0,0,0], orientation: [0,0,0,0] } }]) {
    expect(() => decodeOutbound(JSON.stringify({ ...message, evaluation: { ...evaluation, ...invalid } }))).toThrow();
  }
});


it.each([
  "localization", "resume_token", "odom_reference_id", "robot.odom_scale_correction_factor",
  "capabilities.manipulation", "capabilities.object_detection", "capabilities.navigation.nav_goal.preview",
])("requires current hello metadata: %s", field => {
  const hello = structuredClone(HELLO_FIXTURE) as any;
  const path = field.split(".");
  const owner = path.slice(0, -1).reduce((value, key) => value[key], hello);
  delete owner[path.at(-1)!];
  expect(() => decodeOutbound(JSON.stringify(hello))).toThrow();
});

it("requires authority credentials on every navigation command", () => {
  expect(() => encodeNavGoalRequest({ position: [0, 0, 0], orientation: [0, 0, 0, 1] } as never)).toThrow(/authority/);
  expect(() => encodeNavJoystickRequest({ linear: [0, 0, 0], angular: [0, 0, 0] } as never)).toThrow(/authority/);
});

it("rejects standalone navigation publications", () => {
  expect(() => decodeOutbound(JSON.stringify({ type: "nav_goal", ts: 1, path_poses: [] }))).toThrow(/Unknown outbound/);
});
