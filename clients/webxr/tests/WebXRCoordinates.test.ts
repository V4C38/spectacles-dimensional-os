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
