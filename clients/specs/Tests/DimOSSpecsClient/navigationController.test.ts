import { describe, expect, it } from "vitest";
import {
  FOLLOW_FLOOR_POSITION_EPSILON_CM,
  shouldSyncFollowFloorPose,
} from "../../Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement";
import {
  GOAL_FORCE_NOOP_DISTANCE_CM,
  GOAL_SEND_INTERVAL_S,
  shouldBeginFailedFlash,
  shouldSendStreamGoal,
} from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavigationController";

describe("shouldBeginFailedFlash", () => {
  const failed = { state: "resolved" as const, outcome: "failed" as const };
  const following = { state: "following_path" as const, outcome: null };

  it("fires on the rising edge of resolved failed while a live goal exists", () => {
    expect(shouldBeginFailedFlash(following, failed, true)).toBe(true);
    expect(shouldBeginFailedFlash(null, failed, true)).toBe(true);
  });

  it("does not re-arm while still resolved failed, or without a live goal", () => {
    expect(shouldBeginFailedFlash(failed, failed, true)).toBe(false);
    expect(shouldBeginFailedFlash(following, failed, false)).toBe(false);
    expect(shouldBeginFailedFlash(following, following, true)).toBe(false);
  });
});

describe("shouldSyncFollowFloorPose", () => {
  const identity = quat.quatIdentity();

  it("skips updates inside the position and rotation epsilon", () => {
    expect(
      shouldSyncFollowFloorPose(
        { position: new vec3(0, 0, 0), rotation: identity },
        { position: new vec3(FOLLOW_FLOOR_POSITION_EPSILON_CM, 0, 0), rotation: identity },
      ),
    ).toBe(false);
    expect(
      shouldSyncFollowFloorPose(
        { position: new vec3(0, 0, 0), rotation: identity },
        { position: new vec3(FOLLOW_FLOOR_POSITION_EPSILON_CM + 0.01, 0, 0), rotation: identity },
      ),
    ).toBe(true);
  });
});

describe("shouldSendStreamGoal", () => {
  it("throttles by interval and distance, and no-ops tiny force moves", () => {
    const position = new vec3(0, 0, 0);
    const lastSent = { position: new vec3(0, 0, 0) };
    expect(shouldSendStreamGoal(10, 10, position, lastSent, false)).toBe(false);
    expect(
      shouldSendStreamGoal(10 + GOAL_SEND_INTERVAL_S + 0.1, 10, new vec3(30, 0, 0), lastSent, false),
    ).toBe(true);
    expect(
      shouldSendStreamGoal(
        10 + GOAL_SEND_INTERVAL_S,
        10,
        new vec3(GOAL_FORCE_NOOP_DISTANCE_CM - 1, 0, 0),
        lastSent,
        true,
      ),
    ).toBe(false);
  });
});
