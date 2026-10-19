import { describe, expect, it } from "vitest";
import { rotateVecByQuat } from "@dimos-ar-client/localization/clientTrackingTransforms";
import {
  webxrCameraToOpticalPose,
  webxrToClientTrackingPoint,
  webxrToClientTrackingPose,
} from "../src/coordinates/WebXRCoordinates";

describe("WebXRCoordinates", () => {
  it("maps Three.js / WebXR Y-up onto protocol Z-up", () => {
    expect(webxrToClientTrackingPoint([0, 0, -1])).toEqual([1, 0, 0]);
    expect(webxrToClientTrackingPoint([1, 0, 0])).toEqual([0, -1, 0]);
    expect(webxrToClientTrackingPoint([0, 1, 0])).toEqual([0, 0, 1]);
  });

  it("sends Three.js camera forward into optical +Z / protocol +X", () => {
    const identity = webxrCameraToOpticalPose({
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
    });
    const opticalForward = rotateVecByQuat(identity.orientation, [0, 0, 1]);
    expect(opticalForward[0]).toBeCloseTo(1);
    expect(opticalForward[1]).toBeCloseTo(0);
    expect(opticalForward[2]).toBeCloseTo(0);
  });

  it("round-trips a translated pose", () => {
    const pose = webxrToClientTrackingPose({
      position: [0.2, 1.1, -0.4],
      orientation: [0, 0, 0, 1],
    });
    expect(pose.position[0]).toBeCloseTo(0.4);
    expect(pose.position[1]).toBeCloseTo(-0.2);
    expect(pose.position[2]).toBeCloseTo(1.1);
  });
});

import { composeOptical } from "../src/camera/HmdCameraSource";
import { HMD_PROFILES } from "../src/camera/hmdProfiles";
import { webxrHeadingToClientTrackingPose, clientTrackingToWebxrPose } from "../src/coordinates/WebXRCoordinates";
import { yawFromPlanarDirection } from "../src/navigation/WebXRNavigationController";
import { clientTrackingToOdomPose } from "@dimos-ar-client/localization/clientTrackingTransforms";

it("preserves generic identity rotations while keeping optical right/down/forward axes fixed", () => {
  const object = webxrToClientTrackingPose({ position: [0, 0, 0], orientation: [0, 0, 0, 1] });
  expect(object.orientation).toEqual([0, 0, 0, 1]);
  expect(clientTrackingToWebxrPose(object).orientation).toEqual([0, 0, 0, 1]);
  const optical = webxrCameraToOpticalPose({ position: [0, 0, 0], orientation: [0, 0, 0, 1] });
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][];
  const expected = [[0, -1, 0], [0, 0, -1], [1, 0, 0]];
  axes.forEach((axis, i) => rotateVecByQuat(optical.orientation, axis).forEach((value, j) => expect(value).toBeCloseTo(expected[i][j])));
});

it("composes viewer-local camera translation before changing the world basis", () => {
  const h = Math.SQRT1_2;
  const result = composeOptical({ t: 1, position: [1, 2, -3], orientation: [0, h, 0, h] }, {
    ...HMD_PROFILES.quest3, T_viewer_optical: { position: [0.1, 0, 0], orientation: [1, 0, 0, 0] },
  });
  expect(result.position[0]).toBeCloseTo(3.1);
  expect(result.position[1]).toBeCloseTo(-1);
  expect(result.position[2]).toBeCloseTo(2);
  const forward = rotateVecByQuat(result.orientation, [0, 0, 1]);
  expect(forward[0]).toBeCloseTo(0); expect(forward[1]).toBeCloseTo(1); expect(forward[2]).toBeCloseTo(0);
});

it.each([
  [0, -1, 1, 0], [-1, 0, 0, 1], [1, 0, 0, -1], [0, 1, -1, 0],
])("maps physical WebXR heading (%s,%s) to protocol forward (%s,%s), including a rotated origin", (x, z, fx, fy) => {
  const heading = yawFromPlanarDirection(x, z);
  const arrow = rotateVecByQuat(heading, [0, 0, -1]);
  expect(arrow[0]).toBeCloseTo(x); expect(arrow[2]).toBeCloseTo(z);
  const local = webxrHeadingToClientTrackingPose({ position: [2, 0, -3], orientation: heading });
  const forward = rotateVecByQuat(local.orientation, [1, 0, 0]);
  expect(forward[0]).toBeCloseTo(fx); expect(forward[1]).toBeCloseTo(fy);
  const odom = clientTrackingToOdomPose(local, { position: [10, 20, 0], orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], confidence: 1, ts: 0 });
  expect(odom.position[0]).toBeCloseTo(12); expect(odom.position[1]).toBeCloseTo(23);
  const global = rotateVecByQuat(odom.orientation, [1, 0, 0]);
  expect(global[0]).toBeCloseTo(-fy); expect(global[1]).toBeCloseTo(fx);
});
