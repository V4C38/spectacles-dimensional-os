import { describe, it, expect } from "vitest";
import {
  SPECTACLES_BASIS,
  clientToOdomOrientation,
  clientToOdomPosition,
  clientToOdomYaw,
  clientToOdomYawPose,
  convertOrientation,
  convertPosition,
  convertYaw,
  convertYawPose,
  odomToClientOrientation,
  odomToClientPosition,
  odomToClientYaw,
  odomToClientYawPose,
} from "../../Assets/Scripts/ARModuleClient/coordinates/coordinates";
import type { CoordinateBasis } from "../../Assets/Scripts/ARModuleClient/coordinates/coordinates";
import type { Quat, Vec3 } from "../../Assets/Scripts/ARModuleClient/websocket/types";

const IDENTITY: Quat = [0, 0, 0, 1];

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
  expect(actual[2]).toBeCloseTo(expected[2], 9);
}

function expectQuat(actual: Quat, expected: Quat): void {
  const sign = actual[3] * expected[3] < 0 ? -1 : 1;
  expect(actual[0]).toBeCloseTo(expected[0] * sign, 6);
  expect(actual[1]).toBeCloseTo(expected[1] * sign, 6);
  expect(actual[2]).toBeCloseTo(expected[2] * sign, 6);
  expect(actual[3]).toBeCloseTo(expected[3] * sign, 6);
}

describe("SPECTACLES_BASIS positions", () => {
  it("matches the PROTOCOL.md axis table", () => {
    expectVec3(odomToClientPosition([1, 2, 3], SPECTACLES_BASIS), [-2, 3, 1]);
    expectVec3(odomToClientPosition([0, 1, 0], SPECTACLES_BASIS), [-1, 0, 0]);
    expectVec3(odomToClientPosition([0, 0, 1], SPECTACLES_BASIS), [0, 1, 0]);
    expectVec3(odomToClientPosition([1, 0, 0], SPECTACLES_BASIS), [0, 0, 1]);
  });

  it("round-trips position", () => {
    const samples: Vec3[] = [
      [1, 2, 3],
      [-0.5, 0, 2.5],
      [0, -1.25, 0.01],
    ];
    for (const meters of samples) {
      expectVec3(
        clientToOdomPosition(odomToClientPosition(meters, SPECTACLES_BASIS), SPECTACLES_BASIS),
        meters,
      );
    }
  });
});

describe("orientation and yaw", () => {
  it("keeps the identity quaternion", () => {
    expectQuat(odomToClientOrientation(IDENTITY, SPECTACLES_BASIS), IDENTITY);
    expectQuat(clientToOdomOrientation(IDENTITY, SPECTACLES_BASIS), IDENTITY);
  });

  it("round-trips orientation", () => {
    const half = Math.PI / 4;
    const yawAboutZ: Quat = [0, 0, Math.sin(half), Math.cos(half)];
    expectQuat(
      clientToOdomOrientation(
        odomToClientOrientation(yawAboutZ, SPECTACLES_BASIS),
        SPECTACLES_BASIS,
      ),
      yawAboutZ,
    );
  });

  it("converts a 90 degree odom yaw through convertYaw, not a call-site sign flip", () => {
    const yaw = Math.PI / 2;
    const clientYaw = odomToClientYaw(yaw, SPECTACLES_BASIS);
    expect(clientYaw).toBeCloseTo(convertYaw(yaw, SPECTACLES_BASIS.odomToClient), 9);
    expect(clientToOdomYaw(clientYaw, SPECTACLES_BASIS)).toBeCloseTo(yaw, 9);

    const pose: [number, number, number, number] = [1, 2, 0, yaw];
    const clientPose = odomToClientYawPose(pose, SPECTACLES_BASIS);
    expectVec3([clientPose[0], clientPose[1], clientPose[2]], [-2, 0, 1]);
    expect(clientPose[3]).toBeCloseTo(clientYaw, 9);
    const back = clientToOdomYawPose(clientPose, SPECTACLES_BASIS);
    expectVec3([back[0], back[1], back[2]], [1, 2, 0]);
    expect(back[3]).toBeCloseTo(yaw, 9);
  });
});

describe("public conversion entry points", () => {
  it("exposes the same SPECTACLES mapping on the raw-matrix helpers", () => {
    expectVec3(convertPosition([1, 2, 3], SPECTACLES_BASIS.odomToClient), [-2, 3, 1]);
    expectQuat(convertOrientation(IDENTITY, SPECTACLES_BASIS.odomToClient), IDENTITY);
    const yaw = Math.PI / 2;
    expect(convertYaw(yaw, SPECTACLES_BASIS.odomToClient)).toBeCloseTo(
      odomToClientYaw(yaw, SPECTACLES_BASIS),
      9,
    );
    expect(convertYawPose([1, 2, 0, yaw], SPECTACLES_BASIS.odomToClient)[3]).toBeCloseTo(
      odomToClientYaw(yaw, SPECTACLES_BASIS),
      9,
    );
  });
});

describe("basis and input validation", () => {
  const stretched: CoordinateBasis = {
    name: "stretched",
    odomToClient: [
      [2, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  };

  it("rejects a non-orthonormal basis on every public helper", () => {
    expect(() => odomToClientPosition([1, 0, 0], stretched)).toThrow(/orthonormal/);
    expect(() => clientToOdomPosition([1, 0, 0], stretched)).toThrow(/orthonormal/);
    expect(() => odomToClientOrientation(IDENTITY, stretched)).toThrow(/orthonormal/);
    expect(() => clientToOdomOrientation(IDENTITY, stretched)).toThrow(/orthonormal/);
    expect(() => odomToClientYaw(0, stretched)).toThrow(/orthonormal/);
    expect(() => clientToOdomYaw(0, stretched)).toThrow(/orthonormal/);
    expect(() => odomToClientYawPose([0, 0, 0, 0], stretched)).toThrow(/orthonormal/);
    expect(() => clientToOdomYawPose([0, 0, 0, 0], stretched)).toThrow(/orthonormal/);
    expect(() => convertPosition([1, 0, 0], stretched.odomToClient)).toThrow(/orthonormal/);
    expect(() => convertOrientation(IDENTITY, stretched.odomToClient)).toThrow(/orthonormal/);
    expect(() => convertYaw(0, stretched.odomToClient)).toThrow(/orthonormal/);
    expect(() => convertYawPose([0, 0, 0, 0], stretched.odomToClient)).toThrow(/orthonormal/);
  });

  it("rejects non-finite coordinates, a zero quaternion, and non-finite yaw", () => {
    expect(() => odomToClientPosition([1, Number.NaN, 0], SPECTACLES_BASIS)).toThrow(/finite/);
    expect(() =>
      odomToClientOrientation([0, 0, 0, Number.POSITIVE_INFINITY], SPECTACLES_BASIS),
    ).toThrow(/finite/);
    expect(() => odomToClientOrientation([0, 0, 0, 0], SPECTACLES_BASIS)).toThrow(/non-zero/);
    expect(() => odomToClientYaw(Number.NaN, SPECTACLES_BASIS)).toThrow(/finite/);
    expect(() => convertYawPose([1, 2, 3, Number.NaN], SPECTACLES_BASIS.odomToClient)).toThrow(
      /finite/,
    );
  });
});
