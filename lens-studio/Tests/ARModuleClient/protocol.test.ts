import { describe, it, expect } from "vitest";
import {
  LIDAR_FOURCC,
  LOCALIZATION_OBSERVATIONS_FOURCC,
  TextFramer,
  decodeLidar,
  decodeLocalizationObservations,
  decodeOutbound,
  encodeEstopRequest,
  encodeHelloRequest,
  encodeLidarSettingsRequest,
  encodeLocalizationObservations,
  encodeLocalizationStartRequest,
  encodeNavGoalRequest,
  encodeStateRequest,
  encodeText,
} from "../../Assets/Scripts/ARModuleClient/websocket/protocol";
import type { LocalizationObservation } from "../../Assets/Scripts/ARModuleClient/websocket/types";

const HELLO_FIXTURE = {
  type: "hello",
  client_id: "c3f1a9",
  time_sync: { ts_client: 1234.567, ts_server: 5678.901 },
  robot: {
    display_name: "Unitree Go2",
    body_bounds_m: [0.7, 0.5, 0.55],
    footprint_m: [0.7, 0.5],
    base_height_m: 0.33,
  },
  capabilities: {
    lidar: { available: true, reason: null },
    navigation: { available: true, reason: null },
    localization: { available: true, reason: null },
    estop: { available: true, reason: null },
  },
};

const STATE_FIXTURE = {
  type: "state",
  server: { connected_clients: 1 },
  lidar: {
    enabled: true,
    min_height_m: 0.1,
    max_height_m: 1.5,
    max_range_m: 5.0,
  },
  nav: { state: "idle", outcome: null },
};

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
  it("omits robot_id, protocol_version, and alignment", () => {
    const frames = [
      encodeHelloRequest({ ts_client: 1 }),
      encodeStateRequest(),
      encodeLocalizationStartRequest(),
      encodeEstopRequest(),
      encodeNavGoalRequest({
        position: [1, 0, 0],
        orientation: [0, 0, 0, 1],
      }),
      encodeLidarSettingsRequest({
        enabled: true,
        min_height_m: 0.1,
        max_height_m: 1.5,
        max_range_m: 5.0,
      }),
    ];
    for (const frame of frames) {
      const msg = JSON.parse(frame);
      expect(msg).not.toHaveProperty("robot_id");
      expect(msg).not.toHaveProperty("protocol_version");
      expect(msg).not.toHaveProperty("alignment");
    }
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
    expect(hello).toEqual(HELLO_FIXTURE);
  });

  it("decodes state from PROTOCOL.md", () => {
    const state = decodeOutbound(JSON.stringify(STATE_FIXTURE));
    expect(state).toEqual(STATE_FIXTURE);
  });

  it("decodes both nav_goal shapes", () => {
    const active = decodeOutbound(
      JSON.stringify({
        type: "nav_goal",
        pose: [1.0, 2.0, 0.0, 0.7854],
        path_poses: [
          [0.0, 0.0, 0.0, 0.0],
          [1.0, 2.0, 0.0, 0.7854],
        ],
        ts: 5.0,
      }),
    );
    expect(active).toEqual({
      type: "nav_goal",
      pose: [1.0, 2.0, 0.0, 0.7854],
      path_poses: [
        [0.0, 0.0, 0.0, 0.0],
        [1.0, 2.0, 0.0, 0.7854],
      ],
      ts: 5.0,
    });

    const cleared = decodeOutbound(
      JSON.stringify({ type: "nav_goal", path_poses: [], ts: 6.0 }),
    );
    expect(cleared).toEqual({
      type: "nav_goal",
      pose: null,
      path_poses: [],
      ts: 6.0,
    });
  });

  it("decodes localization_observations_request with and without timeout", () => {
    expect(
      decodeOutbound(
        JSON.stringify({
          type: "localization_observations_request",
          capture_policy: "any_angle",
          observation_count: 1,
        }),
      ),
    ).toEqual({
      type: "localization_observations_request",
      capture_policy: "any_angle",
      observation_count: 1,
    });

    expect(
      decodeOutbound(
        JSON.stringify({
          type: "localization_observations_request",
          capture_policy: "robot_los_required",
          observation_count: 3,
        }),
      ),
    ).toEqual({
      type: "localization_observations_request",
      capture_policy: "robot_los_required",
      observation_count: 3,
    });

    expect(
      decodeOutbound(
        JSON.stringify({
          type: "localization_observations_request",
          capture_policy: "robot_los_preferred",
          observation_count: 3,
          wait_timeout_s: 2.0,
        }),
      ),
    ).toEqual({
      type: "localization_observations_request",
      capture_policy: "robot_los_preferred",
      observation_count: 3,
      wait_timeout_s: 2.0,
    });
  });

  it("decodes localization_result and pose fixtures", () => {
    expect(decodeOutbound(JSON.stringify(LOCALIZATION_RESULT_FIXTURE))).toEqual(
      LOCALIZATION_RESULT_FIXTURE,
    );
    expect(decodeOutbound(JSON.stringify(POSE_FIXTURE))).toEqual(POSE_FIXTURE);
  });

  it("decodes every navigation phase and an unavailable capability", () => {
    for (const nav of [
      { state: "idle", outcome: null },
      { state: "following_path", outcome: null },
      { state: "resolved", outcome: "succeeded" },
      { state: "resolved", outcome: "failed" },
    ]) {
      expect(decodeOutbound(JSON.stringify({ ...STATE_FIXTURE, nav }))).toMatchObject({ nav });
    }

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
    expect(() => decodeOutbound(JSON.stringify({ type: "hello" }))).toThrow(
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
          type: "localization_observations_request",
          capture_policy: "robot_los_preferred",
          observation_count: 3,
        }),
      ),
    ).toThrow(/wait_timeout_s/);
    expect(() =>
      decodeOutbound(
        JSON.stringify({
          type: "localization_observations_request",
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
          type: "localization_observations_request",
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
