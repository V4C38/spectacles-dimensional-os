import { describe, expect, it } from "vitest";
import {
  clientTrackingToSpecsPoint,
  clientTrackingToSpecsPose,
  clientTrackingToSpecsQuat,
  clientTrackingToSpecsYawPose,
  specsToClientTrackingPoint,
  specsToClientTrackingPose,
  specsToClientTrackingQuat,
  specsToClientTrackingYawPose,
} from "../../Assets/Scripts/DimosARClient/SpecsCoordinates";
import {
  normalizeQuat,
  rotateVecByQuat,
} from "../../Assets/Scripts/DimosARClient/core/localization/clientTrackingTransforms";
import type { Quat, Vec3, YawPose } from "../../Assets/Scripts/DimosARClient/core/websocket/protocolTypes";

const IDENTITY_Q: Quat = [0, 0, 0, 1];

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

function yawAboutZ(radians: number): Quat {
  const half = radians * 0.5;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

describe("SpecsCoordinates points", () => {
  it("maps PROTOCOL.md unit vectors with scale in both directions", () => {
    expectVec3(clientTrackingToSpecsPoint([1, 0, 0]), [0, 0, 100]);
    expectVec3(clientTrackingToSpecsPoint([0, 1, 0]), [-100, 0, 0]);
    expectVec3(clientTrackingToSpecsPoint([0, 0, 1]), [0, 100, 0]);
    expectVec3(specsToClientTrackingPoint([0, 0, 100]), [1, 0, 0]);
    expectVec3(specsToClientTrackingPoint([-100, 0, 0]), [0, 1, 0]);
    expectVec3(specsToClientTrackingPoint([0, 100, 0]), [0, 0, 1]);
  });

  it("round-trips a nontrivial offset", () => {
    const point: Vec3 = [1.25, -0.5, 2];
    expectVec3(specsToClientTrackingPoint(clientTrackingToSpecsPoint(point)), point);
    const specs: Vec3 = [40, -80, 10];
    expectVec3(clientTrackingToSpecsPoint(specsToClientTrackingPoint(specs)), specs);
  });
});

describe("SpecsCoordinates quaternions", () => {
  it("round-trips identity", () => {
    expectQuat(clientTrackingToSpecsQuat(IDENTITY_Q), IDENTITY_Q);
    expectQuat(specsToClientTrackingQuat(IDENTITY_Q), IDENTITY_Q);
  });

  it("round-trips a nontrivial rotation in both directions", () => {
    const yaw90 = yawAboutZ(Math.PI / 2);
    expectQuat(specsToClientTrackingQuat(clientTrackingToSpecsQuat(yaw90)), yaw90);
    const specsYaw90: Quat = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
    expectQuat(clientTrackingToSpecsQuat(specsToClientTrackingQuat(specsYaw90)), specsYaw90);
  });

  it("conjugates rotation: rotate then convert equals convert then rotate", () => {
    const orientation = yawAboutZ(Math.PI / 2);
    const point: Vec3 = [1, 2, 3];
    expectVec3(
      clientTrackingToSpecsPoint(rotateVecByQuat(orientation, point)),
      rotateVecByQuat(clientTrackingToSpecsQuat(orientation), clientTrackingToSpecsPoint(point)),
    );
  });
});

describe("SpecsCoordinates poses", () => {
  it("converts both directions and round-trips translation plus rotation", () => {
    const pose = { position: [1, 2, 3] as Vec3, orientation: yawAboutZ(Math.PI / 2) };
    const specs = clientTrackingToSpecsPose(pose);
    expectVec3(specs.position, [-200, 300, 100]);
    const back = specsToClientTrackingPose(specs);
    expectVec3(back.position, pose.position);
    expectQuat(back.orientation, pose.orientation);
    expectQuat(clientTrackingToSpecsPose(specsToClientTrackingPose(specs)).orientation, specs.orientation);
  });
});

describe("SpecsCoordinates yaw poses", () => {
  it("maps identity heading and +π/2 through the table", () => {
    const identity = clientTrackingToSpecsYawPose([1, 0, 0, 0]);
    expectVec3([identity[0], identity[1], identity[2]], [0, 0, 100]);
    expect(identity[3]).toBeCloseTo(0, 6);

    const turned = clientTrackingToSpecsYawPose([1, 0, 0, Math.PI / 2]);
    expectVec3([turned[0], turned[1], turned[2]], [0, 0, 100]);
    expect(turned[3]).toBeCloseTo(-Math.PI / 2, 6);
    const forward = rotateVecByQuat(normalizeQuat(clientTrackingToSpecsQuat(yawAboutZ(Math.PI / 2))), [
      0, 0, 1,
    ]);
    expectVec3(forward, [-1, 0, 0]);
  });

  it("round-trips yaw poses in both directions", () => {
    const tracking: YawPose = [1.5, -0.25, 0.1, Math.PI / 3];
    const specs = clientTrackingToSpecsYawPose(tracking);
    const back = specsToClientTrackingYawPose(specs);
    expectVec3([back[0], back[1], back[2]], [tracking[0], tracking[1], tracking[2]]);
    expect(back[3]).toBeCloseTo(tracking[3], 6);

    const specsYaw: YawPose = [20, 5, 80, -Math.PI / 6];
    const trackingBack = specsToClientTrackingYawPose(specsYaw);
    const specsBack = clientTrackingToSpecsYawPose(trackingBack);
    expectVec3([specsBack[0], specsBack[1], specsBack[2]], [specsYaw[0], specsYaw[1], specsYaw[2]]);
    expect(specsBack[3]).toBeCloseTo(specsYaw[3], 6);
  });

  it("treats tracking ±π/2 pitch about +Y as degenerate Specs yaw geometry", () => {
    const half = Math.PI / 4;
    for (const sign of [-1, 1] as const) {
      const pitch: Quat = [0, Math.sin((sign * Math.PI) / 4), 0, Math.cos(half)];
      const specs = clientTrackingToSpecsPose({
        position: [0, 0, 0],
        orientation: pitch,
      });
      const specsForward = rotateVecByQuat(normalizeQuat(specs.orientation), [0, 0, 1]);
      expect(Math.hypot(specsForward[0], specsForward[2])).toBeLessThan(1e-6);
      const tracking = specsToClientTrackingPose(specs);
      const trackingForward = rotateVecByQuat(normalizeQuat(tracking.orientation), [1, 0, 0]);
      expect(Math.hypot(trackingForward[0], trackingForward[1])).toBeLessThan(1e-6);
    }
  });
});

describe("SpecsCoordinates validation", () => {
  it("rejects non-finite and wrong-length inputs", () => {
    expect(() => clientTrackingToSpecsPoint([1, Number.NaN, 0])).toThrow(/finite/);
    expect(() => clientTrackingToSpecsPoint([1, 2] as unknown as Vec3)).toThrow(/3-element array/);
    expect(() => clientTrackingToSpecsQuat([0, 0, 0, 0])).toThrow(/non-zero/);
    expect(() => specsToClientTrackingQuat([1, 0, 0] as unknown as Quat)).toThrow(
      /4-element quaternion/,
    );
    expect(() => clientTrackingToSpecsYawPose([1, 2, 3] as unknown as YawPose)).toThrow(/4-element/);
    expect(() => specsToClientTrackingYawPose([0, 0, 0, Number.POSITIVE_INFINITY])).toThrow(/finite/);
  });
});
