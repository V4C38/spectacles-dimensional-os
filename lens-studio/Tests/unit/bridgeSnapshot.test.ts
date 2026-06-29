import { describe, it, expect } from "vitest";
import {
  bridgeNavigationReady,
  createDefaultBridgeSnapshot,
} from "../../Assets/Scripts/App/AppState";
import {
  deriveLinkState,
  projectBridgeSnapshot,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";

describe("projectBridgeSnapshot", () => {
  it("returns defaults when handshake is not ready", () => {
    expect(projectBridgeSnapshot(false, null)).toEqual(createDefaultBridgeSnapshot());
  });

  it("returns handshake-only snapshot before status arrives", () => {
    expect(projectBridgeSnapshot(true, null)).toEqual({
      ...createDefaultBridgeSnapshot(),
      handshakeReady: true,
    });
  });

  it("maps bridge_status fields", () => {
    const snapshot = projectBridgeSnapshot(true, {
      type: "bridge_status",
      ts: 42,
      robot_connected: true,
      world_frame_committed: true,
      world_frame_approximate: true,
      reconnecting: false,
      world_frame_method: "manual_pose",
    });
    expect(snapshot).toEqual({
      handshakeReady: true,
      robotConnected: true,
      worldFrameCommitted: true,
      worldFrameApproximate: true,
      reconnecting: false,
      worldFrameMethod: "manual_pose",
      statusTs: 42,
    });
  });
});

describe("bridgeNavigationReady", () => {
  it("is false when reconnecting even if committed", () => {
    expect(
      bridgeNavigationReady({
        handshakeReady: true,
        robotConnected: true,
        worldFrameCommitted: true,
        worldFrameApproximate: false,
        reconnecting: true,
        worldFrameMethod: "april_odom_baseline",
        statusTs: 1,
      }),
    ).toBe(false);
  });

  it("is true when handshake, robot, and committed are ready", () => {
    expect(
      bridgeNavigationReady({
        handshakeReady: true,
        robotConnected: true,
        worldFrameCommitted: true,
        worldFrameApproximate: false,
        reconnecting: false,
        worldFrameMethod: "april_odom_baseline",
        statusTs: 1,
      }),
    ).toBe(true);
  });
});

describe("deriveLinkState reconnecting", () => {
  it("treats reconnecting as connectedNoRobot", () => {
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
});
