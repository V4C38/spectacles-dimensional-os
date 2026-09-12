import { describe, expect, it } from "vitest";
import {
  FOLLOW_FLOOR_POSITION_EPSILON_CM,
  shouldSyncFollowFloorPose,
} from "../../Assets/Scripts/DimosARClient/navigation/GroundPlacement";
import {
  GOAL_FORCE_NOOP_DISTANCE_CM,
  GOAL_SEND_INTERVAL_S,
  isLiveNavGoal,
  isNavGoalCancelVisible,
  shouldBeginFailedFlash,
  shouldSendStreamGoal,
} from "../../Assets/Scripts/DimosARClient/navigation/NavigationController";

const live = {
  activated: false,
  hasSentGoal: false,
  hasReceivedPose: false,
  followingPath: false,
};

describe("isLiveNavGoal", () => {
  it("is true for an activated, sent, received, or following goal", () => {
    expect(isLiveNavGoal(live)).toBe(false);
    expect(isLiveNavGoal({ ...live, activated: true })).toBe(true);
    expect(isLiveNavGoal({ ...live, hasSentGoal: true })).toBe(true);
    expect(isLiveNavGoal({ ...live, hasReceivedPose: true })).toBe(true);
    expect(isLiveNavGoal({ ...live, followingPath: true })).toBe(true);
  });
});

describe("isNavGoalCancelVisible", () => {
  it("shows only for a live goal that is not being dragged or flashing", () => {
    expect(isNavGoalCancelVisible({ ...live, flashing: false, dragging: false })).toBe(false);
    expect(isNavGoalCancelVisible({ ...live, flashing: false, dragging: false, hasSentGoal: true })).toBe(
      true,
    );
    expect(isNavGoalCancelVisible({ ...live, flashing: false, dragging: false, hasReceivedPose: true })).toBe(
      true,
    );
    expect(isNavGoalCancelVisible({ ...live, flashing: false, dragging: false, followingPath: true })).toBe(
      true,
    );
    expect(isNavGoalCancelVisible({ ...live, flashing: false, dragging: false, activated: true })).toBe(true);
    expect(
      isNavGoalCancelVisible({ ...live, flashing: false, dragging: true, hasSentGoal: true }),
    ).toBe(false);
    expect(
      isNavGoalCancelVisible({ ...live, flashing: true, dragging: false, hasSentGoal: true }),
    ).toBe(false);
  });
});

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
