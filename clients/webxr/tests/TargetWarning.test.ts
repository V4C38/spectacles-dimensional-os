import { expect, it } from "vitest";
import * as THREE from "three";
import { TargetWarning } from "../src/manipulation/TargetWarning";
it("keeps a non-interactive pill beside the EE and fades it out on recovery", () => {
  const warning = new TargetWarning(), marker = new THREE.Vector3(1, 1, 1);
  const failed = { blocked: false, fresh: true, stopped: false, moving: false,
    rejection: { message: "Unreachable" } };
  warning.update(marker, 1, failed);
  warning.update(marker, 3, { ...failed });
  warning.faceViewer(new THREE.Vector3(1, 1, 3));
  expect(warning.object.visible).toBe(true);
  expect(warning.object.position.x).toBeCloseTo(1.16);
  expect(warning.object.position.y).toBeCloseTo(1.01);
  expect(warning.object.getObjectByName("ReplicationBlockedCross")).toBeUndefined();
  expect(new THREE.Raycaster(new THREE.Vector3(1.16, 1.01, 3), new THREE.Vector3(0, 0, -1))
    .intersectObject(warning.object, true)).toHaveLength(0);
  warning.update(marker, 3.1, { ...failed, rejection: null });
  expect(warning.object.visible).toBe(true);
  warning.update(marker, 3.3, { ...failed, rejection: null });
  expect(warning.object.visible).toBe(false);
  warning.dispose();
});
