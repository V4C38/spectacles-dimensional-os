import { expect, it } from "vitest";
import * as THREE from "three";
import { NotificationPill } from "../src/presentation/NotificationPill";
import { EndEffectorStatusView } from "../src/manipulation/EndEffectorStatusView";
it("keeps a non-interactive pill beside the EE and fades it out on recovery", () => {
  const warning = new EndEffectorStatusView(), marker = new THREE.Vector3(1, 1, 1);
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

it("lays out a 16 cm EE pill with its existing physical font size and a full-size viewer pill", () => {
  const warning = new EndEffectorStatusView();
  warning.update(new THREE.Vector3(), 1, { blocked: true, fresh: true, stopped: false,
    moving: true, rejection: null });
  warning.update(new THREE.Vector3(), 2, { blocked: true, fresh: true, stopped: false,
    moving: true, rejection: null });
  const plate = warning.object.children[0] as any;
  expect(plate.material.uniforms.uSize.value.toArray()).toEqual([0.16, 0.052]);
  const text = warning.object.children[1] as any;
  expect(text.text).toBe("Executing");
  expect(text.fontSize).toBeCloseTo(0.0136);
  expect(text.maxWidth).toBeGreaterThan(0.09);
  expect(warning.object.scale.x).toBe(1);
  const viewer = new NotificationPill();
  const viewerPlate = viewer.object.children[0] as any;
  expect(viewerPlate.material.uniforms.uSize.value.toArray()).toEqual([0.3, 0.065]);
  expect((viewer.object.children[1] as any).fontSize).toBe(0.017);
  expect((viewer.object.children[1] as any).maxWidth).toBeCloseTo(0.22);
  warning.dispose(); viewer.dispose();
});
