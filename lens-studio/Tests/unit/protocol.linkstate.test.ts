import { describe, it, expect } from "vitest";
import {
  deriveLinkState,
  sniffInboundMessageType,
  isNonCriticalInboundMessageType,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";

describe("deriveLinkState", () => {
  it("returns disconnected when not connected", () => {
    expect(deriveLinkState(false, null)).toBe("disconnected");
    expect(
      deriveLinkState(false, {
        type: "bridge_status",
        ts: 1,
        robot_connected: true,
        world_frame_committed: true,
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
        robot_connected: false,
        world_frame_committed: false,
        reconnecting: false,
      }),
    ).toBe("connectedNoRobot");
  });

  it("returns connectedNoRobot when reconnecting despite robot_connected", () => {
    expect(
      deriveLinkState(true, {
        type: "bridge_status",
        ts: 1,
        robot_connected: true,
        world_frame_committed: true,
        reconnecting: true,
      }),
    ).toBe("connectedNoRobot");
  });

  it("returns connected when robot is connected", () => {
    expect(
      deriveLinkState(true, {
        type: "bridge_status",
        ts: 1,
        robot_connected: true,
        world_frame_committed: true,
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
  it("returns true for lidar, pose, world_frame_correction, and agent types", () => {
    expect(isNonCriticalInboundMessageType("lidar")).toBe(true);
    expect(isNonCriticalInboundMessageType("pose")).toBe(true);
    expect(isNonCriticalInboundMessageType("world_frame_correction")).toBe(true);
    expect(isNonCriticalInboundMessageType("agent_response")).toBe(true);
    expect(isNonCriticalInboundMessageType("agent_status")).toBe(true);
    expect(isNonCriticalInboundMessageType("ar_skill")).toBe(true);
  });

  it("returns false for other message types", () => {
    expect(isNonCriticalInboundMessageType("hello")).toBe(false);
    expect(isNonCriticalInboundMessageType("bridge_status")).toBe(false);
    expect(isNonCriticalInboundMessageType(null)).toBe(false);
  });
});
