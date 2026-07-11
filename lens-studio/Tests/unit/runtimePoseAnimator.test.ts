import { describe, it, expect } from "vitest";
import { RuntimePoseAnimator } from "../../Assets/Scripts/App/Robot/RuntimePoseAnimator";

function makeTarget(overrides: {
  position?: vec3;
  rotation?: quat;
  velocityCmPerS?: vec3;
  yawRateRadPerS?: number;
  speedMps?: number | null;
  poseTs?: number;
  receiveMonoS?: number;
} = {}) {
  return {
    position: overrides.position ?? new vec3(0, 0, 0),
    rotation: overrides.rotation ?? quat.quatIdentity(),
    velocityCmPerS: overrides.velocityCmPerS ?? new vec3(0, 0, 0),
    yawRateRadPerS: overrides.yawRateRadPerS ?? 0,
    speedMps: overrides.speedMps ?? null,
    poseTs: overrides.poseTs ?? 100,
    receiveMonoS: overrides.receiveMonoS ?? 10,
  };
}

describe("RuntimePoseAnimator.computeUnifiedTarget", () => {
  it("returns odom exactly during the fresh-sample window", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.2);
    animator.setTarget(
      makeTarget({
        position: new vec3(10, 0, 5),
        velocityCmPerS: new vec3(25, 0, 0),
        speedMps: 0.25,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const unified = animator.computeUnifiedTarget(10.02);
    expect(unified).not.toBeNull();
    expect(unified!.position.x).toBeCloseTo(10, 5);
    expect(unified!.position.y).toBeCloseTo(0, 5);
    expect(unified!.position.z).toBeCloseTo(5, 5);
  });

  it("blends toward prediction as sample age grows while moving", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.3);
    animator.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(30, 0, 0),
        speedMps: 0.3,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const unified = animator.computeUnifiedTarget(10.2);
    expect(unified).not.toBeNull();
    expect(unified!.position.x).toBeGreaterThan(0);
    expect(unified!.position.x).toBeLessThan(9);
  });

  it("skips prediction when speed_mps is below the stopped threshold", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.4);
    animator.setTarget(
      makeTarget({
        position: new vec3(7, 0, 3),
        velocityCmPerS: new vec3(30, 0, 0),
        speedMps: 0.01,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const unified = animator.computeUnifiedTarget(10.2);
    expect(unified).not.toBeNull();
    expect(unified!.position.x).toBeCloseTo(7, 5);
    expect(unified!.position.z).toBeCloseTo(3, 5);
  });

  it("reverts unified target to odom when a late stop sample arrives", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.25);

    animator.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(50, 0, 0),
        speedMps: 0.5,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      true,
    );

    const overshot = animator.computeUnifiedTarget(10.2);
    expect(overshot).not.toBeNull();
    expect(overshot!.position.x).toBeGreaterThan(0);

    animator.setRobotClockNowProvider(() => 101);
    animator.setTarget(
      makeTarget({
        position: new vec3(12, 0, 0),
        velocityCmPerS: new vec3(0, 0, 0),
        speedMps: 0,
        poseTs: 101,
        receiveMonoS: 10.3,
      }),
      false,
    );

    const reverted = animator.computeUnifiedTarget(10.3);
    expect(reverted).not.toBeNull();
    expect(reverted!.position.x).toBeCloseTo(12, 5);
    expect(reverted!.position.y).toBeCloseTo(0, 5);
    expect(reverted!.position.z).toBeCloseTo(0, 5);
  });

  it("skips prediction when clock sync is not ready", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => null);
    animator.setTarget(
      makeTarget({
        position: new vec3(4, 0, 2),
        velocityCmPerS: new vec3(40, 0, 0),
        speedMps: 0.4,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const unified = animator.computeUnifiedTarget(10.2);
    expect(unified).not.toBeNull();
    expect(unified!.position.x).toBeCloseTo(4, 5);
    expect(unified!.position.z).toBeCloseTo(2, 5);
  });

  it("biases XZ prediction higher at greater speed", () => {
    const slow = new RuntimePoseAnimator();
    slow.setRobotClockNowProvider(() => 100.2);
    slow.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(30, 0, 0),
        speedMps: 0.1,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const fast = new RuntimePoseAnimator();
    fast.setRobotClockNowProvider(() => 100.2);
    fast.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(30, 0, 0),
        speedMps: 0.3,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const slowUnified = slow.computeUnifiedTarget(10.2)!;
    const fastUnified = fast.computeUnifiedTarget(10.2)!;
    expect(fastUnified.position.x).toBeGreaterThan(slowUnified.position.x);
  });

  it("keeps Y closer to odom than XZ when vertical velocity is present", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.2);
    animator.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(30, 20, 0),
        speedMps: 0.3,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const unified = animator.computeUnifiedTarget(10.2)!;
    const predictX = 30 * 0.2;
    const predictY = 20 * 0.2 * RuntimePoseAnimator.POSITION_Y_BLEND_FACTOR;
    const xBlendFraction = unified.position.x / predictX;
    const yBlendFraction = unified.position.y / predictY;
    expect(yBlendFraction).toBeLessThan(xBlendFraction);
  });

  it("scales prediction down when path goal is within decel lookahead", () => {
    const uncapped = new RuntimePoseAnimator();
    uncapped.setRobotClockNowProvider(() => 100.2);
    uncapped.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(50, 0, 0),
        speedMps: 0.5,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const capped = new RuntimePoseAnimator();
    capped.setRobotClockNowProvider(() => 100.2);
    capped.setPathGoal(new vec3(30, 0, 0));
    capped.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(50, 0, 0),
        speedMps: 0.5,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const uncappedUnified = uncapped.computeUnifiedTarget(10.2)!;
    const cappedUnified = capped.computeUnifiedTarget(10.2)!;
    expect(cappedUnified.position.x).toBeGreaterThan(0);
    expect(cappedUnified.position.x).toBeLessThan(uncappedUnified.position.x);
  });

  it("suppresses prediction when path goal is within stop remaining distance", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.2);
    animator.setPathGoal(new vec3(5, 0, 0));
    animator.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(50, 0, 0),
        speedMps: 0.5,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const unified = animator.computeUnifiedTarget(10.2)!;
    expect(unified.position.x).toBeCloseTo(0, 5);
    expect(unified.position.z).toBeCloseTo(0, 5);
  });

  it("matches uncapped prediction when path goal is beyond decel lookahead", () => {
    const uncapped = new RuntimePoseAnimator();
    uncapped.setRobotClockNowProvider(() => 100.2);
    uncapped.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(50, 0, 0),
        speedMps: 0.5,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const farGoal = new RuntimePoseAnimator();
    farGoal.setRobotClockNowProvider(() => 100.2);
    farGoal.setPathGoal(new vec3(200, 0, 0));
    farGoal.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        velocityCmPerS: new vec3(50, 0, 0),
        speedMps: 0.5,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const uncappedUnified = uncapped.computeUnifiedTarget(10.2)!;
    const farGoalUnified = farGoal.computeUnifiedTarget(10.2)!;
    expect(farGoalUnified.position.x).toBeCloseTo(uncappedUnified.position.x, 5);
    expect(farGoalUnified.position.z).toBeCloseTo(uncappedUnified.position.z, 5);
  });

  it("applies half the rotation prediction weight of XZ position", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.2);
    const odomRot = quat.quatIdentity();
    animator.setTarget(
      makeTarget({
        position: new vec3(0, 0, 0),
        rotation: odomRot,
        velocityCmPerS: new vec3(30, 0, 0),
        yawRateRadPerS: Math.PI,
        speedMps: 0.3,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const unified = animator.computeUnifiedTarget(10.2)!;
    const ageS = 0.2;
    const halfYaw = (Math.PI * ageS) * 0.5;
    const yawQuat = new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
    const fullPredictRot = odomRot.multiply(yawQuat);

    const rotDelta = quat.angleBetween(odomRot, unified.rotation);
    const fullRotDelta = quat.angleBetween(odomRot, fullPredictRot);
    const xDelta = unified.position.x;
    const predictX = 30 * ageS;

    const rotBlendFraction = rotDelta / fullRotDelta;
    const posBlendFraction = xDelta / predictX;
    expect(rotBlendFraction).toBeLessThan(posBlendFraction);
    expect(rotBlendFraction / posBlendFraction).toBeCloseTo(
      RuntimePoseAnimator.ROTATION_PREDICTION_FACTOR,
      2,
    );
  });
});

describe("RuntimePoseAnimator.tick", () => {
  it("smooths display toward unified target at constant rate", () => {
    const animator = new RuntimePoseAnimator();
    animator.setRobotClockNowProvider(() => 100.2);
    animator.setTarget(
      makeTarget({
        position: new vec3(10, 0, 0),
        speedMps: 0,
        poseTs: 100,
        receiveMonoS: 10,
      }),
      false,
    );

    const tickResult = animator.tick(
      { position: new vec3(0, 0, 0), rotation: quat.quatIdentity() },
      0.016,
      10.1,
    );
    expect(tickResult).not.toBeNull();
    expect(tickResult!.position.x).toBeGreaterThan(0);
    expect(tickResult!.position.x).toBeLessThan(10);
  });
});
