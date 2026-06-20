import { describe, it, expect } from "vitest";
import {
  deriveLinkState,
  sniffInboundMessageType,
  isNonCriticalInboundMessageType,
} from "../../Assets/Scripts/Bridge/Protocol";

describe("deriveLinkState", () => {
  it("returns disconnected when not connected", () => {
    expect(deriveLinkState(false, null)).toBe("disconnected");
    expect(
      deriveLinkState(false, {
        type: "bridge_status",
        ts: 1,
        robot_id: "go2",
        robot_connected: true,
        streams_active: true,
        registered: true,
        reconnecting: false,
      }),
    ).toBe("disconnected");
  });

  it("returns connectedNoRobot when connected without robot", () => {
    expect(deriveLinkState(true, null)).toBe("connectedNoRobot");
    expect(
      deriveLinkState(true, {
        type: "bridge_status",
        ts: 1,
        robot_id: "go2",
        robot_connected: false,
        streams_active: false,
        registered: false,
        reconnecting: false,
      }),
    ).toBe("connectedNoRobot");
  });

  it("returns connected when robot is connected", () => {
    expect(
      deriveLinkState(true, {
        type: "bridge_status",
        ts: 1,
        robot_id: "go2",
        robot_connected: true,
        streams_active: true,
        registered: true,
        reconnecting: false,
      }),
    ).toBe("connected");
  });
});

describe("sniffInboundMessageType", () => {
  it("extracts type from JSON text", () => {
    expect(sniffInboundMessageType('{"type":"pose","ts":1}')).toBe("pose");
  });

  it("returns null on non-JSON garbage", () => {
    expect(sniffInboundMessageType("not json at all")).toBeNull();
  });
});

describe("isNonCriticalInboundMessageType", () => {
  it("returns true for lidar, pose, and pose_correction", () => {
    expect(isNonCriticalInboundMessageType("lidar")).toBe(true);
    expect(isNonCriticalInboundMessageType("pose")).toBe(true);
    expect(isNonCriticalInboundMessageType("pose_correction")).toBe(true);
  });

  it("returns false for other message types", () => {
    expect(isNonCriticalInboundMessageType("hello")).toBe(false);
    expect(isNonCriticalInboundMessageType("bridge_status")).toBe(false);
    expect(isNonCriticalInboundMessageType(null)).toBe(false);
  });
});
