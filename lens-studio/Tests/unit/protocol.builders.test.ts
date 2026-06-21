import { describe, it, expect, beforeEach } from "vitest";
import {
  buildGetStatus,
  buildSetLidarMode,
  buildRegistrationStart,
  buildRegistrationAction,
  buildRegistrationStop,
  buildRegistrationCommit,
  buildRegistrationPose,
  buildPing,
  buildCameraInfo,
  buildNavGoal,
  buildPlanPath,
  buildCancelGoal,
  buildEmergencyStop,
  DEFAULT_LIDAR_OBSTACLE_SETTINGS,
} from "../../Assets/Scripts/Bridge/Protocol";
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

  it("buildSetLidarMode", () => {
    const msg = JSON.parse(buildSetLidarMode("go2", "full"));
    expect(msg.type).toBe("set_lidar_mode");
    expect(msg.robot_id).toBe("go2");
    expect(msg.mode).toBe("full");
    expect(msg.ts).toBe(1000);
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

  it("buildRegistrationStart", () => {
    const msg = JSON.parse(buildRegistrationStart("go2", "april_odom_baseline"));
    expect(msg.type).toBe("registration_start");
    expect(msg.robot_id).toBe("go2");
    expect(msg.mode).toBe("april_odom_baseline");
    expect(msg.ts).toBe(1000);
  });

  it("buildRegistrationAction", () => {
    const msg = JSON.parse(buildRegistrationAction("go2"));
    expect(msg.type).toBe("registration_action");
    expect(msg.action).toBe("authorize_motion");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
  });

  it("buildRegistrationStop", () => {
    const msg = JSON.parse(buildRegistrationStop("go2"));
    expect(msg.type).toBe("registration_stop");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
  });

  it("buildRegistrationCommit", () => {
    const msg = JSON.parse(buildRegistrationCommit("go2"));
    expect(msg.type).toBe("registration_commit");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
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

  it("buildNavGoal", () => {
    const msg = JSON.parse(
      buildNavGoal(new vec3(100, 0, 200), new quat(1, 0, 0, 0), "go2"),
    );
    expect(msg.type).toBe("nav_goal");
    expect(msg.robot_id).toBe("go2");
    expect(msg.position).toEqual([1, 0, 2]);
    expect(msg.ts).toBe(1000);
  });

  it("buildPlanPath without rotation", () => {
    const msg = JSON.parse(buildPlanPath(new vec3(50, 0, 0), "go2"));
    expect(msg.type).toBe("plan_path");
    expect(msg.robot_id).toBe("go2");
    expect(msg.position).toEqual([0.5, 0, 0]);
    expect(msg).not.toHaveProperty("orientation");
    expect(msg.ts).toBe(1000);
  });

  it("buildPlanPath with rotation", () => {
    const msg = JSON.parse(
      buildPlanPath(new vec3(50, 0, 0), "go2", new quat(1, 0, 0, 0)),
    );
    expect(msg.orientation).toEqual([0, 0, 0, 1]);
  });

  it("buildCancelGoal", () => {
    const msg = JSON.parse(buildCancelGoal("go2"));
    expect(msg.type).toBe("cancel_goal");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
  });

  it("buildEmergencyStop", () => {
    const msg = JSON.parse(buildEmergencyStop("go2"));
    expect(msg.type).toBe("emergency_stop");
    expect(msg.robot_id).toBe("go2");
    expect(msg.ts).toBe(1000);
  });
});
