import { describe, it, expect } from "vitest";
import type { HelloMessage } from "../../Assets/Scripts/Bridge/Protocol";
import {
  createDefaultRobotRuntimeState,
  type RobotRuntimeState,
} from "../../Assets/Scripts/Core/AppState";
import {
  projectRuntimeStateFromHello,
  runtimeDeadzoneRadiusCm,
  runtimeRenderOffsetCm,
  robotBodyHeightM,
  lidarVerticalBandCm,
  robotFloorWorldYCm,
  isCapabilityAvailable,
  capabilityUnavailableReason,
} from "../../Assets/Scripts/Robot/RobotRuntimeModel";

function sampleHello(
  patch: Partial<HelloMessage["robot"]> = {},
  capabilities: HelloMessage["capabilities"] = {
    lidar: { available: true },
    nav: { available: false, reason: "sim only" },
  },
): HelloMessage {
  return {
    type: "hello",
    protocol_version: 7,
    robot: {
      robot_id: "go2",
      display_name: "Go2",
      visual_origin_frame: "base_link",
      ...patch,
    },
    capabilities,
  };
}

describe("projectRuntimeStateFromHello", () => {
  it("maps hello handshake into negotiated runtime state", () => {
    const state = projectRuntimeStateFromHello(sampleHello());
    expect(state.negotiated).toBe(true);
    expect(state.robotId).toBe("go2");
    expect(state.displayName).toBe("Go2");
    expect(state.capabilities.lidar.available).toBe(true);
    expect(state.capabilities.nav.available).toBe(false);
    expect(state.capabilities.nav.reason).toBe("sim only");
  });
});

describe("runtimeDeadzoneRadiusCm", () => {
  it("returns fallback when not negotiated", () => {
    const state: RobotRuntimeState = {
      ...createDefaultRobotRuntimeState(),
      negotiated: false,
      footprintM: [0.4, 0.6],
    };
    expect(runtimeDeadzoneRadiusCm(state, 30)).toBe(30);
  });

  it("computes radius from negotiated footprint", () => {
    const state: RobotRuntimeState = {
      ...createDefaultRobotRuntimeState(),
      negotiated: true,
      footprintM: [0.4, 0.6],
    };
    expect(runtimeDeadzoneRadiusCm(state, 30)).toBe(50);
  });
});

describe("runtimeRenderOffsetCm", () => {
  it("returns zero offset when unset", () => {
    const offset = runtimeRenderOffsetCm(createDefaultRobotRuntimeState());
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.z).toBe(0);
  });

  it("converts default render offset meters to centimeters", () => {
    const state: RobotRuntimeState = {
      ...createDefaultRobotRuntimeState(),
      defaultRenderOffsetM: [1, 2, 3],
    };
    const offset = runtimeRenderOffsetCm(state);
    expect(offset.x).toBe(100);
    expect(offset.y).toBe(200);
    expect(offset.z).toBe(300);
  });
});

describe("robotBodyHeightM", () => {
  it("prefers body bounds height", () => {
    const state: RobotRuntimeState = {
      ...createDefaultRobotRuntimeState(),
      bodyBoundsM: [0.7, 0.5, 0.42],
      baseHeightM: 0.3,
    };
    expect(robotBodyHeightM(state)).toBe(0.42);
  });

  it("falls back to base height then default", () => {
    expect(
      robotBodyHeightM({
        ...createDefaultRobotRuntimeState(),
        baseHeightM: 0.3,
      }),
    ).toBe(0.3);
    expect(robotBodyHeightM(createDefaultRobotRuntimeState())).toBe(0.55);
  });
});

describe("lidarVerticalBandCm", () => {
  it("computes floor clearance and max height above body", () => {
    const band = lidarVerticalBandCm({
      ...createDefaultRobotRuntimeState(),
      bodyBoundsM: [0.7, 0.5, 0.4],
    });
    expect(band.minAboveFloorCm).toBe(0.5);
    expect(band.maxAboveFloorCm).toBeCloseTo(140, 5);
  });
});

describe("robotFloorWorldYCm", () => {
  it("uses negotiated base height when available", () => {
    const y = robotFloorWorldYCm(100, {
      ...createDefaultRobotRuntimeState(),
      negotiated: true,
      baseHeightM: 0.3,
    });
    expect(y).toBe(70);
  });

  it("uses default body height when not negotiated", () => {
    const y = robotFloorWorldYCm(100, createDefaultRobotRuntimeState());
    expect(y).toBeCloseTo(45, 5);
  });
});

describe("capability helpers", () => {
  it("reports availability and reasons", () => {
    const state = projectRuntimeStateFromHello(sampleHello());
    expect(isCapabilityAvailable(state, "lidar")).toBe(true);
    expect(isCapabilityAvailable(state, "nav")).toBe(false);
    expect(capabilityUnavailableReason(state, "nav")).toBe("sim only");
    expect(capabilityUnavailableReason(state, "lidar")).toBeNull();
  });

  it("defaults missing capabilities to available", () => {
    const state = createDefaultRobotRuntimeState();
    expect(isCapabilityAvailable(state, "unknown_cap")).toBe(true);
    expect(capabilityUnavailableReason(state, "unknown_cap")).toBeNull();
  });
});
