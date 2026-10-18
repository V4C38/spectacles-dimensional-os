import { describe, expect, it } from "vitest";
import { rotateVecByQuat, odomToClientTrackingYawPose } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingTransforms";
import { clientTrackingToSpecsYawPose } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import {
  FOLLOW_FLOOR_POSITION_EPSILON_CM,
  shouldSyncFollowFloorPose,
} from "../../Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement";
import {
  GOAL_FORCE_NOOP_DISTANCE_CM,
  GOAL_SEND_INTERVAL_S,
  shouldBeginFailedFlash,
  shouldSendStreamGoal,
  specsNavigationGoalInOdom,
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


describe("navigation marker terminal heading", () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    "sends the displayed arrow direction at marker yaw %s, with a rotated localization origin",
    (yaw) => {
      const origin = {
        position: [2, -1, 0.2] as [number, number, number],
        orientation: [0, 0, Math.sin(0.37 / 2), Math.cos(0.37 / 2)] as [number, number, number, number],
        confidence: 1, ts: 1,
      };
      const rotation = new quat(Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0);
      const goal = specsNavigationGoalInOdom(new vec3(25, 10, -100), rotation, origin);
      // Lens arrow (cos(yaw), 0, -sin(yaw)) maps to tracking
      // (sin(yaw), -cos(yaw), 0), then rotates by the odom origin.
      const actual = rotateVecByQuat(goal.orientation, [1, 0, 0]);
      const expected = rotateVecByQuat(origin.orientation, [Math.sin(yaw), -Math.cos(yaw), 0]);
      actual.forEach((n, i) => expect(n).toBeCloseTo(expected[i], 6));
      const echoed = clientTrackingToSpecsYawPose(odomToClientTrackingYawPose([
        goal.position[0], goal.position[1], goal.position[2],
        Math.atan2(actual[1], actual[0]),
      ], origin));
      expect(Math.cos(echoed[3])).toBeCloseTo(Math.cos(yaw), 6);
      expect(Math.sin(echoed[3])).toBeCloseTo(Math.sin(yaw), 6);
      expect(echoed.slice(0, 3)).toEqual(expect.arrayContaining([
        expect.closeTo(25, 6), expect.closeTo(10, 6), expect.closeTo(-100, 6),
      ]));
    },
  );
});
