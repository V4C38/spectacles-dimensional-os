import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  parseInboundMessage,
  ProtocolParseError,
  bridgeStatusFromSnapshot,
  RuntimeSnapshotMessage,
} from "../../Assets/Scripts/Bridge/Protocol";

describe("parseInboundMessage", () => {
  it("parses hello", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "hello",
        protocol_version: PROTOCOL_VERSION,
        robot: {
          robot_id: "go2",
          display_name: "Go2",
          visual_origin_frame: "base_link",
          registration_profile: {
            tag_ids: [0],
            tag_total_size_m: 0.07,
          },
        },
        capabilities: { lidar: { available: true } },
      }),
    );
    expect(msg!.type).toBe("hello");
    expect((msg as { robot: { robot_id: string } }).robot.robot_id).toBe("go2");
    expect(
      (msg as { robot: { registration_profile: { tag_ids: number[] } } }).robot
        .registration_profile?.tag_ids,
    ).toEqual([0]);
  });

  it("parses runtime_snapshot and bridgeStatusFromSnapshot", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "runtime_snapshot",
        ts: 1,
        robot_id: "go2",
        bridge: {
          robot_connected: true,
          registered: false,
          reconnecting: false,
          registration_method: null,
          registration_approximate: false,
        },
        nav: { phase: "idle" },
        path: {
          kind: "active",
          waypoints: [[1, 2, 3]],
        },
      }),
    );
    expect(msg!.type).toBe("runtime_snapshot");
    const snapshot = msg as RuntimeSnapshotMessage;
    expect(snapshot.path?.kind).toBe("active");
    const bridge = bridgeStatusFromSnapshot(snapshot);
    expect(bridge.type).toBe("bridge_status");
    expect(bridge.robot_connected).toBe(true);
    expect(bridge.registered).toBe(false);
  });

  it("parses registration_status", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "registration_status",
        ts: 1,
        mode: "april_odom_baseline",
        phase: "scanning",
        capture: "steady",
        message: "Look at tag",
        tag_visible: true,
        motion: {
          frame: "robot",
          axis: "lateral",
          direction: "left",
          distance_m: 0.5,
          waypoint_index: 1,
          waypoint_total: 2,
        },
      }),
    );
    expect(msg!.type).toBe("registration_status");
    expect((msg as { phase: string }).phase).toBe("scanning");
    expect((msg as { capture: string }).capture).toBe("steady");
  });

  it("parses camera_frame_ack", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "camera_frame_ack",
        ts: 1,
        seq: 5,
      }),
    );
    expect(msg!.type).toBe("camera_frame_ack");
    expect((msg as { seq: number }).seq).toBe(5);
  });

  it("parses bridge_status", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "bridge_status",
        ts: 1,
        robot_connected: true,
        registered: true,
        reconnecting: false,
      }),
    );
    expect(msg!.type).toBe("bridge_status");
    expect((msg as { robot_connected: boolean }).robot_connected).toBe(true);
  });

  it("returns null for JSON lidar (binary only in v6)", () => {
    expect(
      parseInboundMessage(
        JSON.stringify({
          type: "lidar",
          ts: 1,
          points: [[1, 2, 3]],
        }),
      ),
    ).toBeNull();
  });

  it("parses pose", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "pose",
        ts: 1,
        position: [1, 2, 3],
        orientation: [0, 0, 0, 1],
      }),
    );
    expect(msg!.type).toBe("pose");
    expect((msg as { position: number[] }).position).toEqual([1, 2, 3]);
  });

  it("parses pose_correction", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "pose_correction",
        ts: 1,
        trans_delta_m: 0.1,
        yaw_corrected: true,
        solve_quality: 0.9,
        solve_method: "apriltag_full",
      }),
    );
    expect(msg!.type).toBe("pose_correction");
    expect((msg as { solve_method: string }).solve_method).toBe("apriltag_full");
  });

  it("parses path with kind active", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "path",
        ts: 1,
        kind: "active",
        waypoints: [[1, 2, 3]],
      }),
    );
    expect(msg!.type).toBe("path");
    expect((msg as { kind: string }).kind).toBe("active");
    expect((msg as { waypoints: number[][] }).waypoints).toHaveLength(1);
  });

  it("parses path with kind preview and target", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "path",
        ts: 1,
        kind: "preview",
        waypoints: [[1, 2, 3]],
        target: [0, 0, 0],
      }),
    );
    expect(msg!.type).toBe("path");
    expect((msg as { kind: string }).kind).toBe("preview");
    expect((msg as { target: number[] }).target).toEqual([0, 0, 0]);
  });

  it("parses nav_status phase", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "nav_status",
        ts: 1,
        phase: "idle",
      }),
    );
    expect(msg!.type).toBe("nav_status");
    expect((msg as { phase: string }).phase).toBe("idle");
  });

  it("parses pong", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "pong",
        ts: 1,
        robot_id: "go2",
        client_ts: 2,
        bridge_ts: 3,
      }),
    );
    expect(msg!.type).toBe("pong");
    expect((msg as { client_ts: number }).client_ts).toBe(2);
  });

  it("rejects unsupported hello protocol version", () => {
    expect(() =>
      parseInboundMessage(
        JSON.stringify({
          type: "hello",
          protocol_version: 3,
          robot: {
            robot_id: "go2",
            display_name: "Go2",
            visual_origin_frame: "base_link",
          },
          capabilities: {},
        }),
      ),
    ).toThrow(ProtocolParseError);
    try {
      parseInboundMessage(
        JSON.stringify({
          type: "hello",
          protocol_version: 3,
          robot: {
            robot_id: "go2",
            display_name: "Go2",
            visual_origin_frame: "base_link",
          },
          capabilities: {},
        }),
      );
    } catch (err) {
      expect((err as ProtocolParseError).kind).toBe("schema");
    }
  });

  it("throws schema error when pose is missing position", () => {
    expect(() =>
      parseInboundMessage(
        JSON.stringify({
          type: "pose",
          ts: 1,
          orientation: [0, 0, 0, 1],
        }),
      ),
    ).toThrow(ProtocolParseError);
    try {
      parseInboundMessage(
        JSON.stringify({
          type: "pose",
          ts: 1,
          orientation: [0, 0, 0, 1],
        }),
      );
    } catch (err) {
      expect((err as ProtocolParseError).kind).toBe("schema");
    }
  });

  it("throws json error on invalid JSON", () => {
    expect(() => parseInboundMessage("{not json")).toThrow(ProtocolParseError);
    try {
      parseInboundMessage("{not json");
    } catch (err) {
      expect((err as ProtocolParseError).kind).toBe("json");
    }
  });

  it("returns null for unknown message type", () => {
    expect(parseInboundMessage('{"type":"banana"}')).toBeNull();
  });
});
