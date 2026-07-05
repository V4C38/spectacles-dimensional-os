import { describe, it, expect, beforeEach } from "vitest";
import {
  buildGetStatus,
  buildSetLidarMode,
  buildRegistrationCommand,
  buildRegistrationPose,
  buildPing,
  buildCameraInfo,
  buildNavigateGoal,
  buildPreviewGoal,
  buildNavGoal,
  buildCancelNavGoal,
  buildEmergencyStop,
  buildJoystickCommand,
  DEFAULT_LIDAR_OBSTACLE_SETTINGS,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";
import { setMockTime } from "../setup/lens-globals";
import { vec3, quat } from "../shims/lens-runtime";

describe("outbound protocol builders", () => {
  beforeEach(() => {
    setMockTime(1000);
  });

  it("buildGetStatus", () => {
    const msg = JSON.parse(buildGetStatus("go2"));
    expect(msg.type).toBe("get_status");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
  });

  it("buildSetLidarMode full omits obstacle distances", () => {
    const msg = JSON.parse(buildSetLidarMode("go2", "full"));
    expect(msg.type).toBe("set_lidar_mode");
    expect(msg.robot_id).toBe("go2");
    expect(msg.mode).toBe("full");
    expect(msg.ts).toBe(1000);
    expect(msg).not.toHaveProperty("obstacle_min_distance_m");
  });

  it("buildSetLidarMode obstacles includes distance fields", () => {
    const msg = JSON.parse(buildSetLidarMode("go2", "obstacles"));
    expect(msg.mode).toBe("obstacles");
    expect(msg.obstacle_min_distance_m).toBe(
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.minDistanceM,
    );
    expect(msg.obstacle_opaque_distance_m).toBe(
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.opaqueDistanceM,
    );
    expect(msg.obstacle_max_distance_m).toBe(
      DEFAULT_LIDAR_OBSTACLE_SETTINGS.maxDistanceM,
    );
  });

  it("buildRegistrationCommand start with mode", () => {
    const msg = JSON.parse(
      buildRegistrationCommand("go2", "start", "april_tag"),
    );
    expect(msg.type).toBe("registration_command");
    expect(msg.robot_id).toBe("go2");
    expect(msg.command).toBe("start");
    expect(msg.mode).toBe("april_tag");
    expect(msg.ts).toBe(1000);
  });

  it("buildRegistrationCommand stop and commit", () => {
    expect(JSON.parse(buildRegistrationCommand("go2", "stop")).command).toBe(
      "stop",
    );
    expect(JSON.parse(buildRegistrationCommand("go2", "commit")).command).toBe(
      "commit",
    );
  });

  it("buildRegistrationPose", () => {
    const msg = JSON.parse(
      buildRegistrationPose(new vec3(100, 0, 200), new quat(1, 0, 0, 0), "go2"),
    );
    expect(msg.type).toBe("registration_pose");
    expect(msg.robot_id).toBe("go2");
    expect(msg.position).toEqual([1, 0, 2]);
    expect(msg.orientation).toEqual([0, 0, 0, 1]);
    expect(msg.ts).toBe(1000);
  });

  it("buildPing", () => {
    const msg = JSON.parse(buildPing(42.5, "go2"));
    expect(msg.type).toBe("ping");
    expect(msg.robot_id).toBe("go2");
    expect(msg.client_ts).toBe(42.5);
    expect(msg.ts).toBe(1000);
  });

  it("buildCameraInfo", () => {
    const msg = JSON.parse(
      buildCameraInfo({
        robotId: "go2",
        width: 640,
        height: 480,
        fx: 500,
        fy: 500,
        cx: 320,
        cy: 240,
      }),
    );
    expect(msg.type).toBe("camera_info");
    expect(msg.robot_id).toBe("go2");
    expect(msg.fx).toBe(500);
    expect(msg.distortion).toEqual([]);
    expect(msg.ts).toBe(1000);
  });

  it("buildNavigateGoal", () => {
    const msg = JSON.parse(
      buildNavigateGoal(
        "go2",
        new vec3(100, 0, 200),
        new quat(1, 0, 0, 0),
      ),
    );
    expect(msg.type).toBe("nav_goal");
    expect(msg.robot_id).toBe("go2");
    expect(msg.intent).toBe("navigate");
    expect(msg.position).toEqual([1, 0, 2]);
    expect(msg.ts).toBe(1000);
  });

  it("buildPreviewGoal without rotation", () => {
    const msg = JSON.parse(
      buildPreviewGoal("go2", new vec3(50, 0, 0)),
    );
    expect(msg.intent).toBe("preview");
    expect(msg.position).toEqual([0.5, 0, 0]);
    expect(msg.orientation).toBeUndefined();
  });

  it("buildPreviewGoal with rotation", () => {
    const msg = JSON.parse(
      buildPreviewGoal(
        "go2",
        new vec3(50, 0, 0),
        new quat(1, 0, 0, 0),
      ),
    );
    expect(msg.intent).toBe("preview");
    expect(msg.orientation).toEqual([0, 0, 0, 1]);
  });

  it("buildNavGoal accepts explicit intent", () => {
    const msg = JSON.parse(
      buildNavGoal("go2", "navigate", new vec3(100, 0, 200), new quat(1, 0, 0, 0)),
    );
    expect(msg.intent).toBe("navigate");
  });

  it("buildNavGoal preview without rotation", () => {
    const msg = JSON.parse(
      buildNavGoal("go2", "preview", new vec3(50, 0, 0)),
    );
    expect(msg.intent).toBe("preview");
    expect(msg.position).toEqual([0.5, 0, 0]);
    expect(msg).not.toHaveProperty("orientation");
  });

  it("buildCancelNavGoal", () => {
    const msg = JSON.parse(buildCancelNavGoal("go2"));
    expect(msg.type).toBe("cancel_nav_goal");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
  });

  it("buildEmergencyStop", () => {
    const msg = JSON.parse(buildEmergencyStop("go2"));
    expect(msg.type).toBe("emergency_stop");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
  });

  it("buildJoystickCommand", () => {
    const msg = JSON.parse(buildJoystickCommand("go2", 0.1, 0.2, -0.3));
    expect(msg.type).toBe("joystick_command");
    expect(msg.robot_id).toBe("go2");
    expect(msg.vx).toBe(0.1);
    expect(msg.vy).toBe(0.2);
    expect(msg.wz).toBe(-0.3);
    expect(msg.ts).toBe(1000);
  });
});
