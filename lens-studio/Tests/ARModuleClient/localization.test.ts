import { describe, expect, it } from "vitest";
import { Alignment } from "../../Assets/Scripts/ARModuleClient/localization/alignment";
import {
  odomPointToTracking,
  odomPoseToTracking,
  odomYawPoseToTracking,
  trackingPointToOdom,
  trackingPoseToOdom,
  trackingYawPoseToOdom,
} from "../../Assets/Scripts/ARModuleClient/localization/compose";
import { SPECTACLES_BASIS, type CoordinateBasis } from "../../Assets/Scripts/ARModuleClient/coordinates/coordinates";
import type { Quat, Vec3, YawPose } from "../../Assets/Scripts/ARModuleClient/websocket/types";

const IDENTITY_BASIS: CoordinateBasis = {
  name: "identity",
  odomToClient: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

const IDENTITY_Q: Quat = [0, 0, 0, 1];

function T(
  position: Vec3,
  orientation: Quat = IDENTITY_Q,
): ReturnType<Alignment["apply"]> {
  return new Alignment().apply({
    type: "localization_result",
    position,
    orientation,
    confidence: 1,
    ts: 0,
  });
}

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
}

function expectQuat(actual: Quat, expected: Quat): void {
  const sign = actual[3] * expected[3] < 0 ? -1 : 1;
  expect(actual[0]).toBeCloseTo(expected[0] * sign, 6);
  expect(actual[1]).toBeCloseTo(expected[1] * sign, 6);
  expect(actual[2]).toBeCloseTo(expected[2] * sign, 6);
  expect(actual[3]).toBeCloseTo(expected[3] * sign, 6);
}

describe("alignment", () => {
  it("stores the newest localization_result as T_odom_client and clears it", () => {
    const alignment = new Alignment();
    expect(alignment.aligned).toBe(false);
    alignment.apply({
      type: "localization_result",
      position: [1, 2, 3],
      orientation: IDENTITY_Q,
      confidence: 0.5,
      ts: 9,
    });
    expect(alignment.T_odom_client).toEqual({
      position: [1, 2, 3],
      orientation: IDENTITY_Q,
      confidence: 0.5,
      ts: 9,
    });
    alignment.clear();
    expect(alignment.aligned).toBe(false);
    expect(alignment.T_odom_client).toBeNull();
  });

  it("rejects a non-finite T_odom_client", () => {
    const alignment = new Alignment();
    expect(() =>
      alignment.apply({
        type: "localization_result",
        position: [1, Number.NaN, 0],
        orientation: IDENTITY_Q,
        confidence: 0.5,
        ts: 1,
      }),
    ).toThrow(/finite/);
    expect(() =>
      alignment.apply({
        type: "localization_result",
        position: [0, 0, 0],
        orientation: [0, 0, 0, 0],
        confidence: 0.5,
        ts: 1,
      }),
    ).toThrow(/non-zero/);
  });
});

describe("compose", () => {
  it("is a no-op in odom when T_odom_client is the identity, then applies the basis", () => {
    const origin = T([0, 0, 0]);
    expectVec3(odomPointToTracking([1, 2, 3], origin, IDENTITY_BASIS), [1, 2, 3]);
    expectVec3(odomPointToTracking([1, 2, 3], origin, SPECTACLES_BASIS), [-2, 3, 1]);
  });

  it("subtracts T_odom_client before converting axes", () => {
    const origin = T([1, 0, 0]);
    expectVec3(odomPointToTracking([2, 0, 0], origin, IDENTITY_BASIS), [1, 0, 0]);
    expectVec3(odomPointToTracking([2, 0, 0], origin, SPECTACLES_BASIS), [0, 0, 1]);
  });

  it("round-trips pose, point, and yaw pose through SPECTACLES_BASIS", () => {
    const half = Math.PI / 4;
    const yawAboutZ: Quat = [0, 0, Math.sin(half), Math.cos(half)];
    const origin = T([1, 2, 0], yawAboutZ);
    const pose = { position: [3, 4, 5] as Vec3, orientation: yawAboutZ };
    const tracking = odomPoseToTracking(pose, origin, SPECTACLES_BASIS);
    const back = trackingPoseToOdom(tracking, origin, SPECTACLES_BASIS);
    expectVec3(back.position, pose.position);
    expectQuat(back.orientation, pose.orientation);

    expectVec3(
      trackingPointToOdom(odomPointToTracking([3, 4, 5], origin, SPECTACLES_BASIS), origin, SPECTACLES_BASIS),
      [3, 4, 5],
    );

    const yawPose: YawPose = [3, 4, 0, Math.PI / 2];
    const trackedYaw = odomYawPoseToTracking(yawPose, origin, SPECTACLES_BASIS);
    const yawBack = trackingYawPoseToOdom(trackedYaw, origin, SPECTACLES_BASIS);
    expectVec3([yawBack[0], yawBack[1], yawBack[2]], [3, 4, 0]);
    expect(yawBack[3]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("does not let callers invent a second composition: identity-basis yaw is T inverse then yaw", () => {
    const origin = T([0, 0, 0], [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)]);
    const tracked = odomYawPoseToTracking([1, 0, 0, Math.PI / 2], origin, IDENTITY_BASIS);
    expectVec3([tracked[0], tracked[1], tracked[2]], [0, -1, 0]);
    expect(tracked[3]).toBeCloseTo(0, 6);
  });

  it("rejects non-finite compose inputs", () => {
    const origin = T([0, 0, 0]);
    expect(() => odomPointToTracking([1, Number.NaN, 0], origin, IDENTITY_BASIS)).toThrow(/finite/);
    expect(() =>
      odomPoseToTracking({ position: [1, 0, 0], orientation: [0, 0, 0, 0] }, origin, IDENTITY_BASIS),
    ).toThrow(/non-zero/);
  });

  it("rejects yaw poses whose transformed forward direction is vertical", () => {
    const halfPitch = Math.PI / 4;
    const origin = T([0, 0, 0], [0, Math.sin(halfPitch), 0, Math.cos(halfPitch)]);
    expect(() => odomYawPoseToTracking([0, 0, 0, 0], origin, IDENTITY_BASIS)).toThrow(
      /degenerate yaw geometry/,
    );
  });
});
