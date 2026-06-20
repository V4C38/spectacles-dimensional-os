import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  parseInboundMessage,
  ProtocolParseError,
} from "../../Assets/Scripts/Bridge/Protocol";

describe("parseInboundMessage", () => {
  it("parses hello", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "hello",
        protocol_version: PROTOCOL_VERSION,
        robot: {
          robot_id: "go2",
          robot_model: "unitree_go2",
          display_name: "Go2",
          visual_origin_frame: "base_link",
        },
        capabilities: { lidar: { available: true } },
      }),
    );
    expect(msg!.type).toBe("hello");
    expect((msg as { robot: { robot_id: string } }).robot.robot_id).toBe("go2");
  });

  it("parses align_status", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "align_status",
        ts: 1,
        robot_id: "go2",
        method: "tag",
        state: "ready",
      }),
    );
    expect(msg!.type).toBe("align_status");
    expect((msg as { state: string }).state).toBe("ready");
  });

  it("parses camera_frame_ack", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "camera_frame_ack",
        ts: 1,
        robot_id: "go2",
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
        robot_id: "go2",
        robot_connected: true,
        streams_active: true,
        registered: true,
        reconnecting: false,
      }),
    );
    expect(msg!.type).toBe("bridge_status");
    expect((msg as { robot_connected: boolean }).robot_connected).toBe(true);
  });

  it("parses lidar text form", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "lidar",
        ts: 1,
        robot_id: "go2",
        frame: "world",
        points: [[1, 2, 3]],
      }),
    );
    expect(msg!.type).toBe("lidar");
    expect((msg as { points: number[][] }).points[0]).toEqual([1, 2, 3]);
  });

  it("parses pose", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "pose",
        ts: 1,
        robot_id: "go2",
        frame: "world",
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
        robot_id: "go2",
        trans_delta_m: 0.1,
        yaw_corrected: true,
        solve_quality: 0.9,
        solve_method: "tag",
      }),
    );
    expect(msg!.type).toBe("pose_correction");
    expect((msg as { solve_method: string }).solve_method).toBe("tag");
  });

  it("parses path", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "path",
        ts: 1,
        robot_id: "go2",
        frame: "world",
        waypoints: [[1, 2, 3]],
      }),
    );
    expect(msg!.type).toBe("path");
    expect((msg as { waypoints: number[][] }).waypoints).toHaveLength(1);
  });

  it("parses path_preview", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "path_preview",
        ts: 1,
        robot_id: "go2",
        frame: "world",
        waypoints: [[1, 2, 3]],
        target: [0, 0, 0],
      }),
    );
    expect(msg!.type).toBe("path_preview");
    expect((msg as { target: number[] }).target).toEqual([0, 0, 0]);
  });

  it("parses nav_status", () => {
    const msg = parseInboundMessage(
      JSON.stringify({
        type: "nav_status",
        ts: 1,
        robot_id: "go2",
        state: "idle",
        goal_reached: false,
        goal_failed: false,
      }),
    );
    expect(msg!.type).toBe("nav_status");
    expect((msg as { state: string }).state).toBe("idle");
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
            robot_model: "unitree_go2",
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
            robot_model: "unitree_go2",
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
          robot_id: "go2",
          frame: "world",
          orientation: [0, 0, 0, 1],
        }),
      ),
    ).toThrow(ProtocolParseError);
    try {
      parseInboundMessage(
        JSON.stringify({
          type: "pose",
          ts: 1,
          robot_id: "go2",
          frame: "world",
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
