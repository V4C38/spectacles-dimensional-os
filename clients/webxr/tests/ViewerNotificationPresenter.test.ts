import { expect, it } from "vitest";
import * as THREE from "three";
import { ViewerNotificationPresenter } from "../src/presentation/ViewerNotificationPresenter";

it("snaps into the lower view, follows smoothly, refreshes urgent feedback and expires in visible time", () => {
  const view = new ViewerNotificationPresenter();
  const tick = (dt: number, x = 0) => view.tick([x, 1.6, 0], [0, 0, 0, 1], 2, dt);
  view.show({ text: "Emergency stop requested", glyph: "cross", priority: 100 });
  tick(0.1);
  expect(view.object.position.toArray()).toEqual([0, 1.3975, -0.9]);
  tick(0.1, 1); expect(view.object.position.x).toBeGreaterThan(0); expect(view.object.position.x).toBeLessThan(1);
  view.show({ text: "Ordinary notice", durationS: 0.01 }); tick(0.1);
  expect(view.object.visible).toBe(true);
  tick(2.1); view.show({ text: "Emergency stop", glyph: "cross", priority: 100 }); tick(0.2);
  expect(view.object.visible).toBe(true);
  tick(2.4); expect(view.object.visible).toBe(false);
  view.dispose();
});

it("keeps notifications level and centered below the gaze through head roll and smooth turns", () => {
  const view = new ViewerNotificationPresenter();
  view.show({ text: "Emergency stop requested", priority: 100 });
  const orientation = (pitch: number, yaw: number, roll: number) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ")).toArray();
  view.tick([0, 1.6, 0], orientation(0, 0, 0.6), 2, 0.01);
  expect(view.object.position.toArray()).toEqual([0, 1.3975, -0.9]);
  for (const [pitch, yaw, roll] of [[0.4, 0.8, -0.5], [-0.3, -0.6, 0.7], [0.2, 1, 0]]) {
    view.tick([0, 1.6, 0], orientation(pitch, yaw, roll), 2, 0.05);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(view.object.quaternion);
    expect(right.y).toBeCloseTo(0, 10);
  }
  view.dispose();
});

it.each(["stop", undefined] as const)("tilts %s popups upward without shifting their lower-view position", glyph => {
  const view = new ViewerNotificationPresenter();
  view.show({ text: glyph ? "Emergency stop requested" : "Notification", glyph });
  view.tick([0, 1.6, 0], [0, 0, 0, 1], 2, 0.1);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(view.object.quaternion);
  expect(Math.atan2(normal.y, normal.z)).toBeCloseTo(THREE.MathUtils.degToRad(12));
  expect(view.object.position.toArray()).toEqual([0, 1.3975, -0.9]);
  expect(new THREE.Vector3(1, 0, 0).applyQuaternion(view.object.quaternion).y).toBeCloseTo(0);
  view.dispose();
});
