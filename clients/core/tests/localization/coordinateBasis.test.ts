import { expect, it } from "vitest";
import { applyBasis, transposeBasis, changeBasisQuat, remapPoseQuat, rotateVecByQuat, type Mat3 } from "../../src/localization/ClientTracking";
import type { Quat, Vec3 } from "../../src/ClientContracts";

const basis: Mat3 = [[0, 0, -1], [-1, 0, 0], [0, 1, 0]];
const point: Vec3 = [0.3, -0.7, 1.1];
function close(actual: Vec3, expected: Vec3): void {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10));
}

it.each([0, Math.PI / 2, Math.PI, 1.37])("changes rotation axes and round-trips at %s radians", angle => {
  for (const axis of [0, 1, 2]) {
    const rotation: Quat = [0, 0, 0, Math.cos(angle / 2)];
    rotation[axis] = Math.sin(angle / 2);
    const changed = changeBasisQuat(rotation, basis);
    close(rotateVecByQuat(changed, applyBasis(basis, point)), applyBasis(basis, rotateVecByQuat(rotation, point)));
    const restored = changeBasisQuat(changed, transposeBasis(basis));
    close(rotateVecByQuat(restored, point), rotateVecByQuat(rotation, point));
    // Optical poses change world axes while retaining their local camera axes.
    close(rotateVecByQuat(remapPoseQuat(rotation, basis), point), applyBasis(basis, rotateVecByQuat(rotation, point)));
  }
});
